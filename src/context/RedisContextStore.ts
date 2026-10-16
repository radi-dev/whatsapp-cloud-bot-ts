/**
 * Redis-backed context store.
 *
 * Bring your own connected client — the library has no Redis dependency. Both
 * popular drivers are supported out of the box:
 *
 * ```typescript
 * // ioredis
 * import Redis from 'ioredis';
 * const store = new RedisContextStore(new Redis(process.env.REDIS_URL));
 *
 * // node-redis (v4+) — remember to connect first
 * import { createClient } from 'redis';
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 * const store = new RedisContextStore(redis, { ttlSeconds: 3600 });
 * ```
 *
 * Layout: one hash per user at `<namespace>:<userId>` with fields `data`
 * (JSON document) and `version` (optimistic-lock counter). Reads and
 * compare-and-set writes run as small Lua scripts so that the version check
 * and the write are atomic on the server, which is what makes concurrent
 * handlers on different servers safe. The TTL (if configured) is applied
 * natively by Redis on every write/touch. Requires Redis >= 4.0 (multi-field
 * `HSET`).
 *
 * Any other client can be used by supplying `options.eval`, a function that
 * runs a Lua script with the given keys and arguments.
 */

import type { UserContextData } from '../types/index.js';
import type {
  ContextRecord,
  ContextStore,
  ContextStoreOptions,
} from './ContextStore.js';
import { ContextStoreError, resolveStoreOptions } from './ContextStore.js';

/**
 * Runs a Lua script. Supplied via {@link RedisContextStoreOptions.eval} for
 * clients whose `eval` signature differs from ioredis / node-redis.
 */
export type RedisEvalFunction = (
  script: string,
  keys: string[],
  args: string[]
) => Promise<unknown>;

/**
 * The subset of a Redis client the store relies on. Structurally satisfied by
 * `ioredis` and `redis` (node-redis v4+) instances.
 */
export interface RedisLikeClient {
  eval(...args: any[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  /** Present on ioredis only — used to detect the `eval` calling convention. */
  defineCommand?: unknown;
}

export interface RedisContextStoreOptions extends ContextStoreOptions {
  /**
   * Override how Lua scripts are executed. Auto-detected for ioredis
   * (`eval(script, numKeys, ...keys, ...args)`) and node-redis
   * (`eval(script, { keys, arguments })`); required for other clients.
   */
  eval?: RedisEvalFunction;
}

/** Returns `[data, version]` (both nil when the key is missing). */
const GET_SCRIPT = `return redis.call('HMGET', KEYS[1], 'data', 'version')`;

/**
 * Compare-and-set write.
 * KEYS[1] = key; ARGV[1] = expected version ('' = unconditional, '0' = insert
 * only); ARGV[2] = JSON data; ARGV[3] = ttl seconds (0 = none).
 * Returns the new version, or 0 on conflict.
 */
const SET_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], 'version')
local expected = ARGV[1]
local newv
if expected == '' then
  newv = (tonumber(cur) or 0) + 1
elseif expected == '0' then
  if cur then return 0 end
  newv = 1
else
  if cur ~= expected then return 0 end
  newv = tonumber(expected) + 1
end
redis.call('HSET', KEYS[1], 'data', ARGV[2], 'version', tostring(newv))
local ttl = tonumber(ARGV[3])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[1], ttl)
else
  redis.call('PERSIST', KEYS[1])
end
return newv`;

/**
 * Compare-and-delete. ARGV[1] = expected version.
 * Returns 1 if a record with that version was deleted, 0 otherwise (version
 * mismatch or already gone).
 */
const DELETE_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], 'version')
if not cur or cur ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1`;

export class RedisContextStore implements ContextStore {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;
  private readonly ttlSeconds?: number;
  private readonly evalScript: RedisEvalFunction;

  constructor(client: RedisLikeClient, options: RedisContextStoreOptions = {}) {
    if (
      !client ||
      typeof client.eval !== 'function' ||
      typeof client.del !== 'function' ||
      typeof client.expire !== 'function'
    ) {
      throw new ContextStoreError(
        'RedisContextStore expects a promise-based Redis client exposing ' +
          'eval/del/expire (e.g. ioredis or node-redis v4+).'
      );
    }
    const { namespace, ttlSeconds } = resolveStoreOptions(options);
    this.client = client;
    this.prefix = `${namespace}:`;
    this.ttlSeconds = ttlSeconds;
    this.evalScript = options.eval ?? RedisContextStore.detectEval(client);
  }

  /** The Redis key used for a given user. */
  keyFor(userId: string): string {
    return `${this.prefix}${userId}`;
  }

  async get(userId: string): Promise<ContextRecord | undefined> {
    const result = (await this.evalScript(
      GET_SCRIPT,
      [this.keyFor(userId)],
      []
    )) as Array<string | null> | null;
    const raw = result?.[0];
    const version = result?.[1];
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      return { data: JSON.parse(raw), version: Number(version ?? 0) };
    } catch {
      throw new ContextStoreError(
        `Corrupt context document for user "${userId}" (not valid JSON).`
      );
    }
  }

  async set(
    userId: string,
    data: UserContextData,
    expectedVersion?: number
  ): Promise<boolean> {
    const result = await this.evalScript(
      SET_SCRIPT,
      [this.keyFor(userId)],
      [
        expectedVersion === undefined ? '' : String(expectedVersion),
        JSON.stringify(data),
        String(this.ttlSeconds ?? 0),
      ]
    );
    return Number(result) > 0;
  }

  async delete(userId: string, expectedVersion?: number): Promise<boolean> {
    if (expectedVersion === undefined) {
      await this.client.del(this.keyFor(userId));
      return true;
    }
    const result = await this.evalScript(
      DELETE_SCRIPT,
      [this.keyFor(userId)],
      [String(expectedVersion)]
    );
    return Number(result) === 1;
  }

  async touch(userId: string): Promise<void> {
    if (this.ttlSeconds === undefined) {
      return;
    }
    await this.client.expire(this.keyFor(userId), this.ttlSeconds);
  }

  /**
   * Pick the `eval` calling convention for the client: ioredis takes
   * `(script, numKeys, ...keys, ...args)`, node-redis takes
   * `(script, { keys, arguments })`.
   */
  private static detectEval(client: RedisLikeClient): RedisEvalFunction {
    if (typeof client.defineCommand === 'function') {
      return (script, keys, args) =>
        client.eval(script, keys.length, ...keys, ...args);
    }
    return (script, keys, args) =>
      client.eval(script, { keys, arguments: args });
  }
}
