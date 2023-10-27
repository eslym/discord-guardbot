#!/usr/bin/env bun
import { kConfig, loadConfig, type ConfigFunction } from './lib/config';
import cac from 'cac';
import { handleError } from './lib/error';
import { Context, kClient } from './lib/context';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    Client,
    Guild,
    PermissionFlagsBits,
    SlashCommandBuilder,
    ButtonStyle,
    type Interaction,
    GuildMember,
    EmbedBuilder,
    IntentsBitField,
    ChatInputCommandInteraction,
} from 'discord.js';
import { setupRedis } from './lib/redis';
import { kLimiter, setupLimiter } from './lib/limiter';
import { kCaptchaManager, setupCaptchaManager } from './lib/captcha';

function wrapAsync<T extends (...args: any[]) => Promise<void>>(
    fn: T,
): (...args: Parameters<T>) => void {
    return (...args) => {
        fn(...args).catch(handleError);
    };
}

function keyButton(key: string) {
    return new ButtonBuilder()
        .setCustomId(`guard:keypad:${key}`)
        .setLabel(key)
        .setStyle(ButtonStyle.Primary);
}

function emojiButton(id: string, emoji: string, style: ButtonStyle) {
    return new ButtonBuilder().setCustomId(`guard:keypad:${id}`).setEmoji(emoji).setStyle(style);
}

const keyPad = [
    ['1', '2', '3'].map(keyButton),
    ['4', '5', '6'].map(keyButton),
    ['7', '8', '9'].map(keyButton),
    [
        emojiButton('backspace', '✖️', ButtonStyle.Danger),
        keyButton('0'),
        emojiButton('submit', '✔️', ButtonStyle.Success),
    ],
].map(row => new ActionRowBuilder<ButtonBuilder>().addComponents(row).toJSON());

async function syncCommand(config: ConfigFunction, guild: Guild) {
    if (!config(`guild.${guild.id as any as number}.role`, undefined)) {
        console.info(`[discord] guild ${guild.id} is not configured, skipping`);
        return;
    }
    const command = new SlashCommandBuilder();
    command.setName('welcome');
    command.setDescription('Send the verify message to current channel');
    command.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    await guild.commands.set([command]);
    console.info(`[discord] guild ${guild.id} synced`);
}

async function init(context: Context) {
    const client = context.get(kClient);
    const config = context.get(kConfig);
    client.guilds.cache.forEach(guild => wrapAsync(syncCommand)(config, guild));
}

async function sendWelcomeMessage(
    config: ConfigFunction,
    interaction: ChatInputCommandInteraction,
) {
    const message = config(
        `guild.${interaction.guildId as any as number}.lang.message.verify`,
        config('lang.message.verify', 'Please click the button below to verify'),
    );
    await interaction.reply({
        content: message,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('guard:request')
                    .setLabel(
                        config(
                            `guild.${interaction.guildId as any as number}.lang.button.verify`,
                            config('lang.button.verify', 'Verify'),
                        ),
                    )
                    .setStyle(ButtonStyle.Primary),
            ) as any,
        ],
    });
}

async function requestCaptcha(context: Context, interaction: ButtonInteraction) {
    const config = context.get(kConfig);
    const guild = interaction.guild!;
    const member = interaction.member!;
    const limiter = context.get(kLimiter);

    if (!(await limiter.attempt(guild.id, member.user.id))) {
        await interaction.reply({
            content: config(
                `guild.${guild.id as any as number}.lang.message.throttle`,
                config(
                    'lang.message.throttle',
                    'You failed to verify too many times, please try again later',
                ),
            ),
            ephemeral: true,
        });
        return;
    }
    console.log(`[captcha] guild ${guild.id} member ${member.user.id} requested new captcha`);
    const captcha = await context.get(kCaptchaManager).get(guild.id, member.user.id);
    const message = config(
        `guild.${guild.id as any as number}.lang.message.captcha`,
        config('lang.message.captcha', 'Please enter the captcha'),
    );
    await interaction.reply({
        embeds: [new EmbedBuilder().setTitle(message)],
        files: [captcha],
        components: keyPad,
        ephemeral: true,
    });
}

async function handleKeypad(context: Context, interaction: ButtonInteraction) {
    const config = context.get(kConfig);
    const guild = interaction.guild!;
    const member = interaction.member!;
    const captcha = context.get(kCaptchaManager);
    const button = interaction.customId.slice('guard:keypad:'.length);
    const embed = interaction.message!.embeds[0]!.toJSON();
    const pin = embed.description ?? '';
    switch (button) {
        case 'backspace': {
            (embed.description = pin.slice(0, -1)),
                await interaction.update({
                    embeds: [embed],
                });
            break;
        }
        case 'submit': {
            if (pin.length < 6) {
                await interaction.deferUpdate();
                return;
            }
            const success = await captcha.verify(guild.id, member.user.id, pin);
            if (success) {
                await context.get(kLimiter).reset(guild.id, member.user.id);
                console.log(`[captcha] guild ${guild.id} member ${member.user.id} verified`);
                await interaction.update({
                    content: config(
                        `guild.${guild.id as any as number}.lang.message.success`,
                        config('lang.message.success', 'You have been verified'),
                    ),
                    embeds: [],
                    components: [],
                    attachments: [],
                });
                await (member as GuildMember).roles.add(
                    config(`guild.${guild.id as any as number}.role`),
                );
            } else {
                console.log(`[captcha] guild ${guild.id} member ${member.user.id} failed`);
                await interaction.update({
                    content: config(
                        `guild.${guild.id as any as number}.lang.message.failed`,
                        config('lang.message.failed', 'You failed to verify'),
                    ),
                    embeds: [],
                    components: [],
                    attachments: [],
                });
            }
            break;
        }
        default: {
            if (pin.length >= 6) {
                await interaction.deferUpdate();
                return;
            }
            embed.description = pin + button;
            await interaction.update({
                embeds: [embed],
            });
            break;
        }
    }
}

const cli = cac('guardbot');

cli.command('[...configs]', 'Start the bot')
    .option('-c, --config <file>', 'Specify the config file')
    .action(async (configs, options: { config?: string }) => {
        try {
            const context = new Context();
            const config = await loadConfig(configs, options.config);

            context.set(kConfig, config);
            await setupRedis(context);

            setupLimiter(context);
            setupCaptchaManager(context);

            const client = new Client({
                intents: [IntentsBitField.Flags.Guilds],
            });
            context.set(kClient, client);

            client.on('ready', () => {
                const url = new URL(
                    'https://discord.com/oauth2/authorize?&scope=bot+applications.commands&permissions=268435456',
                );
                url.searchParams.set('client_id', client.application!.id);
                console.log(`[discord] invite url: ${url}`);
                wrapAsync(init)(context);
            });

            client.on('guildCreate', guild => wrapAsync(syncCommand)(config, guild));

            client.on(
                'interactionCreate',
                wrapAsync(async (interaction: Interaction) => {
                    if (!interaction.guild) return;
                    if (interaction.isChatInputCommand() && interaction.commandName === 'welcome') {
                        await sendWelcomeMessage(config, interaction);
                        return;
                    }
                    if (!interaction.isButton()) return;
                    if (interaction.customId === 'guard:request') {
                        await requestCaptcha(context, interaction);
                        return;
                    }
                    if (!interaction.customId.startsWith('guard:keypad:')) return;
                    await handleKeypad(context, interaction);
                }),
            );

            client.on('error', handleError);
            await client.login(config('discord.token'));
        } catch (e) {
            handleError(e);
        }
    });

cli.help();

cli.parse();
