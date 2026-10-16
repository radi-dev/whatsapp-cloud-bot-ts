/**
 * In-process context store.
 *
 * ⚠️ Development / testing only. State lives in this process's memory: it is
 * lost on restart and is **not** shared between workers or servers. Use
 * {@link RedisContextStore} or one of the SQL stores in production.
 */

import type { UserContextData } from '../types/index.js';
import type {
  ContextRecord,
  ContextStore,
  ContextStoreOptions,
} from './ContextStore.js';
import { resolveStoreOptions } from './ContextStore.js';

interface MemoryRecord {
  data: string;
  version: number;
  expiresAt?: number;
}

export class MemoryContextStore implements ContextStore {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly ttlSeconds?: number;

  constructor(options: Pick<ContextStoreOptions, 'ttlSeconds'> = {}) {
    this.ttlSeconds = resolveStoreOptions(options).ttlSeconds;
  }

  async get(userId: string): Promise<ContextRecord | undefined> {
    const record = this.live(userId);
    if (!record) {
      return undefined;
    }
    return { data: JSON.parse(record.data), version: record.version };
  }

  async set(
    userId: string,
    data: UserContextData,
    expectedVersion?: number
  ): Promise<boolean> {
    const current = this.live(userId);
    const currentVersion = current?.version ?? 0;

    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      return false;
    }

    this.records.set(userId, {
      data: JSON.stringify(data),
      version: currentVersion + 1,
      expiresAt: this.expiryFromNow(),
    });
    return true;
  }

  async delete(userId: string, expectedVersion?: number): Promise<boolean> {
    const current = this.live(userId);
    if (expectedVersion === undefined) {
      this.records.delete(userId);
      return true;
    }
    if (!current || expectedVersion !== current.version) {
      return false;
    }
    this.records.delete(userId);
    return true;
  }

  async touch(userId: string): Promise<void> {
    if (this.ttlSeconds === undefined) {
      return;
    }
    const record = this.live(userId);
    if (record) {
      record.expiresAt = this.expiryFromNow();
    }
  }

  /** Number of (possibly expired) records held. Handy in tests. */
  get size(): number {
    return this.records.size;
  }

  /** Drop every record. */
  clear(): void {
    this.records.clear();
  }

  /** Remove expired records. Call periodically in long-lived dev processes. */
  purgeExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        this.records.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** The record for a user, dropping it if expired. */
  private live(userId: string): MemoryRecord | undefined {
    const record = this.records.get(userId);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      this.records.delete(userId);
      return undefined;
    }
    return record;
  }

  private expiryFromNow(): number | undefined {
    return this.ttlSeconds === undefined
      ? undefined
      : Date.now() + this.ttlSeconds * 1000;
  }
}
