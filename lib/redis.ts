import { createClient, type RedisClientType } from 'redis';
import { Context, createContextKey } from './context';
import { kConfig } from './config';

export interface RedisContext {
    client: RedisClientType<any, any, any>;
    prefix: string;
}

export async function setupRedis(context: Context) {
    if (!context.get(kConfig)('redis', true)) return;
    const url = new URL('redis://');
    url.hostname = context.get(kConfig)('redis.host');
    url.port = context.get(kConfig)('redis.port').toString();
    const redis = createClient({
        url: url.toString(),
        password: context.get(kConfig)('redis.password', true),
        database: context.get(kConfig)('redis.db', true),
    });
    const prefix = context.get(kConfig)('redis.prefix');
    await redis.connect();
    context.set(kRedis, { client: redis, prefix });
}

export const kRedis = createContextKey<RedisContext>('redis');
