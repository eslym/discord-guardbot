import type { Snowflake } from 'discord.js';
import { EventEmitter } from 'events';
import type TypedEventEmitter from 'typed-emitter';
import { Context, createContextKey } from './context';
import { ConfigError, kConfig } from './config';
import { kRedis } from './redis';
import type { RedisClient } from 'bun';

interface AttemptsCache {
    attempts: number;
    expires: Date;
}

type LimiterEvents = {
    ban: (guild: Snowflake, member: Snowflake) => void;
};

export interface LimiterOptions {
    attempts: number;
    expires: number;
    ban: number;
}

export interface Limiter extends TypedEventEmitter<LimiterEvents> {
    attempt(
        guild: Snowflake,
        member: Snowflake,
        max: number,
        exp: number,
        ban: number,
    ): Promise<boolean>;
    reset(guild: Snowflake, member: Snowflake): Promise<void>;
}

export class MemoryLimiter
    extends (EventEmitter as any as new () => TypedEventEmitter<LimiterEvents>)
    implements Limiter
{
    #ban = new Map<string, Date>();
    #attempts = new Map<string, AttemptsCache>();

    constructor() {
        super();

        setInterval(() => {
            for (const [key, value] of this.#ban) {
                if (value.getTime() < Date.now()) {
                    this.#ban.delete(key);
                    const [guild, member] = key.split(':');
                    this.emit('ban', guild, member);
                }
            }
        }, 5000);
    }

    async attempt(
        guild: string,
        member: string,
        max: number,
        exp: number,
        ban: number,
    ): Promise<boolean> {
        const key = `${guild}:${member}`;
        if (this.#ban.has(key) && this.#ban.get(key)!.getTime() >= Date.now()) return false;
        const cache = this.#attempts.get(key) ?? {
            attempts: 0,
            expires: new Date(Date.now() + exp),
        };
        if (cache.expires.getTime() < Date.now()) {
            cache.attempts = 0;
            cache.expires = new Date(Date.now() + exp);
        }
        if (cache.attempts >= max) {
            this.#attempts.delete(key);
            this.#ban.set(key, new Date(Date.now() + ban));
            this.emit('ban', guild, member);
            return false;
        }
        cache.attempts++;
        return true;
    }

    async reset(guild: string, member: string): Promise<void> {
        const key = `${guild}:${member}`;
        this.#attempts.delete(key);
        this.#ban.delete(key);
    }
}

export class RedisLimiter
    extends (EventEmitter as any as new () => TypedEventEmitter<LimiterEvents>)
    implements Limiter
{
    #redis: RedisClient;
    #prefix: string;

    constructor(redis: RedisClient, options: { prefix: string }) {
        super();
        this.#redis = redis;
        this.#prefix = options.prefix;
    }

    async attempt(
        guild: string,
        member: string,
        max: number,
        exp: number,
        ban: number,
    ): Promise<boolean> {
        const key = `${this.#prefix}attempts:${guild}:${member}`;
        const banKey = `${this.#prefix}ban:${guild}:${member}`;
        const isBan = await this.#redis.keys(banKey);
        if (isBan.length > 0) return false;
        const attempts = await this.#redis.incr(key);
        if (attempts === 1) await this.#redis.expire(key, Math.ceil(exp / 1000));
        if (attempts >= max) {
            await this.#redis.set(banKey, 'ban', 'PX', ban);
            this.emit('ban', guild, member);
            return false;
        }
        return true;
    }

    async reset(guild: string, member: string): Promise<void> {
        await this.#redis.del(`${this.#prefix}attempts:${guild}:${member}`);
        await this.#redis.del(`${this.#prefix}ban:${guild}:${member}`);
    }
}

export function setupLimiter(context: Context) {
    const driver = context.get(kConfig)('captcha.throttle.driver');
    if (driver === 'memory') {
        context.set(kLimiter, new MemoryLimiter());
    } else if (driver === 'redis') {
        if (!context.has(kRedis)) {
            throw new ConfigError('captcha.throttle.driver is redis but redis is not configured');
        }
        const redis = context.get(kRedis);
        context.set(kLimiter, new RedisLimiter(redis.client, { prefix: redis.prefix }));
    } else {
        throw new ConfigError('captcha.throttle.driver must be either memory or redis');
    }

    context.get(kLimiter).on('ban', (guild, member) => {
        console.info(
            `[captcha] guild ${guild} member ${member} has been banned from requesting new captcha`,
        );
    });
}

export const kLimiter = createContextKey<Limiter>('limiter');
