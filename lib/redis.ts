import { RedisClient } from 'bun';
import { Context, createContextKey } from './context';
import { kConfig } from './config';

export interface RedisContext {
    client: RedisClient;
    prefix: string;
}

export async function setupRedis(context: Context) {
    if (!context.get(kConfig)('redis', true)) return;
    const url = new URL(context.get(kConfig)('redis.protocol') + '://');
    url.hostname = context.get(kConfig)('redis.host');
    url.port = context.get(kConfig)('redis.port').toString();
    url.username = context.get(kConfig)('redis.username', true) ?? '';
    url.password = context.get(kConfig)('redis.password', true) ?? '';
    const redis = new RedisClient(url.href, {
        connectionTimeout: 5000,
        autoReconnect: true,
        maxRetries: 3,
        idleTimeout: 0,
    });
    const prefix = context.get(kConfig)('redis.prefix');
    try {
        await redis.connect();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
    context.set(kRedis, { client: redis, prefix });
}

export const kRedis = createContextKey<RedisContext>('redis');
