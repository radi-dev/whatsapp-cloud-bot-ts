/**
 * Relational-database context stores (PostgreSQL, MySQL/MariaDB, SQLite).
 *
 * All three share one table layout — one row per user holding the JSON
 * document plus an optimistic-lock `version` — and differ only in placeholder
 * style, conditional-insert syntax and the text column type. Bring your own
 * connected driver; the library has no database dependencies.
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS wa_user_context (
 *   user_id    VARCHAR(128) PRIMARY KEY,
 *   data       TEXT         NOT NULL,   -- MEDIUMTEXT on MySQL
 *   version    BIGINT       NOT NULL,   -- optimistic-lock counter, starts at 1
 *   expires_at BIGINT       NULL,       -- epoch milliseconds, NULL = never
 *   updated_at BIGINT       NOT NULL    -- epoch milliseconds
 * )
 * ```
 *
 * Concurrency: writes are `UPDATE … WHERE user_id = ? AND version = ?` (or an
 * insert that does nothing on a duplicate key) and succeed only when the
 * driver reports one affected row, so two servers can never silently overwrite
 * each other.
 *
 * The table is created on first use (`autoCreateTable`, default `true`). Call
 * {@link SqlContextStore.setup} explicitly if you prefer to run DDL yourself
 * during deployment, and {@link SqlContextStore.purgeExpired} from a cron job
 * to reclaim rows left behind by TTL expiry (expired rows are otherwise only
 * removed lazily when that user is next read).
 */

import type { UserContextData } from '../types/index.js';
import type {
  ContextRecord,
  ContextStore,
  ContextStoreOptions,
} from './ContextStore.js';
import { ContextStoreError, resolveStoreOptions } from './ContextStore.js';

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

export interface SqlContextStoreOptions extends ContextStoreOptions {
  /**
   * Run `CREATE TABLE IF NOT EXISTS` before the first query.
   * @default true
   */
  autoCreateTable?: boolean;
}

/** A row as returned by the driver for `SELECT data, version, expires_at ...`. */
interface ContextRow {
  data: string;
  version: number | string | bigint;
  expires_at: number | string | bigint | null;
}

/** Result of {@link SqlContextStore.runQuery}. */
export interface SqlQueryResult {
  /** Rows returned by a SELECT (empty for other statements). */
  rows: Record<string, unknown>[];
  /**
   * Rows affected by an INSERT/UPDATE/DELETE. Required for the optimistic
   * locking checks; `pg` exposes it as `rowCount`, `mysql2` as
   * `affectedRows`, SQLite drivers as `changes`.
   */
  affectedRows: number;
}

/**
 * Driver-agnostic base. Subclasses only implement {@link runQuery}.
 *
 * Extend this (and pass the `dialect`) to support a driver the library does
 * not ship an adapter for, e.g. knex, Drizzle or postgres.js.
 */
export abstract class SqlContextStore implements ContextStore {
  protected readonly dialect: SqlDialect;
  protected readonly table: string;
  protected readonly ttlSeconds?: number;
  private readonly autoCreateTable: boolean;
  private ready?: Promise<void>;

  constructor(dialect: SqlDialect, options: SqlContextStoreOptions = {}) {
    const { namespace, ttlSeconds } = resolveStoreOptions(options);
    this.dialect = dialect;
    this.table = namespace;
    this.ttlSeconds = ttlSeconds;
    this.autoCreateTable = options.autoCreateTable !== false;
  }

  /**
   * Execute `sql` with positional `params` (written with `?` placeholders —
   * already rewritten to `$n` for PostgreSQL) and return the result rows plus
   * the number of affected rows.
   */
  protected abstract runQuery(
    sql: string,
    params: unknown[]
  ): Promise<SqlQueryResult>;

  // ---------------------------------------------------------------------------
  // ContextStore
  // ---------------------------------------------------------------------------

  async get(userId: string): Promise<ContextRecord | undefined> {
    await this.ensureReady();
    const now = Date.now();
    const { rows } = await this.runQuery(
      this.sql(
        `SELECT data, version, expires_at FROM ${this.table} WHERE user_id = ?`
      ),
      [userId]
    );

    const row = rows[0] as unknown as ContextRow | undefined;
    if (!row) {
      return undefined;
    }

    const expiresAt = SqlContextStore.toNumber(row.expires_at);
    if (expiresAt !== undefined && expiresAt <= now) {
      // Lazily reap — but only the expired row we saw, never a record that a
      // concurrent worker has refreshed in the meantime.
      await this.runQuery(
        this.sql(
          `DELETE FROM ${this.table} WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`
        ),
        [userId, now]
      );
      return undefined;
    }

    try {
      return {
        data: JSON.parse(String(row.data)),
        version: SqlContextStore.toNumber(row.version) ?? 0,
      };
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
    await this.ensureReady();
    const now = Date.now();
    const json = JSON.stringify(data);
    const expiresAt = this.expiryFrom(now);

    if (expectedVersion === undefined) {
      await this.runQuery(this.sql(this.upsertStatement()), [
        userId,
        json,
        expiresAt,
        now,
      ]);
      return true;
    }

    if (expectedVersion === 0) {
      // Insert-only: a duplicate key means someone created the record first.
      const { affectedRows } = await this.runQuery(
        this.sql(this.insertIfAbsentStatement()),
        [userId, json, expiresAt, now]
      );
      return affectedRows === 1;
    }

    const { affectedRows } = await this.runQuery(
      this.sql(
        `UPDATE ${this.table} SET data = ?, version = version + 1, ` +
          `expires_at = ?, updated_at = ? WHERE user_id = ? AND version = ?`
      ),
      [json, expiresAt, now, userId, expectedVersion]
    );
    return affectedRows === 1;
  }

  async delete(userId: string, expectedVersion?: number): Promise<boolean> {
    await this.ensureReady();

    if (expectedVersion === undefined) {
      await this.runQuery(
        this.sql(`DELETE FROM ${this.table} WHERE user_id = ?`),
        [userId]
      );
      return true;
    }

    const { affectedRows } = await this.runQuery(
      this.sql(`DELETE FROM ${this.table} WHERE user_id = ? AND version = ?`),
      [userId, expectedVersion]
    );
    return affectedRows === 1;
  }

  async touch(userId: string): Promise<void> {
    if (this.ttlSeconds === undefined) {
      return;
    }
    await this.ensureReady();
    const now = Date.now();
    await this.runQuery(
      this.sql(`UPDATE ${this.table} SET expires_at = ? WHERE user_id = ?`),
      [this.expiryFrom(now), userId]
    );
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Create the table if it does not exist. Safe to call repeatedly. Invoked
   * automatically on first use unless `autoCreateTable: false`.
   */
  async setup(): Promise<void> {
    await this.runQuery(this.createTableStatement(), []);
  }

  /**
   * Delete every expired row. Returns nothing portable (drivers report
   * affected rows differently); schedule it from a cron job.
   */
  async purgeExpired(): Promise<void> {
    await this.ensureReady();
    await this.runQuery(
      this.sql(
        `DELETE FROM ${this.table} WHERE expires_at IS NOT NULL AND expires_at <= ?`
      ),
      [Date.now()]
    );
  }

  /** The DDL this store runs in {@link setup}, for review or manual migration. */
  createTableStatement(): string {
    const textType = this.dialect === 'mysql' ? 'MEDIUMTEXT' : 'TEXT';
    const suffix = this.dialect === 'mysql' ? ' DEFAULT CHARSET=utf8mb4' : '';
    return (
      `CREATE TABLE IF NOT EXISTS ${this.table} (` +
      `user_id VARCHAR(128) PRIMARY KEY, ` +
      `data ${textType} NOT NULL, ` +
      `version BIGINT NOT NULL, ` +
      `expires_at BIGINT NULL, ` +
      `updated_at BIGINT NOT NULL)` +
      suffix
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private ensureReady(): Promise<void> {
    if (!this.autoCreateTable) {
      return Promise.resolve();
    }
    if (!this.ready) {
      this.ready = this.setup().catch((error) => {
        // Allow a retry on the next call instead of caching the failure.
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  /** Unconditional upsert (no version check); bumps the version. */
  private upsertStatement(): string {
    const insert =
      `INSERT INTO ${this.table} (user_id, data, version, expires_at, updated_at) ` +
      `VALUES (?, ?, 1, ?, ?)`;

    if (this.dialect === 'mysql') {
      return (
        `${insert} ON DUPLICATE KEY UPDATE data = VALUES(data), ` +
        `version = version + 1, expires_at = VALUES(expires_at), ` +
        `updated_at = VALUES(updated_at)`
      );
    }
    // PostgreSQL ≥ 9.5 and SQLite ≥ 3.24. Unqualified columns in DO UPDATE
    // refer to the existing row; `excluded` is the proposed one.
    return (
      `${insert} ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, ` +
      `version = ${this.table}.version + 1, expires_at = excluded.expires_at, ` +
      `updated_at = excluded.updated_at`
    );
  }

  /** Insert with version 1, affecting 0 rows if the user already has a record. */
  private insertIfAbsentStatement(): string {
    const columns = `(user_id, data, version, expires_at, updated_at) VALUES (?, ?, 1, ?, ?)`;
    if (this.dialect === 'mysql') {
      return `INSERT IGNORE INTO ${this.table} ${columns}`;
    }
    return `INSERT INTO ${this.table} ${columns} ON CONFLICT (user_id) DO NOTHING`;
  }

  /** Rewrite `?` placeholders to `$1, $2, …` for PostgreSQL. */
  protected sql(statement: string): string {
    if (this.dialect !== 'postgres') {
      return statement;
    }
    let index = 0;
    return statement.replace(/\?/g, () => `$${++index}`);
  }

  private expiryFrom(nowMs: number): number | null {
    return this.ttlSeconds === undefined
      ? null
      : nowMs + this.ttlSeconds * 1000;
  }

  private static toNumber(
    value: number | string | bigint | null | undefined
  ): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    // `pg` returns BIGINT as a string; node:sqlite may return bigint.
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}

// =============================================================================
// PostgreSQL
// =============================================================================

/**
 * Structurally satisfied by `pg.Pool` and `pg.Client`.
 */
export interface PostgresLikeClient {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/**
 * PostgreSQL context store (driver: `pg`).
 *
 * ```typescript
 * import { Pool } from 'pg';
 * const store = new PostgresContextStore(new Pool({ connectionString: DATABASE_URL }));
 * ```
 */
export class PostgresContextStore extends SqlContextStore {
  private readonly client: PostgresLikeClient;

  constructor(
    client: PostgresLikeClient,
    options: SqlContextStoreOptions = {}
  ) {
    super('postgres', options);
    if (!client || typeof client.query !== 'function') {
      throw new ContextStoreError(
        'PostgresContextStore expects a pg Pool/Client (an object with query(text, values)).'
      );
    }
    this.client = client;
  }

  protected async runQuery(
    sql: string,
    params: unknown[]
  ): Promise<SqlQueryResult> {
    const result = await this.client.query(sql, params);
    return { rows: result?.rows ?? [], affectedRows: result?.rowCount ?? 0 };
  }
}

// =============================================================================
// MySQL / MariaDB
// =============================================================================

/**
 * Structurally satisfied by `mysql2/promise` Pool and Connection objects.
 * `execute` (prepared statements) is preferred when available; `query` is
 * used for DDL and as a fallback.
 */
export interface MySqlLikeClient {
  // `any[]` rather than `unknown[]` so mysql2's typed `ExecuteValues` fits.
  query(sql: string, values?: any[]): Promise<[unknown, unknown]>;
  execute?(sql: string, values?: any[]): Promise<[unknown, unknown]>;
}

/**
 * MySQL / MariaDB context store (driver: `mysql2/promise`).
 *
 * ```typescript
 * import mysql from 'mysql2/promise';
 * const store = new MySqlContextStore(mysql.createPool(process.env.MYSQL_URL));
 * ```
 */
export class MySqlContextStore extends SqlContextStore {
  private readonly client: MySqlLikeClient;

  constructor(client: MySqlLikeClient, options: SqlContextStoreOptions = {}) {
    super('mysql', options);
    if (!client || typeof client.query !== 'function') {
      throw new ContextStoreError(
        'MySqlContextStore expects a mysql2/promise Pool/Connection (an object with query(sql, values)).'
      );
    }
    this.client = client;
  }

  protected async runQuery(
    sql: string,
    params: unknown[]
  ): Promise<SqlQueryResult> {
    const isDdl = /^\s*CREATE\s/i.test(sql);
    const run =
      !isDdl && typeof this.client.execute === 'function'
        ? this.client.execute.bind(this.client)
        : this.client.query.bind(this.client);

    const [result] = await run(sql, params);
    if (Array.isArray(result)) {
      return { rows: result as Record<string, unknown>[], affectedRows: 0 };
    }
    const header = result as { affectedRows?: number } | null | undefined;
    return { rows: [], affectedRows: Number(header?.affectedRows ?? 0) };
  }
}

// =============================================================================
// SQLite
// =============================================================================

/**
 * Synchronous prepared-statement API shared by `better-sqlite3` and Node's
 * built-in `node:sqlite` (`DatabaseSync`).
 */
export interface SqliteSyncDatabase {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes?: number | bigint } | unknown;
  };
}

/**
 * Promise API of the `sqlite` package (the async wrapper around `sqlite3`).
 */
export interface SqliteAsyncDatabase {
  all(sql: string, params?: unknown[]): Promise<unknown[]>;
  run(
    sql: string,
    params?: unknown[]
  ): Promise<{ changes?: number | bigint } | unknown>;
}

export type SqliteLikeDatabase = SqliteSyncDatabase | SqliteAsyncDatabase;

/**
 * SQLite context store. Accepts a `better-sqlite3` database, a `node:sqlite`
 * `DatabaseSync`, or an opened `sqlite` (async wrapper) database.
 *
 * ```typescript
 * import Database from 'better-sqlite3';
 * const store = new SqliteContextStore(new Database('./bot.db'));
 *
 * // or, with Node ≥ 22.5
 * import { DatabaseSync } from 'node:sqlite';
 * const store = new SqliteContextStore(new DatabaseSync('./bot.db'));
 * ```
 *
 * Suitable for single-server deployments (several processes on one machine
 * can share the file; enable WAL mode for better concurrency).
 */
export class SqliteContextStore extends SqlContextStore {
  private readonly db: SqliteLikeDatabase;
  private readonly isAsync: boolean;

  constructor(db: SqliteLikeDatabase, options: SqlContextStoreOptions = {}) {
    super('sqlite', options);
    const asyncDb = db as Partial<SqliteAsyncDatabase>;
    const syncDb = db as Partial<SqliteSyncDatabase>;

    if (
      asyncDb &&
      typeof asyncDb.all === 'function' &&
      typeof asyncDb.run === 'function'
    ) {
      this.isAsync = true;
    } else if (syncDb && typeof syncDb.prepare === 'function') {
      this.isAsync = false;
    } else {
      throw new ContextStoreError(
        'SqliteContextStore expects a better-sqlite3 Database, a node:sqlite ' +
          'DatabaseSync, or an opened `sqlite` package Database.'
      );
    }
    this.db = db;
  }

  protected async runQuery(
    sql: string,
    params: unknown[]
  ): Promise<SqlQueryResult> {
    const returnsRows = /^\s*SELECT\s/i.test(sql);

    if (this.isAsync) {
      const db = this.db as SqliteAsyncDatabase;
      if (returnsRows) {
        return {
          rows: (await db.all(sql, params)) as Record<string, unknown>[],
          affectedRows: 0,
        };
      }
      const result = (await db.run(sql, params)) as {
        changes?: number | bigint;
      };
      return { rows: [], affectedRows: Number(result?.changes ?? 0) };
    }

    const statement = (this.db as SqliteSyncDatabase).prepare(sql);
    if (returnsRows) {
      return {
        rows: statement.all(...params) as Record<string, unknown>[],
        affectedRows: 0,
      };
    }
    const result = statement.run(...params) as { changes?: number | bigint };
    return { rows: [], affectedRows: Number(result?.changes ?? 0) };
  }
}
