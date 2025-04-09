import { AttachmentBuilder, type Snowflake } from 'discord.js';
import type { RedisClient } from 'bun';
import { createContextKey, type Context } from './context';
import { ConfigError, kConfig } from './config';
import { kRedis } from './redis';

export function createPin(): string {
    return (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).toString().padStart(6, '0');
}

async function generateCaptcha(pin: string, captchaBin: string) {
    const { stdout, exited } = Bun.spawn([captchaBin, pin]);
    if ((await exited) !== 0) {
        throw new Error('captcha generator exited with non-zero code');
    }
    const data = await Bun.readableStreamToArrayBuffer(stdout);
    return Buffer.from(data);
}

export interface CaptchaManager {
    get(guild: Snowflake, member: Snowflake): Promise<AttachmentBuilder>;
    verify(guild: Snowflake, member: Snowflake, pin: string): Promise<boolean>;
}

interface CaptchaCache {
    pin: string;
    expires: Date;
}

export class MemoryCaptchaManager implements CaptchaManager {
    #cache = new Map<string, CaptchaCache>();
    #expires: number;
    #captchaBin: string;

    constructor(expires: number, captchaBin: string) {
        this.#expires = expires;
        this.#captchaBin = captchaBin;

        setInterval(() => {
            for (const [key, value] of this.#cache) {
                if (value.expires.getTime() < Date.now()) {
                    this.#cache.delete(key);
                }
            }
        }, 5000);
    }

    async get(guild: Snowflake, member: Snowflake): Promise<AttachmentBuilder> {
        const key = `${guild}:${member}`;
        const cache = this.#cache.get(key) ?? {
            pin: createPin(),
            expires: new Date(Date.now() + this.#expires),
        };
        if (cache.expires.getTime() < Date.now()) {
            cache.pin = createPin();
            cache.expires = new Date(Date.now() + this.#expires);
        }
        this.#cache.set(key, cache);
        return new AttachmentBuilder(await generateCaptcha(cache.pin, this.#captchaBin), {
            name: 'captcha.png',
        });
    }

    async verify(guild: Snowflake, member: Snowflake, pin: string): Promise<boolean> {
        const key = `${guild}:${member}`;
        const cache = this.#cache.get(key);
        if (!cache) return false;
        if (cache.expires.getTime() < Date.now()) {
            this.#cache.delete(key);
            return false;
        }
        if (cache.pin !== pin) return false;
        this.#cache.delete(key);
        return true;
    }
}

export class RedisCaptchaManager implements CaptchaManager {
    #redis: RedisClient;
    #expires: number;
    #captchaBin: string;
    #redisPrefix;

    constructor(redis: RedisClient, redisPrefix: string, expires: number, captchaBin: string) {
        this.#redis = redis;
        this.#expires = Math.ceil(expires / 1000);
        this.#captchaBin = captchaBin;
        this.#redisPrefix = redisPrefix;
    }

    async get(guild: Snowflake, member: Snowflake): Promise<AttachmentBuilder> {
        const key = `${this.#redisPrefix}captcha:${guild}:${member}`;
        const pin = createPin();
        await this.#redis.set(key, pin, 'EX', this.#expires);
        return new AttachmentBuilder(await generateCaptcha(pin, this.#captchaBin), {
            name: 'captcha.png',
        });
    }

    async verify(guild: Snowflake, member: Snowflake, pin: string): Promise<boolean> {
        const key = `${this.#redisPrefix}captcha:${guild}:${member}`;
        const value = await this.#redis.get(key);
        if (!value) return false;
        if (value !== pin) return false;
        await this.#redis.del(key);
        return true;
    }
}

export function setupCaptchaManager(context: Context) {
    const captchaBin = context.get(kConfig)('captcha.bin', 'captcha');
    const expires = context.get(kConfig)('captcha.expires');
    const driver = context.get(kConfig)('captcha.driver');

    if (!expires || expires < 0) {
        throw new ConfigError('captcha.expires must be a string of duration');
    }

    if (driver === 'memory') {
        context.set(kCaptchaManager, new MemoryCaptchaManager(expires, captchaBin));
    } else if (driver === 'redis') {
        if (!context.has(kRedis)) {
            throw new ConfigError('captcha.driver is redis but redis is not configured');
        }
        const redis = context.get(kRedis).client;
        const prefix = context.get(kRedis).prefix;
        context.set(kCaptchaManager, new RedisCaptchaManager(redis, prefix, expires, captchaBin));
    } else {
        throw new ConfigError(`Invalid captcha driver ${driver}`);
    }
}

export const kCaptchaManager = createContextKey<CaptchaManager>('captcha');
