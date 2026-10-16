import { jest } from '@jest/globals';
import {
  ContextStoreError,
  resolveStoreOptions,
} from '../src/context/ContextStore.js';
import type { ContextStore } from '../src/context/ContextStore.js';
import { MemoryContextStore } from '../src/context/MemoryContextStore.js';
import { RedisContextStore } from '../src/context/RedisContextStore.js';
import {
  PostgresContextStore,
  MySqlContextStore,
  SqliteContextStore,
} from '../src/context/SqlContextStore.js';
import type { SqliteSyncDatabase } from '../src/context/SqlContextStore.js';

// -----------------------------------------------------------------------------
// Shared contract — every adapter must satisfy these
// -----------------------------------------------------------------------------

function contractTests(
  name: string,
  factory: (opts?: { ttlSeconds?: number }) => Promise<ContextStore>
): void {
  describe(`${name} — ContextStore contract`, () => {
    it('returns undefined for an unknown user', async () => {
      const store = await factory();
      expect(await store.get('nobody')).toBeUndefined();
    });

    it('round-trips a JSON document (including unicode and nesting) with version 1', async () => {
      const store = await factory();
      const doc = {
        step: 1,
        name: 'Ada 🚀',
        nested: { list: [1, 'two', null] },
      };
      expect(await store.set('111', doc, 0)).toBe(true);
      expect(await store.get('111')).toEqual({ data: doc, version: 1 });
    });

    it('unconditional set() replaces the whole document and bumps the version', async () => {
      const store = await factory();
      await store.set('111', { a: 1, b: 2 });
      await store.set('111', { c: 3 });
      expect(await store.get('111')).toEqual({ data: { c: 3 }, version: 2 });
    });

    it('isolates users', async () => {
      const store = await factory();
      await store.set('111', { me: 1 }, 0);
      await store.set('222', { me: 2 }, 0);
      expect((await store.get('111'))?.data).toEqual({ me: 1 });
      expect((await store.get('222'))?.data).toEqual({ me: 2 });
    });

    it('delete() removes the document and is a no-op when absent', async () => {
      const store = await factory();
      await store.set('111', { a: 1 }, 0);
      expect(await store.delete('111')).toBe(true);
      expect(await store.get('111')).toBeUndefined();
      expect(await store.delete('111')).toBe(true);
    });

    describe('optimistic locking', () => {
      it('insert-only write (expected 0) fails once a record exists', async () => {
        const store = await factory();
        expect(await store.set('111', { a: 1 }, 0)).toBe(true);
        expect(await store.set('111', { a: 2 }, 0)).toBe(false);
        expect(await store.get('111')).toEqual({ data: { a: 1 }, version: 1 });
      });

      it('update succeeds only with the current version and increments it', async () => {
        const store = await factory();
        await store.set('111', { a: 1 }, 0);
        expect(await store.set('111', { a: 2 }, 1)).toBe(true);
        expect(await store.get('111')).toEqual({ data: { a: 2 }, version: 2 });
        expect(await store.set('111', { a: 3 }, 1)).toBe(false); // stale
        expect(await store.set('111', { a: 3 }, 3)).toBe(false); // future
        expect(await store.get('111')).toEqual({ data: { a: 2 }, version: 2 });
      });

      it('update fails when the record no longer exists', async () => {
        const store = await factory();
        await store.set('111', { a: 1 }, 0);
        await store.delete('111');
        expect(await store.set('111', { a: 2 }, 1)).toBe(false);
        expect(await store.get('111')).toBeUndefined();
      });

      it('conditional delete succeeds only on an exact version match (absent = conflict)', async () => {
        const store = await factory();
        await store.set('111', { a: 1 }, 0);
        await store.set('111', { a: 2 }, 1); // now v2
        expect(await store.delete('111', 1)).toBe(false);
        expect(await store.get('111')).toEqual({ data: { a: 2 }, version: 2 });
        expect(await store.delete('111', 2)).toBe(true);
        expect(await store.get('111')).toBeUndefined();
        expect(await store.delete('111', 2)).toBe(false); // gone -> someone else changed it
        expect(await store.delete('111')).toBe(true); // unconditional is always fine
      });

      it('an unconditional upsert after a delete restarts at version 1', async () => {
        const store = await factory();
        await store.set('111', { a: 1 }, 0);
        await store.delete('111');
        await store.set('111', { a: 9 });
        expect(await store.get('111')).toEqual({ data: { a: 9 }, version: 1 });
      });

      it('serialises a burst of concurrent read-modify-write cycles without losing updates', async () => {
        const store = await factory();
        const workers = 25;
        let conflicts = 0;
        await Promise.all(
          Array.from({ length: workers }, async () => {
            for (;;) {
              const rec = await store.get('counter');
              const count = (rec?.data.count ?? 0) + 1;
              if (await store.set('counter', { count }, rec?.version ?? 0))
                return;
              conflicts++;
            }
          })
        );
        expect(await store.get('counter')).toEqual({
          data: { count: workers },
          version: workers,
        });
        expect(conflicts).toBeGreaterThanOrEqual(0);
      });
    });

    it('expires documents after ttlSeconds', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      try {
        const store = await factory({ ttlSeconds: 10 });
        await store.set('111', { a: 1 }, 0);
        jest.setSystemTime(1_000_000 + 9_000);
        expect((await store.get('111'))?.data).toEqual({ a: 1 });
        jest.setSystemTime(1_000_000 + 10_001);
        expect(await store.get('111')).toBeUndefined();
        // An expired record does not block a fresh insert
        expect(await store.set('111', { b: 1 }, 0)).toBe(true);
        expect(await store.get('111')).toEqual({ data: { b: 1 }, version: 1 });
      } finally {
        jest.useRealTimers();
      }
    });

    it('touch() extends the TTL without rewriting the document or bumping the version', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      try {
        const store = await factory({ ttlSeconds: 10 });
        await store.set('111', { a: 1 }, 0);
        jest.setSystemTime(1_000_000 + 8_000);
        await store.touch!('111');
        jest.setSystemTime(1_000_000 + 15_000);
        expect(await store.get('111')).toEqual({ data: { a: 1 }, version: 1 });
      } finally {
        jest.useRealTimers();
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Fakes for the external drivers (the real ones are not dependencies)
// -----------------------------------------------------------------------------

/**
 * Emulates ioredis / node-redis: a hash per key with TTL via the fake clock,
 * and an `eval` that recognises the store's three Lua scripts and applies
 * their semantics in JS. (The Lua itself is exercised against ioredis-mock /
 * a real Redis outside the unit tests.)
 */
function makeFakeRedis(shape: 'ioredis' | 'node-redis') {
  const hashes = new Map<string, { data: string; version: number }>();
  const expiry = new Map<string, number>();
  const calls: string[] = [];
  const live = (k: string) => {
    const exp = expiry.get(k);
    if (exp !== undefined && exp <= Date.now()) {
      hashes.delete(k);
      expiry.delete(k);
    }
    return hashes.get(k);
  };
  const runScript = (
    script: string,
    keys: string[],
    args: string[]
  ): unknown => {
    const key = keys[0];
    const cur = live(key);
    if (script.includes('HMGET')) {
      calls.push('eval:get');
      return cur ? [cur.data, String(cur.version)] : [null, null];
    }
    if (script.includes('HSET')) {
      calls.push('eval:set');
      const [expected, data, ttl] = args;
      let newv: number;
      if (expected === '') newv = (cur?.version ?? 0) + 1;
      else if (expected === '0') {
        if (cur) return 0;
        newv = 1;
      } else {
        if (!cur || String(cur.version) !== expected) return 0;
        newv = Number(expected) + 1;
      }
      hashes.set(key, { data, version: newv });
      if (Number(ttl) > 0) expiry.set(key, Date.now() + Number(ttl) * 1000);
      else expiry.delete(key);
      return newv;
    }
    if (script.includes('DEL')) {
      calls.push('eval:delete');
      if (!cur || String(cur.version) !== args[0]) return 0;
      hashes.delete(key);
      expiry.delete(key);
      return 1;
    }
    throw new Error('unknown script');
  };
  const base = {
    calls,
    _hashes: hashes,
    async del(k: string) {
      calls.push('del');
      const had = hashes.delete(k);
      expiry.delete(k);
      return had ? 1 : 0;
    },
    async expire(k: string, s: number) {
      calls.push('expire');
      if (!live(k)) return 0;
      expiry.set(k, Date.now() + s * 1000);
      return 1;
    },
  };
  if (shape === 'ioredis') {
    return Object.assign(base, {
      defineCommand() {},
      async eval(script: string, numKeys: number, ...rest: string[]) {
        return runScript(script, rest.slice(0, numKeys), rest.slice(numKeys));
      },
    });
  }
  return Object.assign(base, {
    async eval(
      script: string,
      options: { keys?: string[]; arguments?: string[] }
    ) {
      return runScript(script, options.keys ?? [], options.arguments ?? []);
    },
  });
}

/**
 * A tiny SQL engine that understands exactly the statements the SQL stores
 * emit, so we can assert on dialect-specific SQL text, parameter order and
 * affected-row handling without a database. Supports per-dialect quirks (pg
 * returns BIGINT as string; mysql2 returns [rows|header, fields]).
 */
function makeFakeSqlEngine() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const log: Array<{ sql: string; params: unknown[] }> = [];

  function exec(
    sql: string,
    params: unknown[],
    opts: { bigintAsString?: boolean } = {}
  ): { rows: Record<string, unknown>[]; affected: number } {
    log.push({ sql, params });
    const norm = sql.replace(/\$\d+/g, '?');
    const big = (v: unknown) =>
      opts.bigintAsString && v !== null && v !== undefined ? String(v) : v;
    let m: RegExpMatchArray | null;

    if ((m = norm.match(/^CREATE TABLE IF NOT EXISTS (\S+) /))) {
      if (!tables.has(m[1])) tables.set(m[1], new Map());
      return { rows: [], affected: 0 };
    }
    if (
      (m = norm.match(
        /^SELECT data, version, expires_at FROM (\S+) WHERE user_id = \?$/
      ))
    ) {
      const row = tables.get(m[1])?.get(String(params[0]));
      if (!row) return { rows: [], affected: 0 };
      return {
        rows: [
          {
            data: row.data,
            version: big(row.version),
            expires_at: big(row.expires_at),
          },
        ],
        affected: 0,
      };
    }
    if (
      (m = norm.match(
        /^INSERT INTO (\S+) \(user_id, data, version, expires_at, updated_at\) VALUES \(\?, \?, 1, \?, \?\) ON CONFLICT \(user_id\) DO UPDATE SET/
      )) ||
      (m = norm.match(
        /^INSERT INTO (\S+) \(user_id, data, version, expires_at, updated_at\) VALUES \(\?, \?, 1, \?, \?\) ON DUPLICATE KEY UPDATE/
      ))
    ) {
      const [user_id, data, expires_at, updated_at] = params;
      const t = tables.get(m[1])!;
      const existing = t.get(String(user_id));
      t.set(String(user_id), {
        user_id,
        data,
        expires_at,
        updated_at,
        version: existing ? (existing.version as number) + 1 : 1,
      });
      return { rows: [], affected: existing ? 2 : 1 };
    }
    if (
      (m = norm.match(
        /^INSERT (?:IGNORE )?INTO (\S+) \(user_id, data, version, expires_at, updated_at\) VALUES \(\?, \?, 1, \?, \?\)(?: ON CONFLICT \(user_id\) DO NOTHING)?$/
      ))
    ) {
      const [user_id, data, expires_at, updated_at] = params;
      const t = tables.get(m[1])!;
      if (t.has(String(user_id))) return { rows: [], affected: 0 };
      t.set(String(user_id), {
        user_id,
        data,
        expires_at,
        updated_at,
        version: 1,
      });
      return { rows: [], affected: 1 };
    }
    if (
      (m = norm.match(
        /^UPDATE (\S+) SET data = \?, version = version \+ 1, expires_at = \?, updated_at = \? WHERE user_id = \? AND version = \?$/
      ))
    ) {
      const [data, expires_at, updated_at, user_id, version] = params;
      const row = tables.get(m[1])!.get(String(user_id));
      if (!row || row.version !== version) return { rows: [], affected: 0 };
      Object.assign(row, {
        data,
        expires_at,
        updated_at,
        version: (version as number) + 1,
      });
      return { rows: [], affected: 1 };
    }
    if (
      (m = norm.match(
        /^DELETE FROM (\S+) WHERE user_id = \? AND version = \?$/
      ))
    ) {
      const row = tables.get(m[1])!.get(String(params[0]));
      if (!row || row.version !== params[1]) return { rows: [], affected: 0 };
      tables.get(m[1])!.delete(String(params[0]));
      return { rows: [], affected: 1 };
    }
    if ((m = norm.match(/^DELETE FROM (\S+) WHERE user_id = \?$/))) {
      const had = tables.get(m[1])!.delete(String(params[0]));
      return { rows: [], affected: had ? 1 : 0 };
    }
    if (
      (m = norm.match(
        /^DELETE FROM (\S+) WHERE user_id = \? AND expires_at IS NOT NULL AND expires_at <= \?$/
      ))
    ) {
      const t = tables.get(m[1])!;
      const row = t.get(String(params[0]));
      if (
        row &&
        row.expires_at !== null &&
        (row.expires_at as number) <= (params[1] as number)
      ) {
        t.delete(String(params[0]));
        return { rows: [], affected: 1 };
      }
      return { rows: [], affected: 0 };
    }
    if (
      (m = norm.match(/^UPDATE (\S+) SET expires_at = \? WHERE user_id = \?$/))
    ) {
      const row = tables.get(m[1])!.get(String(params[1]));
      if (row) row.expires_at = params[0];
      return { rows: [], affected: row ? 1 : 0 };
    }
    if (
      (m = norm.match(
        /^DELETE FROM (\S+) WHERE expires_at IS NOT NULL AND expires_at <= \?$/
      ))
    ) {
      const t = tables.get(m[1])!;
      let n = 0;
      for (const [k, row] of t) {
        if (
          row.expires_at !== null &&
          (row.expires_at as number) <= (params[0] as number)
        ) {
          t.delete(k);
          n++;
        }
      }
      return { rows: [], affected: n };
    }
    throw new Error(`fake SQL engine: unsupported statement: ${sql}`);
  }

  return { exec, log, tables };
}

function makeFakePg() {
  const engine = makeFakeSqlEngine();
  return {
    engine,
    client: {
      async query(text: string, values: unknown[] = []) {
        const { rows, affected } = engine.exec(text, values, {
          bigintAsString: true,
        });
        return { rows, rowCount: affected };
      },
    },
  };
}

/** mysql2 returns row arrays for SELECT and a ResultSetHeader otherwise. */
function mysqlResult(
  result: { rows: Record<string, unknown>[]; affected: number },
  sql: string
): unknown {
  return /^\s*SELECT\s/i.test(sql)
    ? result.rows
    : { affectedRows: result.affected, insertId: 0, warningStatus: 0 };
}

function makeFakeMysql() {
  const engine = makeFakeSqlEngine();
  const used: string[] = [];
  return {
    engine,
    used,
    client: {
      async query(
        sql: string,
        values: unknown[] = []
      ): Promise<[unknown, unknown]> {
        used.push('query');
        return [mysqlResult(engine.exec(sql, values), sql), []];
      },
      async execute(
        sql: string,
        values: unknown[] = []
      ): Promise<[unknown, unknown]> {
        used.push('execute');
        if (values.some((v) => v === undefined)) {
          throw new Error('Bind parameters must not contain undefined');
        }
        return [mysqlResult(engine.exec(sql, values), sql), []];
      },
    },
  };
}

/** Real SQLite via Node's built-in module when available (Node ≥ 22.5). */
function loadNodeSqlite():
  { DatabaseSync: new (path: string) => SqliteSyncDatabase } | undefined {
  const getBuiltin = (
    process as unknown as {
      getBuiltinModule?: (id: string) => unknown;
    }
  ).getBuiltinModule;
  try {
    return getBuiltin?.('node:sqlite') as
      { DatabaseSync: new (path: string) => SqliteSyncDatabase } | undefined;
  } catch {
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Contract runs
// -----------------------------------------------------------------------------

contractTests(
  'MemoryContextStore',
  async (opts) => new MemoryContextStore(opts)
);

contractTests(
  'RedisContextStore (ioredis shape)',
  async (opts) => new RedisContextStore(makeFakeRedis('ioredis'), opts)
);
contractTests(
  'RedisContextStore (node-redis shape)',
  async (opts) => new RedisContextStore(makeFakeRedis('node-redis'), opts)
);

contractTests(
  'PostgresContextStore (fake pg)',
  async (opts) => new PostgresContextStore(makeFakePg().client, opts)
);
contractTests(
  'MySqlContextStore (fake mysql2)',
  async (opts) => new MySqlContextStore(makeFakeMysql().client, opts)
);

const nodeSqlite = loadNodeSqlite();
if (nodeSqlite) {
  contractTests(
    'SqliteContextStore (node:sqlite, sync prepare API)',
    async (opts) =>
      new SqliteContextStore(new nodeSqlite.DatabaseSync(':memory:'), opts)
  );
  contractTests(
    'SqliteContextStore (async `sqlite`-package shape)',
    async (opts) => {
      const db = new nodeSqlite.DatabaseSync(':memory:');
      const asyncDb = {
        all: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).all(...params),
        run: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).run(...params),
      };
      return new SqliteContextStore(asyncDb, opts);
    }
  );
} else {
  // eslint-disable-next-line no-console
  console.warn(
    'node:sqlite unavailable on this Node version — skipping real SQLite tests'
  );
}

// -----------------------------------------------------------------------------
// Adapter-specific behaviour
// -----------------------------------------------------------------------------

describe('resolveStoreOptions', () => {
  it('defaults the namespace', () => {
    expect(resolveStoreOptions()).toEqual({
      namespace: 'wa_user_context',
      ttlSeconds: undefined,
    });
  });

  it('accepts schema-qualified namespaces', () => {
    expect(resolveStoreOptions({ namespace: 'public.ctx_1' }).namespace).toBe(
      'public.ctx_1'
    );
  });

  it.each(['x; drop table', 'bad-name', '1abc', 'a.b.c', ''])(
    'rejects unsafe namespace %p',
    (namespace) => {
      expect(() => resolveStoreOptions({ namespace })).toThrow(
        ContextStoreError
      );
    }
  );

  it.each([0, -5, NaN, Infinity])(
    'rejects invalid ttlSeconds %p',
    (ttlSeconds) => {
      expect(() => resolveStoreOptions({ ttlSeconds })).toThrow(
        ContextStoreError
      );
    }
  );
});

describe('RedisContextStore specifics', () => {
  it('validates the client shape', () => {
    expect(() => new RedisContextStore({} as never)).toThrow(ContextStoreError);
  });

  it('namespaces keys', () => {
    const store = new RedisContextStore(makeFakeRedis('ioredis'), {
      namespace: 'bot_a',
    });
    expect(store.keyFor('123')).toBe('bot_a:123');
  });

  it('passes the TTL into the CAS script and uses EXPIRE for touch', async () => {
    const redis = makeFakeRedis('ioredis');
    const store = new RedisContextStore(redis, { ttlSeconds: 5 });
    await store.set('1', { a: 1 }, 0);
    await store.touch('1');
    expect(redis.calls).toEqual(['eval:set', 'expire']);
  });

  it('touch() is a no-op without a TTL', async () => {
    const redis = makeFakeRedis('ioredis');
    await new RedisContextStore(redis).touch('1');
    expect(redis.calls).toEqual([]);
  });

  it('unconditional delete uses DEL directly; conditional delete goes through the script', async () => {
    const redis = makeFakeRedis('ioredis');
    const store = new RedisContextStore(redis);
    await store.delete('1');
    await store.delete('1', 1);
    expect(redis.calls).toEqual(['del', 'eval:delete']);
  });

  it('accepts a custom eval implementation for other clients', async () => {
    const seen: Array<{ keys: string[]; args: string[] }> = [];
    const inner = makeFakeRedis('ioredis');
    const client = {
      eval: async () => null,
      del: inner.del,
      expire: inner.expire,
    };
    const store = new RedisContextStore(client, {
      eval: async (script, keys, args) => {
        seen.push({ keys, args });
        return inner.eval(script, keys.length, ...keys, ...args);
      },
    });
    await store.set('7', { a: 1 }, 0);
    expect(seen[0]).toEqual({
      keys: ['wa_user_context:7'],
      args: ['0', '{"a":1}', '0'],
    });
    expect(await store.get('7')).toEqual({ data: { a: 1 }, version: 1 });
  });

  it('surfaces corrupt JSON as ContextStoreError', async () => {
    const redis = makeFakeRedis('ioredis');
    redis._hashes.set('wa_user_context:1', { data: '{not json', version: 1 });
    await expect(new RedisContextStore(redis).get('1')).rejects.toThrow(
      ContextStoreError
    );
  });
});

describe('PostgresContextStore specifics', () => {
  it('validates the client shape', () => {
    expect(() => new PostgresContextStore({} as never)).toThrow(
      ContextStoreError
    );
  });

  it('emits the expected SQL with $n placeholders', async () => {
    const { client, engine } = makeFakePg();
    const store = new PostgresContextStore(client, {
      namespace: 'ctx',
      ttlSeconds: 60,
    });
    await store.set('111', { a: 1 }); // unconditional upsert
    await store.set('222', { a: 1 }, 0); // insert-only
    await store.set('222', { a: 2 }, 1); // versioned update
    await store.get('111');
    await store.touch('111');
    await store.delete('111'); // unconditional
    await store.delete('222', 2); // versioned
    await store.purgeExpired();

    const sqls = engine.log.map((l) => l.sql);
    expect(sqls).toEqual([
      'CREATE TABLE IF NOT EXISTS ctx (user_id VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, version BIGINT NOT NULL, expires_at BIGINT NULL, updated_at BIGINT NOT NULL)',
      'INSERT INTO ctx (user_id, data, version, expires_at, updated_at) VALUES ($1, $2, 1, $3, $4) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, version = ctx.version + 1, expires_at = excluded.expires_at, updated_at = excluded.updated_at',
      'INSERT INTO ctx (user_id, data, version, expires_at, updated_at) VALUES ($1, $2, 1, $3, $4) ON CONFLICT (user_id) DO NOTHING',
      'UPDATE ctx SET data = $1, version = version + 1, expires_at = $2, updated_at = $3 WHERE user_id = $4 AND version = $5',
      'SELECT data, version, expires_at FROM ctx WHERE user_id = $1',
      'UPDATE ctx SET expires_at = $1 WHERE user_id = $2',
      'DELETE FROM ctx WHERE user_id = $1',
      'DELETE FROM ctx WHERE user_id = $1 AND version = $2',
      'DELETE FROM ctx WHERE expires_at IS NOT NULL AND expires_at <= $1',
    ]);
    expect(engine.log[1].params).toEqual([
      '111',
      '{"a":1}',
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(engine.log[3].params).toEqual([
      '{"a":2}',
      expect.any(Number),
      expect.any(Number),
      '222',
      1,
    ]);
  });

  it('writes NULL expires_at when no TTL is configured', async () => {
    const { client, engine } = makeFakePg();
    await new PostgresContextStore(client).set('111', { a: 1 });
    expect(engine.log[1].params[2]).toBeNull();
  });

  it('parses BIGINT strings from pg into numbers', async () => {
    const { client } = makeFakePg();
    const store = new PostgresContextStore(client);
    await store.set('1', { a: 1 }, 0);
    const rec = await store.get('1');
    expect(typeof rec?.version).toBe('number');
    expect(rec?.version).toBe(1);
  });

  it('creates the table only once per store instance', async () => {
    const { client, engine } = makeFakePg();
    const store = new PostgresContextStore(client);
    await Promise.all([store.get('1'), store.get('2'), store.set('3', {})]);
    await store.get('4');
    expect(engine.log.filter((l) => l.sql.startsWith('CREATE')).length).toBe(1);
  });

  it('skips DDL with autoCreateTable: false', async () => {
    const { client, engine } = makeFakePg();
    const store = new PostgresContextStore(client, { autoCreateTable: false });
    await store.setup(); // explicit
    await store.get('1');
    expect(engine.log.map((l) => l.sql.split(' ')[0])).toEqual([
      'CREATE',
      'SELECT',
    ]);
  });

  it('only reaps an expired row if it is still expired (no race with a concurrent refresh)', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const { client, engine } = makeFakePg();
      const store = new PostgresContextStore(client, { ttlSeconds: 1 });
      await store.set('1', { a: 1 }, 0);
      jest.setSystemTime(1_000_000 + 5_000);
      engine.log.length = 0;
      expect(await store.get('1')).toBeUndefined();
      expect(engine.log[1].sql).toBe(
        'DELETE FROM wa_user_context WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at <= $2'
      );
      expect(engine.log[1].params).toEqual(['1', 1_005_000]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries table creation after a failure', async () => {
    let fail = true;
    const { client, engine } = makeFakePg();
    const flaky = {
      async query(text: string, values: unknown[]) {
        if (fail && text.startsWith('CREATE')) {
          fail = false;
          throw new Error('connection reset');
        }
        return client.query(text, values);
      },
    };
    const store = new PostgresContextStore(flaky);
    await expect(store.get('1')).rejects.toThrow('connection reset');
    await expect(store.get('1')).resolves.toBeUndefined();
    expect(engine.log.filter((l) => l.sql.startsWith('CREATE')).length).toBe(1);
  });

  it('surfaces corrupt JSON as ContextStoreError', async () => {
    const { client, engine } = makeFakePg();
    const store = new PostgresContextStore(client);
    await store.set('1', { ok: true }, 0);
    engine.tables.get('wa_user_context')!.get('1')!.data = '{broken';
    await expect(store.get('1')).rejects.toThrow(ContextStoreError);
  });
});

describe('MySqlContextStore specifics', () => {
  it('validates the client shape', () => {
    expect(() => new MySqlContextStore({} as never)).toThrow(ContextStoreError);
  });

  it('uses ? placeholders, ON DUPLICATE KEY UPDATE / INSERT IGNORE and MEDIUMTEXT/utf8mb4', async () => {
    const { client, engine } = makeFakeMysql();
    const store = new MySqlContextStore(client, { namespace: 'ctx' });
    await store.set('111', { a: 1 });
    await store.set('222', { a: 1 }, 0);
    await store.set('222', { a: 2 }, 1);
    const sqls = engine.log.map((l) => l.sql);
    expect(sqls).toEqual([
      'CREATE TABLE IF NOT EXISTS ctx (user_id VARCHAR(128) PRIMARY KEY, data MEDIUMTEXT NOT NULL, version BIGINT NOT NULL, expires_at BIGINT NULL, updated_at BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4',
      'INSERT INTO ctx (user_id, data, version, expires_at, updated_at) VALUES (?, ?, 1, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), version = version + 1, expires_at = VALUES(expires_at), updated_at = VALUES(updated_at)',
      'INSERT IGNORE INTO ctx (user_id, data, version, expires_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      'UPDATE ctx SET data = ?, version = version + 1, expires_at = ?, updated_at = ? WHERE user_id = ? AND version = ?',
    ]);
  });

  it('reads affectedRows from the ResultSetHeader', async () => {
    const { client } = makeFakeMysql();
    const store = new MySqlContextStore(client);
    expect(await store.set('1', { a: 1 }, 0)).toBe(true);
    expect(await store.set('1', { a: 1 }, 0)).toBe(false);
    expect(await store.set('1', { a: 2 }, 1)).toBe(true);
    expect(await store.set('1', { a: 3 }, 1)).toBe(false);
  });

  it('uses execute() for DML and query() for DDL, never passing undefined', async () => {
    const { client, used } = makeFakeMysql();
    const store = new MySqlContextStore(client);
    await store.set('111', { a: 1 }); // no TTL -> expires_at must be null, not undefined
    await store.get('111');
    expect(used).toEqual(['query', 'execute', 'execute']);
  });

  it('falls back to query() when execute() is missing', async () => {
    const { client, used } = makeFakeMysql();
    const queryOnly = { query: client.query };
    await new MySqlContextStore(queryOnly).get('1');
    expect(used).toEqual(['query', 'query']);
  });
});

describe('SqliteContextStore specifics', () => {
  it('validates the database shape', () => {
    expect(() => new SqliteContextStore({} as never)).toThrow(
      ContextStoreError
    );
  });

  (nodeSqlite ? it : it.skip)(
    'persists rows with the expected schema',
    async () => {
      const db = new nodeSqlite!.DatabaseSync(':memory:');
      const store = new SqliteContextStore(db, { namespace: 'ctx' });
      await store.set('111', { a: 1 }, 0);
      await store.set('111', { a: 2 }, 1);
      const rows = db
        .prepare('SELECT user_id, data, version, expires_at FROM ctx')
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe('111');
      expect(rows[0].data).toBe('{"a":2}');
      expect(rows[0].version).toBe(2);
      expect(rows[0].expires_at).toBeNull();
    }
  );
});
