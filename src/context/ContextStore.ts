/**
 * Context storage abstraction.
 *
 * A {@link ContextStore} persists one JSON document per user (keyed by the
 * user's WhatsApp id / phone number) so that conversation state survives
 * process restarts and is shared across workers / servers.
 *
 * The library ships adapters for Redis, PostgreSQL, MySQL and SQLite, all
 * instantiated the same way — `new XxxContextStore(client, options)` — and all
 * wired up identically via `new WhatsApp({ contextStore })`.
 *
 * Implement this interface yourself to plug in any other backend.
 */

import type { UserContextData } from '../types/index.js';

/**
 * A stored context document together with its optimistic-locking version.
 */
export interface ContextRecord {
  data: UserContextData;
  /**
   * Monotonic version of the record, starting at 1 on first write. Pass it
   * back to {@link ContextStore.set} / {@link ContextStore.delete} as the
   * `expectedVersion` to detect concurrent modification.
   */
  version: number;
}

/**
 * Minimal async key → JSON-document storage contract used by the context
 * manager. All methods are keyed by the user id (phone number).
 *
 * Writes use **optimistic locking**: callers pass the `version` they observed
 * when loading, and the store only applies the write when that version is
 * still current. This makes concurrent handlers on different servers safe —
 * the loser sees a conflict (`false`) and the dispatcher re-runs it with fresh
 * state instead of silently overwriting the other worker's changes.
 */
export interface ContextStore {
  /**
   * Load the stored record for a user. Resolve `undefined` when nothing is
   * stored (or the record has expired).
   */
  get(userId: string): Promise<ContextRecord | undefined>;

  /**
   * Compare-and-set write.
   *
   * - `expectedVersion === 0`: insert only — fails if a record now exists.
   * - `expectedVersion > 0`: update only — fails if the stored version differs
   *   or the record has been deleted.
   * - `expectedVersion === undefined`: unconditional upsert (no locking); for
   *   migrations/seeding rather than handler flows.
   *
   * On success the record's version becomes `expectedVersion + 1` (or the
   * previous version + 1 for an unconditional upsert) and the store's TTL (if
   * any) is re-applied.
   *
   * @returns `true` if written, `false` on a version conflict.
   */
  set(
    userId: string,
    data: UserContextData,
    expectedVersion?: number
  ): Promise<boolean>;

  /**
   * Delete the record. With `expectedVersion`, only deletes when a record with
   * exactly that version exists; resolves `false` if the version differs **or
   * the record is already gone** (either way someone else changed it since it
   * was loaded). Without it, deletes unconditionally and resolves `true`.
   */
  delete(userId: string, expectedVersion?: number): Promise<boolean>;

  /**
   * Optional: extend the TTL of an existing record without rewriting it. Called
   * after a handler that only *read* the context, so "inactivity" expiry is
   * measured from the last access rather than the last write. Implementations
   * without TTL support may omit it or make it a no-op.
   */
  touch?(userId: string): Promise<void>;
}

/**
 * Options shared by every built-in store adapter.
 */
export interface ContextStoreOptions {
  /**
   * Logical namespace for this bot's data. Used as the Redis key prefix
   * (`<namespace>:<userId>`) or the SQL table name. Lets several bots share one
   * database. Must match `/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/`.
   *
   * @default 'wa_user_context'
   */
  namespace?: string;
  /**
   * Expire a user's context this many seconds after it was last written or
   * touched (sliding expiry). Omit for contexts that never expire.
   */
  ttlSeconds?: number;
}

export const DEFAULT_CONTEXT_NAMESPACE = 'wa_user_context';

const NAMESPACE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Validate and normalise the common store options. Throws on an unsafe
 * namespace (it is interpolated into SQL identifiers) or an invalid TTL.
 */
export function resolveStoreOptions(options: ContextStoreOptions = {}): {
  namespace: string;
  ttlSeconds?: number;
} {
  const namespace = options.namespace ?? DEFAULT_CONTEXT_NAMESPACE;
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new ContextStoreError(
      `Invalid context store namespace "${namespace}". Use letters, digits and ` +
        `underscores only (optionally schema-qualified, e.g. "public.wa_ctx").`
    );
  }

  const ttlSeconds = options.ttlSeconds;
  if (
    ttlSeconds !== undefined &&
    (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
  ) {
    throw new ContextStoreError(
      `Invalid ttlSeconds "${ttlSeconds}": must be a positive number of seconds.`
    );
  }

  return { namespace, ttlSeconds };
}

/**
 * Base error for context storage problems (bad configuration, serialization
 * failures, unsupported client shapes).
 */
export class ContextStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextStoreError';
  }
}

/**
 * Thrown by {@link UserContext.save} when the stored record was modified (or
 * deleted/created) by someone else since it was loaded — i.e. the optimistic
 * lock failed. The dispatcher catches this and re-runs the handler with fresh
 * state, up to the configured number of retries; if it is still thrown after
 * that, it propagates out of `processUpdate`.
 */
export class ContextConflictError extends Error {
  public readonly userId: string;
  /** Version the writer expected to find. */
  public readonly expectedVersion: number;

  constructor(userId: string, expectedVersion: number) {
    super(
      `Context for user "${userId}" was modified concurrently (expected ` +
        `version ${expectedVersion}). The handler will be retried with fresh state.`
    );
    this.name = 'ContextConflictError';
    this.userId = userId;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Thrown — deliberately, and early — whenever something references the user
 * context but no {@link ContextStore} was configured on the client.
 *
 * This is raised at handler *registration* time (e.g. `client.onTextMessage`,
 * the `handlers` constructor option, `setNextStep`) as soon as a handler
 * declares a `context` parameter, so a misconfigured bot fails at startup
 * rather than on its first message.
 */
export class ContextStoreRequiredError extends Error {
  constructor(detail: string) {
    super(
      `${detail} No contextStore is configured. Pass one to the client, e.g. ` +
        `new WhatsApp({ ..., contextStore: new RedisContextStore(redis) }), ` +
        `or opt the handler out with { context: false }.`
    );
    this.name = 'ContextStoreRequiredError';
  }
}
