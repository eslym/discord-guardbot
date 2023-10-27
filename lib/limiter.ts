import type { Snowflake } from 'discord.js';
import { EventEmitter } from 'events';
import type TypedEventEmitter from 'typed-emitter';
import type { RedisClientType } from 'redis';
import { Context, createContextKey } from './context';
import { ConfigError, kConfig } from './config';
import parseDuration from 'parse-duration';
import { kRedis } from './redis';

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
    attempt(guild: Snowflake, member: Snowflake): Promise<boolean>;
    reset(guild: Snowflake, member: Snowflake): Promise<void>;
}

export class MemoryLimiter
    extends (EventEmitter as new () => TypedEventEmitter<LimiterEvents>)
    implements Limiter
{
    #ban = new Map<string, Date>();
    #attempts = new Map<string, AttemptsCache>();
    #maxAttempts: number;
    #expires: number;
    #banTime: number;

    constructor(options: LimiterOptions) {
        super();
        this.#maxAttempts = options.attempts;
        this.#expires = options.expires;
        this.#banTime = options.ban;

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

    async attempt(guild: string, member: string): Promise<boolean> {
        const key = `${guild}:${member}`;
        if (this.#ban.has(key) && this.#ban.get(key)!.getTime() >= Date.now()) return false;
        const cache = this.#attempts.get(key) ?? {
            attempts: 0,
            expires: new Date(Date.now() + this.#expires),
        };
        if (cache.expires.getTime() < Date.now()) {
            cache.attempts = 0;
            cache.expires = new Date(Date.now() + this.#expires);
        }
        if (cache.attempts >= this.#maxAttempts) {
            this.#attempts.delete(key);
            this.#ban.set(key, new Date(Date.now() + this.#banTime));
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
    extends (EventEmitter as new () => TypedEventEmitter<LimiterEvents>)
    implements Limiter
{
    #redis: RedisClientType<any, any, any>;
    #maxAttempts: number;
    #expires: number;
    #banTime: number;
    #prefix: string;

    constructor(
        redis: RedisClientType<any, any, any>,
        options: LimiterOptions & { prefix: string },
    ) {
        super();
        this.#redis = redis;
        this.#maxAttempts = options.attempts;
        this.#expires = Math.ceil(options.expires / 1000);
        this.#banTime = Math.ceil(options.ban / 1000);
        this.#prefix = options.prefix;
    }

    async attempt(guild: string, member: string): Promise<boolean> {
        const key = `${this.#prefix}attempts:${guild}:${member}`;
        const banKey = `${this.#prefix}ban:${guild}:${member}`;
        const ban = await this.#redis.keys(banKey);
        if (ban.length > 0) return false;
        const attempts = await this.#redis.incr(key);
        if (attempts === 1) await this.#redis.expire(key, this.#expires);
        if (attempts >= this.#maxAttempts) {
            await this.#redis.setEx(banKey, this.#banTime, 'ban');
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
    const driver = context.get(kConfig)('captcha.throttle.driver', 'memory');
    const attempts = parseInt(context.get(kConfig)('captcha.throttle.attempts', '5'));
    const expires = parseDuration(context.get(kConfig)('captcha.throttle.expires', '30m'));
    const ban = parseDuration(context.get(kConfig)('captcha.throttle.ban', '8h'));

    if (!attempts || isNaN(attempts) || attempts <= 1) {
        throw new ConfigError(
            'captcha.throttle.attempts must be a string of integer which is greater than 1',
        );
    }

    if (!expires || expires <= 0) {
        throw new ConfigError('captcha.throttle.expires must be a string of duration');
    }

    if (!ban || ban <= 0) {
        throw new ConfigError('captcha.throttle.ban must be a string of duration');
    }

    if (driver === 'memory') {
        context.set(kLimiter, new MemoryLimiter({ attempts, expires, ban }));
    } else if (driver === 'redis') {
        if (!context.has(kRedis)) {
            throw new ConfigError('captcha.throttle.driver is redis but redis is not configured');
        }
        const redis = context.get(kRedis);
        context.set(
            kLimiter,
            new RedisLimiter(redis.client, { attempts, expires, ban, prefix: redis.prefix }),
        );
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
