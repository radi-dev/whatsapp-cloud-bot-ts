/**
 * UserContext — the per-user conversation state object handed to handlers.
 *
 * Works like a session: the dispatcher loads the user's document from the
 * {@link ContextStore} *before* running a handler, the handler reads/writes it
 * synchronously in memory, and the dispatcher flushes it back *after* the
 * handler completes successfully. Call {@link UserContext.save} yourself to
 * persist earlier (e.g. before a long-running or failure-prone step).
 *
 * Saves are optimistically locked: the record's `version` seen at load time
 * must still be current, otherwise {@link ContextConflictError} is thrown and
 * the dispatcher re-runs the handler from scratch with fresh state. Keep
 * handlers reasonably idempotent with that in mind (a side effect performed
 * before a conflicting save may be repeated on the retry).
 *
 * Values must be JSON-serialisable (plain objects, arrays, strings, numbers,
 * booleans, null). `Date`s, `Map`s, class instances etc. will not round-trip.
 *
 * The user's pending **next step** (see {@link UserContext.setNextStep}) and
 * the ids of recently handled messages (used to ignore webhook redeliveries)
 * are stored in the same record under reserved keys, so a step transition,
 * the data it depends on and the "already handled" marker are committed
 * together, atomically.
 */

import type {
  NextStepOptions,
  NextStepState,
  UserContextData,
} from '../types/index.js';
import type { ContextRecord, ContextStore } from './ContextStore.js';
import { ContextConflictError, ContextStoreError } from './ContextStore.js';

/** Reserved key inside the stored document holding the pending next step. */
export const NEXT_STEP_KEY = '__nextStep';
/** Reserved key holding the ids (wamids) of recently handled messages. */
export const RECENT_MESSAGES_KEY = '__recentMessages';
/** How many recently handled message ids are remembered per user. */
export const RECENT_MESSAGES_LIMIT = 20;

/** On-disk shape of the next-step state (RegExp serialised as source/flags). */
interface StoredNextStep {
  step: string;
  fallback?: string;
  fallbackRegex?: { source: string; flags: string };
}

/** Hooks the dispatcher injects so step names are validated at call time. */
export interface UserContextHooks {
  /** Throw if `name` is not a registered step. */
  validateStep?: (name: string) => void;
}

/**
 * Widens literal types so that `context.get('step', 0)` is typed `number`
 * rather than `0` (which would make `step === 1` a type error).
 */
export type WidenLiteral<T> = T extends number
  ? number
  : T extends string
    ? string
    : T extends boolean
      ? boolean
      : T;

export class UserContext {
  /** The user id (WhatsApp phone number) this context belongs to. */
  public readonly userId: string;

  private readonly store: ContextStore;
  private readonly hooks: UserContextHooks;
  private data: UserContextData;
  private nextStepState?: StoredNextStep;
  private recentMessageIds: string[] = [];
  /** JSON snapshot as of the last load/save — used to detect changes. */
  private snapshot: string;
  /** Optimistic-lock version of the loaded record; 0 = no record exists. */
  private currentVersion: number;

  /**
   * Prefer {@link UserContext.load}; the constructor is public to allow
   * wrapping a pre-fetched record (e.g. in tests).
   */
  constructor(
    store: ContextStore,
    userId: string,
    record: ContextRecord | undefined,
    hooks: UserContextHooks = {}
  ) {
    this.store = store;
    this.hooks = hooks;
    this.userId = userId;
    this.currentVersion = record?.version ?? 0;
    this.data = {};
    this.nextStepState = undefined;
    this.adopt(record?.data);
    this.snapshot = this.serialize();
  }

  /**
   * Fetch the user's stored record and wrap it.
   */
  static async load(
    store: ContextStore,
    userId: string,
    hooks: UserContextHooks = {}
  ): Promise<UserContext> {
    const record = await store.get(userId);
    return new UserContext(store, userId, record, hooks);
  }

  /**
   * Version of the record this context was loaded from (or last saved as).
   * `0` means no record exists in the store yet.
   */
  get version(): number {
    return this.currentVersion;
  }

  /** Whether a record currently exists in the store for this user. */
  get exists(): boolean {
    return this.currentVersion > 0;
  }

  // ---------------------------------------------------------------------------
  // Synchronous accessors (operate on the in-memory copy)
  // ---------------------------------------------------------------------------

  /**
   * Read a value. Returns `defaultValue` when the key is absent.
   *
   * @example
   * const step = context.get('step', 0);
   */
  get<T = any>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): WidenLiteral<T>;
  get(key: string, defaultValue?: unknown): unknown {
    UserContext.assertNotReserved(key);
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? this.data[key]
      : defaultValue;
  }

  /**
   * Write a value. Setting `undefined` removes the key (it would be dropped by
   * JSON anyway).
   */
  set(key: string, value: unknown): this {
    UserContext.assertNotReserved(key);
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    return this;
  }

  /** Merge several keys at once. */
  assign(values: UserContextData): this {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value);
    }
    return this;
  }

  has(key: string): boolean {
    UserContext.assertNotReserved(key);
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  /** Remove one key. Returns whether it existed. */
  delete(key: string): boolean {
    if (!this.has(key)) {
      return false;
    }
    delete this.data[key];
    return true;
  }

  /**
   * Remove every data key. The pending next step (if any) and the handled
   * message ids are **not** affected — use {@link clearNextStep} /
   * {@link destroy} for those. Once the record holds nothing at all it is
   * deleted from the store on save.
   */
  clear(): void {
    this.data = {};
  }

  // ---------------------------------------------------------------------------
  // Next step (persisted alongside the data, hidden from the accessors above)
  // ---------------------------------------------------------------------------

  /**
   * The step handler that will receive this user's next message, if one is
   * pending. Set via {@link setNextStep} (or `client.setNextStep`), cleared
   * automatically once it (or its fallback) has run.
   */
  get nextStep(): NextStepState | undefined {
    const stored = this.nextStepState;
    if (!stored) {
      return undefined;
    }
    return {
      step: stored.step,
      fallback: stored.fallback,
      fallbackRegex: stored.fallbackRegex
        ? new RegExp(stored.fallbackRegex.source, stored.fallbackRegex.flags)
        : undefined,
    };
  }

  /**
   * Route this user's next message to the step handler registered as `step`
   * (see `client.registerStep`). Persisted with the context on save, so it
   * survives restarts and is honoured by whichever instance handles the next
   * message.
   *
   * @param step - Name of a registered step handler.
   * @param options.fallback - Name of a registered step to run instead when
   *   the message text matches `fallbackRegex` (e.g. a cancel handler).
   * @param options.fallbackRegex - Gate for the fallback.
   *   Defaults to `/^(end|stop|cancel)$/i` when a fallback is given.
   */
  setNextStep(step: string, options: NextStepOptions = {}): this {
    if (typeof step !== 'string' || step.length === 0) {
      throw new ContextStoreError(
        'setNextStep: step name must be a non-empty string.'
      );
    }
    this.hooks.validateStep?.(step);
    if (options.fallback !== undefined) {
      this.hooks.validateStep?.(options.fallback);
    }

    const stored: StoredNextStep = { step };
    if (options.fallback !== undefined) {
      stored.fallback = options.fallback;
      const regex =
        options.fallbackRegex === undefined
          ? DEFAULT_FALLBACK_REGEX
          : typeof options.fallbackRegex === 'string'
            ? new RegExp(options.fallbackRegex)
            : options.fallbackRegex;
      stored.fallbackRegex = { source: regex.source, flags: regex.flags };
    }
    this.nextStepState = stored;
    return this;
  }

  /** Cancel the pending next step. Returns whether one was pending. */
  clearNextStep(): boolean {
    const had = this.nextStepState !== undefined;
    this.nextStepState = undefined;
    return had;
  }

  // ---------------------------------------------------------------------------
  // Idempotency (webhook redeliveries)
  // ---------------------------------------------------------------------------

  /**
   * Whether a message id (wamid) was recorded by {@link markMessageSeen}. The
   * dispatcher uses this to skip WhatsApp webhook redeliveries of a message
   * whose handler already committed.
   */
  hasSeenMessage(messageId: string): boolean {
    return this.recentMessageIds.includes(messageId);
  }

  /**
   * Remember a handled message id. Only the most recent
   * {@link RECENT_MESSAGES_LIMIT} ids are kept. Persisted on save.
   */
  markMessageSeen(messageId: string): this {
    if (!messageId || this.recentMessageIds.includes(messageId)) {
      return this;
    }
    this.recentMessageIds.push(messageId);
    if (this.recentMessageIds.length > RECENT_MESSAGES_LIMIT) {
      this.recentMessageIds.splice(
        0,
        this.recentMessageIds.length - RECENT_MESSAGES_LIMIT
      );
    }
    return this;
  }

  /** Ids of recently handled messages, oldest first. */
  get recentMessages(): readonly string[] {
    return [...this.recentMessageIds];
  }

  /** Data keys (the reserved next-step entry is never included). */
  keys(): string[] {
    return Object.keys(this.data);
  }

  get size(): number {
    return Object.keys(this.data).length;
  }

  /** True when no data keys are set (a pending next step does not count). */
  get isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * The raw data object. Mutating it directly is supported (changes are
   * detected by comparison on save), but prefer the accessors.
   */
  get userData(): UserContextData {
    return this.data;
  }

  /** A shallow copy of all stored values. */
  all(): UserContextData {
    return { ...this.data };
  }

  toJSON(): UserContextData {
    return this.all();
  }

  /**
   * True when the in-memory data differs from what was last loaded/saved
   * (including nested mutations of values returned by {@link get}).
   */
  get isDirty(): boolean {
    return this.serialize() !== this.snapshot;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Flush the in-memory state to the store.
   *
   * - Changed and non-empty → written (store applies its TTL).
   * - Changed and empty     → deleted from the store.
   * - Unchanged             → TTL is refreshed via `store.touch` when the record
   *                           exists, so inactivity expiry counts from the last
   *                           access.
   *
   * Writes are conditional on the version loaded; if another worker changed
   * the record in the meantime, {@link ContextConflictError} is thrown and
   * nothing is written.
   *
   * The dispatcher calls this automatically after a handler resolves; it is
   * public so handlers can commit explicitly mid-way.
   *
   * @throws {ContextConflictError} on concurrent modification
   */
  async save(): Promise<void> {
    const serialized = this.serialize();

    if (serialized === this.snapshot) {
      if (this.exists && this.store.touch) {
        await this.store.touch(this.userId);
      }
      return;
    }

    const expected = this.currentVersion;

    if (this.isRecordEmpty()) {
      if (!(await this.store.delete(this.userId, expected))) {
        throw new ContextConflictError(this.userId, expected);
      }
      this.currentVersion = 0;
    } else {
      if (!(await this.store.set(this.userId, this.toRecordData(), expected))) {
        throw new ContextConflictError(this.userId, expected);
      }
      this.currentVersion = expected + 1;
    }
    this.snapshot = serialized;
  }

  /**
   * Discard in-memory changes and re-read the record from the store.
   */
  async reload(): Promise<void> {
    const record = await this.store.get(this.userId);
    this.currentVersion = record?.version ?? 0;
    this.adopt(record?.data);
    this.snapshot = this.serialize();
  }

  /**
   * Delete the stored record immediately (data **and** next step) and reset
   * in-memory state. Unlike {@link clear} this does not wait for `save()`, and
   * it is **unconditional** (no version check).
   */
  async destroy(): Promise<void> {
    await this.store.delete(this.userId);
    this.data = {};
    this.nextStepState = undefined;
    this.recentMessageIds = [];
    this.currentVersion = 0;
    this.snapshot = this.serialize();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Split a stored document into user data and the reserved entries. */
  private adopt(stored: UserContextData | undefined): void {
    const {
      [NEXT_STEP_KEY]: rawStep,
      [RECENT_MESSAGES_KEY]: rawRecent,
      ...userData
    } = UserContext.clone(stored ?? {});
    this.data = userData;
    this.nextStepState = UserContext.isStoredNextStep(rawStep)
      ? rawStep
      : undefined;
    this.recentMessageIds = Array.isArray(rawRecent)
      ? rawRecent.filter((id): id is string => typeof id === 'string')
      : [];
  }

  /** The document as written to the store (data + reserved entries). */
  private toRecordData(): UserContextData {
    const record: UserContextData = { ...this.data };
    if (this.nextStepState) {
      record[NEXT_STEP_KEY] = this.nextStepState;
    }
    if (this.recentMessageIds.length > 0) {
      record[RECENT_MESSAGES_KEY] = this.recentMessageIds;
    }
    return record;
  }

  /** Nothing worth keeping: no data, no pending step, no handled-message ids. */
  private isRecordEmpty(): boolean {
    return (
      Object.keys(this.data).length === 0 &&
      !this.nextStepState &&
      this.recentMessageIds.length === 0
    );
  }

  private serialize(): string {
    return JSON.stringify(this.toRecordData());
  }

  private static isStoredNextStep(value: unknown): value is StoredNextStep {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as StoredNextStep).step === 'string'
    );
  }

  private static assertNotReserved(key: string): void {
    if (key === NEXT_STEP_KEY || key === RECENT_MESSAGES_KEY) {
      throw new ContextStoreError(
        `"${key}" is reserved for the library (next step / handled message ids).`
      );
    }
  }

  private static clone(data: UserContextData): UserContextData {
    // Round-trip through JSON so the in-memory copy is detached from whatever
    // the store handed us (e.g. a MemoryContextStore's own object).
    return JSON.parse(JSON.stringify(data));
  }
}

/** Fallback gate used when a fallback step is given without a regex. */
export const DEFAULT_FALLBACK_REGEX = /^(end|stop|cancel)$/i;
