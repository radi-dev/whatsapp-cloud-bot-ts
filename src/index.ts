/**
 * WhatsApp Bot Client Library
 * A TypeScript (ESM-only) library for building WhatsApp bots using the WhatsApp Business Cloud API
 *
 * @packageDocumentation
 */

// Main Client
export { WhatsApp } from './WhatsApp.js';
export type { WhatsAppConfig } from './WhatsApp.js';

// Core Classes
export { Update } from './Update.js';
export { StatusUpdate } from './StatusUpdate.js';
export {
  Dispatcher,
  DEFAULT_CONTEXT_CONFLICT_RETRIES,
  UnknownStepError,
} from './Dispatcher.js';
export type { DispatcherContextOptions } from './Dispatcher.js';

// Conversation context (persistent, pluggable storage)
export {
  UserContext,
  NEXT_STEP_KEY,
  RECENT_MESSAGES_KEY,
  RECENT_MESSAGES_LIMIT,
  DEFAULT_FALLBACK_REGEX,
  ContextStoreError,
  ContextStoreRequiredError,
  ContextConflictError,
  DEFAULT_CONTEXT_NAMESPACE,
  MemoryContextStore,
  RedisContextStore,
  SqlContextStore,
  PostgresContextStore,
  MySqlContextStore,
  SqliteContextStore,
} from './context/index.js';
export type {
  ContextStore,
  ContextStoreOptions,
  ContextRecord,
  WidenLiteral,
  UserContextHooks,
  RedisLikeClient,
  RedisContextStoreOptions,
  RedisEvalFunction,
  SqlDialect,
  SqlContextStoreOptions,
  SqlQueryResult,
  PostgresLikeClient,
  MySqlLikeClient,
  SqliteLikeDatabase,
  SqliteSyncDatabase,
  SqliteAsyncDatabase,
} from './context/index.js';

// Handlers
export {
  UpdateHandler,
  handlerUsesContext,
  TextHandler,
  MessageHandler,
  ButtonHandler,
  InteractiveQueryHandler,
  ButtonReplyHandler,
  ListReplyHandler,
  FlowReplyHandler,
  ImageHandler,
  AudioHandler,
  VideoHandler,
  DocumentHandler,
  StickerHandler,
  LocationHandler,
  UnknownHandler,
  UnsupportedHandler,
} from './Handlers.js';

// Markup Components
export {
  BaseReplyMarkup,
  InlineButton,
  InlineKeyboard,
  ListItem,
  ListSection,
  InlineList,
  InlineLocationRequest,
  InlineFlow,
  buildFlowAction,
} from './Markup.js';

// Standalone message senders (low-level; take url + token)
export {
  sendButtonMessage,
  sendListMessage,
  sendFlowMessage,
} from './Message.js';
export type { InteractiveSendOptions } from './Message.js';

// Flow endpoint helpers (decrypt/encrypt/signature)
export {
  decryptFlowRequest,
  encryptFlowResponse,
  isFlowSignatureValid,
  FlowEndpointException,
} from './flows.js';
export type {
  EncryptedFlowRequest,
  FlowDataExchangeBody,
  DecryptedFlowRequest,
} from './flows.js';

// Types
export * from './types/index.js';

// Utilities
export * from './utils/helpers.js';
export * from './utils/uploadHelper.js';

// Default export
export { WhatsApp as default } from './WhatsApp.js';
