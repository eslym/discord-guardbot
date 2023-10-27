import type { Snowflake } from 'discord.js';
import { EventEmitter } from 'events';
import type TypedEventEmitter from 'typed-emitter';
import type { RedisClientType } from 'redis';

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
}

export class RedisLimiter
    extends (EventEmitter as new () => TypedEventEmitter<LimiterEvents>)
    implements Limiter
{
    #redis: RedisClientType;
    #maxAttempts: number;
    #expires: number;
    #banTime: number;
    #prefix: string;

    constructor(redis: RedisClientType, options: LimiterOptions & { prefix: string }) {
        super();
        this.#redis = redis;
        this.#maxAttempts = options.attempts;
        this.#expires = Math.ceil(options.expires);
        this.#banTime = Math.ceil(options.ban);
        this.#prefix = options.prefix;
    }

    async attempt(guild: string, member: string): Promise<boolean> {
        const key = `${this.#prefix}attempts:${guild}:${member}`;
        const ban = await this.#redis.keys(key);
        if (ban.length > 0) return false;
        const attempts = await this.#redis.incr(key);
        if (attempts === 1) await this.#redis.expire(key, this.#expires);
        if (attempts >= this.#maxAttempts) {
            await this.#redis.set(key, 'ban', {
                EX: this.#banTime,
            });
            this.emit('ban', guild, member);
            return false;
        }
        return true;
    }
}
