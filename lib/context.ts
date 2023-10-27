import { Client } from 'discord.js';

export class ContextError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ContextError';
    }
}

export class Context {
    #values = new Map<any, unknown>();

    set<T>(key: ContextKey<T>, value: T) {
        this.#values.set(key, value);
        return this;
    }

    get<T>(key: ContextKey<T>): T {
        if (!this.#values.has(key)) {
            throw new ContextError(`Context key ${key} not found`);
        }
        return this.#values.get(key) as T;
    }

    has(key: ContextKey<any>): boolean {
        return this.#values.has(key);
    }
}

class ContextKey<_> {
    #name: string;

    constructor(name: string) {
        this.#name = name;
    }

    toString() {
        return this.#name;
    }
}

export type ContextValue<T> = T extends ContextKey<infer U> ? U : never;

export function createContextKey<T>(name: string): ContextKey<T> {
    return new ContextKey<T>(name);
}

export const kClient = createContextKey<Client>('discord.client');
