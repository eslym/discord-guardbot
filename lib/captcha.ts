import { AttachmentBuilder } from 'discord.js';

export function createPin(): string {
    return crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(6, '0');
}

async function generateCaptcha(pin: string, captchaBin: string) {
    const { stdout } = Bun.spawn([captchaBin, pin]);
    const data = await Bun.readableStreamToArrayBuffer(stdout);
    return Buffer.from(data);
}

async function createCaptcha() {
    const pin = createPin();
    const captcha = new AttachmentBuilder(await generateCaptcha(pin, 'captcha'), {
        name: 'captcha.png',
    });
    return { pin, captcha };
}
