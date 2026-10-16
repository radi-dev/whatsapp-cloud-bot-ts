/**
 * Conversation context — persistent per-user state for multi-turn
 * conversations, backed by an external store.
 */

export {
  ContextStoreError,
  ContextStoreRequiredError,
  ContextConflictError,
  DEFAULT_CONTEXT_NAMESPACE,
} from './ContextStore.js';
export type {
  ContextStore,
  ContextStoreOptions,
  ContextRecord,
} from './ContextStore.js';

export {
  UserContext,
  NEXT_STEP_KEY,
  RECENT_MESSAGES_KEY,
  RECENT_MESSAGES_LIMIT,
  DEFAULT_FALLBACK_REGEX,
} from './UserContext.js';
export type { WidenLiteral, UserContextHooks } from './UserContext.js';

export { MemoryContextStore } from './MemoryContextStore.js';

export { RedisContextStore } from './RedisContextStore.js';
export type {
  RedisLikeClient,
  RedisContextStoreOptions,
  RedisEvalFunction,
} from './RedisContextStore.js';

export {
  SqlContextStore,
  PostgresContextStore,
  MySqlContextStore,
  SqliteContextStore,
} from './SqlContextStore.js';
export type {
  SqlDialect,
  SqlContextStoreOptions,
  SqlQueryResult,
  PostgresLikeClient,
  MySqlLikeClient,
  SqliteLikeDatabase,
  SqliteSyncDatabase,
  SqliteAsyncDatabase,
} from './SqlContextStore.js';
