import { extname } from 'path';
import { parse } from 'yaml';
import { promises as fs } from 'fs';
import { createContextKey } from './context';
import { ZodError, z } from 'zod';
import parseDuration from 'parse-duration';
import set from 'lodash.set';
import get from 'lodash.get';
import merge from 'lodash.merge';

const envPrefix = 'GUARDBOT_';

type Required<T, DEEP extends boolean = true> = T extends object
    ? {
          [K in keyof T]-?: DEEP extends true ? Required<T[K], true> : T[K];
      }
    : T;

export class ConfigError extends Error {
    validationError?: ZodError;

    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

const DurationSchema = z.string().transform((val, ctx) => {
    if (val === undefined) return undefined;
    const ms = parseDuration(val);
    if (ms === undefined || ms === null || ms <= 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid duration format',
        });
        return undefined;
    }
    return ms;
});

const ConfigSchema = z.object({
    discord: z
        .object({
            token: z.string(),
        })
        .default({} as any),
    captcha: z
        .object({
            bin: z.string().default('captcha'),
            expires: DurationSchema.default('5m'),
            driver: z.enum(['memory', 'redis']).default('memory'),
            throttle: z
                .object({
                    driver: z.enum(['memory', 'redis']).default('memory'),
                    attempts: z.coerce.number().min(1).default(5),
                    expires: DurationSchema.default('30m'),
                    ban: DurationSchema.default('4h'),
                })
                .default({}),
        })
        .default({}),
    redis: z
        .object({
            host: z.string().default('localhost'),
            port: z.coerce.number().min(1).max(65535).default(6379),
            username: z.string().optional(),
            password: z.string().optional(),
            db: z.coerce.number().optional(),
            prefix: z.string().default(''),
        })
        .optional(),
    lang: z
        .object({
            message: z
                .object({
                    verify: z.string().default('Please verify that you are human.'),
                    captcha: z.string().default('Please solve the captcha.'),
                    success: z.string().default('You have been verified.'),
                    failed: z.string().default('You failed to verify.'),
                    throttle: z.string().default('You have been banned for too many attempts.'),
                })
                .default({}),
            button: z
                .object({
                    verify: z.string().default('Verify'),
                })
                .default({}),
        })
        .default({}),
    guild: z
        .record(
            z.string().regex(/^\d+$/, 'Invalid guild ID') as any as z.ZodNumber,
            z.object({
                role: z.string().regex(/^\d+$/, 'Invalid role ID'),
                lang: z
                    .object({
                        message: z
                            .object({
                                verify: z.string().optional(),
                                captcha: z.string().optional(),
                                success: z.string().optional(),
                                failed: z.string().optional(),
                                throttle: z.string().optional(),
                            })
                            .optional(),
                        button: z
                            .object({
                                verify: z.string().optional(),
                            })
                            .optional(),
                    })
                    .optional(),
                throttle: z
                    .object({
                        attempts: z.coerce.number().min(1).optional(),
                        expires: DurationSchema.optional(),
                        ban: DurationSchema.optional(),
                    })
                    .optional(),
            }),
        )
        .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

type Dot<T extends object, P extends string = ''> = {
    [K in keyof T]: K extends string | number
        ? (T[K] extends object ? Dot<T[K], `${P}${K}.`> : {}) & {
              [key in `${P}${K}`]: T[K];
          }
        : never;
}[keyof T];

type U2I<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type DotConfig = U2I<Dot<Required<Config, true>>>;

export type ConfigFunction = {
    <K extends keyof DotConfig>(key: K): DotConfig[K];
    <K extends keyof DotConfig>(key: K, optional: boolean): DotConfig[K] | undefined;
    <K extends keyof DotConfig, F extends keyof DotConfig>(key: K, fallback: F): DotConfig[K];

    readonly data: Config;
};

function deepFreeze(object: object | Function) {
    const propNames = Reflect.ownKeys(object);

    for (const name of propNames) {
        const value = (object as any)[name];

        if ((value && typeof value === 'object') || typeof value === 'function') {
            deepFreeze(value);
        }
    }

    return Object.freeze(object);
}

export async function loadConfig(config: any): Promise<ConfigFunction> {
    const cliConfig = z
        .object({
            file: z.string(),
        })
        .safeParse(config);

    let cfg: any = {};

    if (cliConfig.success) {
        if (!(await fs.exists(cliConfig.data.file))) {
            throw new ConfigError(`config file not found: ${cliConfig.data.file}`);
        }
        const ext = extname(cliConfig.data.file).toLowerCase();
        switch (ext) {
            case '.json':
                cfg = JSON.parse(await fs.readFile(cliConfig.data.file, 'utf-8'));
                break;
            case '.yaml':
            case '.yml':
                cfg = parse(await fs.readFile(cliConfig.data.file, 'utf-8'));
                break;
            default:
                throw new ConfigError(`unsupported config file format: ${ext}`);
        }
    }

    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith(envPrefix)) continue;
        const path = key.slice(envPrefix.length).toLowerCase().replace(/_/g, '.');
        set(cfg, path, value);
    }

    cfg = merge(cfg, config);

    const configSchema = ConfigSchema.safeParse(cfg);

    if (!configSchema.success) {
        const err = new ConfigError('There are errors in the config');
        err.validationError = configSchema.error;
        throw err;
    }

    cfg = configSchema.data;

    deepFreeze(cfg);

    let flat = new Map();
    function getConfig(key: string, fallback: string | true) {
        if (flat.has(key)) return flat.get(key);
        const value = get(cfg, key);
        if (value === undefined) {
            if (arguments.length == 1) {
                throw new ConfigError(`missing required config: ${key}`);
            }
            if (fallback === true) {
                return undefined;
            }
            const def = flat.has(fallback) ? flat.get(fallback) : get(cfg, fallback);
            flat.set(fallback, def);
            flat.set(key, def);
            return def;
        }
        flat.set(key, value);
        return value;
    }
    Object.defineProperty(getConfig, 'data', {
        get() {
            return cfg;
        },
    });
    return getConfig as ConfigFunction;
}

export const kConfig = createContextKey<ConfigFunction>('config');
