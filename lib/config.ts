import { extname } from 'path';
import { parse } from 'yaml';
import { createContextKey } from './context';

const ENV_PREFIX = 'GUARDBOT_';

type Partial<T, DEEP extends boolean = false> = T extends object
    ? {
          [K in keyof T]?: DEEP extends true ? Partial<T[K], true> : T[K];
      }
    : T;

type Required<T, DEEP extends boolean = true> = T extends object
    ? {
          [K in keyof T]-?: DEEP extends true ? Required<T[K], true> : T[K];
      }
    : T;

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

interface Lang {
    message: {
        verify: string;
        captcha: string;
        success: string;
        failed: string;
        throttle: string;
    };
    button: {
        verify: string;
    };
}

interface Throttle {
    attempts: string;
    expires: string;
    ban: string;
}

export interface Config {
    discord: {
        token: string;
    };
    captcha?: {
        bin?: string;
        expires?: string;
        driver?: 'memory' | 'redis';
        throttle?: Partial<Throttle> & {
            driver?: 'memory' | 'redis';
        };
    };
    redis?: {
        host: string;
        port: string;
        username?: string;
        password?: string;
        db?: string;
        prefix?: string;
    };
    guild: {
        [key: number]: {
            role: string;
            lang?: Partial<Lang, true>;
            throttle?: Partial<Throttle>;
        };
    };
    lang?: Partial<Lang, true>;
}

type Dot<T extends object, P extends string = ''> = {
    [K in keyof T]: K extends string | number
        ? (T[K] extends object ? Dot<T[K], `${P}${K}.`> : {}) & {
              [key in `${P}${K}`]: T[K];
          }
        : never;
}[keyof T];

type U2I<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type DotConfig = U2I<Dot<Required<Config, true>>>;

function get(obj: Config, key: string): any {
    const keys = key.split('.');
    const last = keys.pop()!;
    const o = keys.reduce((o, k) => o[k] ?? {}, obj as any);
    return o[last];
}

function set(obj: Config, key: string, value: any): void {
    const keys = key.split('.');
    const last = keys.pop()!;
    const o = keys.reduce((o, k) => o[k] ?? (o[k] = {}), obj as any);
    o[last] = value;
}

const staticKeys = new Set<string>([
    'discord.token',
    'captcha.bin',
    'captcha.expires',
    'captcha.driver',
    'captcha.throttle.driver',
    'captcha.throttle.attempts',
    'captcha.throttle.expires',
    'captcha.throttle.ban',
    'redis.host',
    'redis.port',
    'redis.username',
    'redis.password',
    'redis.db',
    'redis.prefix',
    'lang.message.verify',
    'lang.message.captcha',
    'lang.message.success',
    'lang.message.failed',
    'lang.message.throttle',
    'lang.button.verify',
]);

const guildPrefix = /^guild\.\d+\./;
const guildKeys = new Set<string>([
    'role',
    'lang.message.verify',
    'lang.message.captcha',
    'lang.message.success',
    'lang.message.failed',
    'lang.message.throttle',
    'lang.button.verify',
    'throttle.expires',
    'throttle.ban',
    'throttle.attempts',
]);

function validateKey(key: string): key is keyof DotConfig {
    if (staticKeys.has(key)) return true;
    if (guildPrefix.test(key)) {
        key = key.replace(guildPrefix, '');
        return guildKeys.has(key);
    }
    return false;
}

export type ConfigFunction = {
    <K extends keyof DotConfig>(key: K): DotConfig[K];
    <K extends keyof DotConfig>(key: K, def: DotConfig[K] | undefined): DotConfig[K];
};

function* travelKeys(obj: object, prefix: string = ''): IterableIterator<[string, string]> {
    for (const [key, value] of Object.entries(obj)) {
        const k = prefix + key;
        if (typeof value === 'object') {
            yield* travelKeys(value, k + '.');
        } else {
            yield [k, value];
        }
    }
}

export async function loadConfig(args: string[], configFile?: string): Promise<ConfigFunction> {
    let config: Config = {} as any;
    if (configFile) {
        if (!(await Bun.file(configFile).exists())) {
            throw new ConfigError(`config file not found: ${configFile}`);
        }
        const ext = extname(configFile).toLowerCase();
        switch (ext) {
            case '.json':
                config = await Bun.file(configFile).json();
                break;
            case '.yaml':
            case '.yml':
                config = parse(await Bun.file(configFile).text());
                break;
            default:
                throw new ConfigError(`unsupported config file type: ${ext}`);
        }
    }
    for (const [key, _] of travelKeys(config)) {
        if (!validateKey(key)) {
            throw new ConfigError(`[config] invalid key from file: ${key}`);
        }
        if (typeof get(config, key) !== 'string') {
            throw new ConfigError(`[config] value of ${key} is must be a string`);
        }
    }
    for (const [env, val] of Object.entries(process.env)) {
        if (!env.startsWith(ENV_PREFIX)) continue;
        const key = env.slice(ENV_PREFIX.length).replace(/_/g, '.').toLowerCase();
        if (!validateKey(key)) {
            console.warn(`[config] invalid key from env: ${key}`);
            continue;
        }
        set(config, key, val);
    }
    for (const arg of args) {
        const [key, value] = arg.split('=', 2);
        if (!key || !value) continue;
        if (!validateKey(key)) {
            console.warn(`[config] invalid key from arguments: ${key}`);
            continue;
        }
        set(config, key, value);
    }
    let flat = new Map();
    return function (key: string, def?: any) {
        if (flat.has(key)) return flat.get(key);
        const value = get(config, key);
        if (value === undefined) {
            if (arguments.length == 1) {
                throw new ConfigError(`missing required key: ${key}`);
            }
            flat.set(key, def);
            return def;
        }
        flat.set(key, value);
        return value;
    };
}

export const kConfig = createContextKey<ConfigFunction>('config');
