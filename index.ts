import { kConfig, loadConfig } from './lib/config';
import cac from 'cac';
import { handleError } from './lib/error';
import { Context, kClient } from './lib/context';
import { Client } from 'discord.js';

const cli = cac('bun index.ts');

cli.command('[...configs]', 'Start the bot')
    .option('-c, --config <file>', 'Specify the config file')
    .action(async (configs, options: { config?: string }) => {
        try {
            const config = await loadConfig(configs, options.config);
            const context = new Context();
            context.set(kConfig, config);
            const client = new Client({
                intents: [],
            });
            context.set(kClient, client);
            client.on('ready', () => {
                const url = new URL(
                    'https://discord.com/oauth2/authorize?&scope=bot+applications.commands&permissions=268435456',
                );
                url.searchParams.set('client_id', client.application!.id);
                console.log(`[discord] invite url: ${url}`);
            });
            await client.login(config('discord.token'));
        } catch (e) {
            handleError(e);
        }
    });

cli.help();

cli.parse();
