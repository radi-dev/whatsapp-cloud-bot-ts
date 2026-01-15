/**
 * WhatsApp Bot Client Library
 * A TypeScript/JavaScript library for building WhatsApp bots using WhatsApp Business Cloud API
 *
 * @packageDocumentation
 */

// Main Client
export { WhatsApp } from './WhatsApp';
export type { WhatsAppConfig } from './WhatsApp';

// Core Classes
export { Update } from './Update';
export {
  UserContext,
  clearAllContexts,
  getAllContextUsers,
} from './UserContext';
export { Dispatcher } from './Dispatcher';

// Handlers
export {
  UpdateHandler,
  MessageHandler,
  InteractiveQueryHandler,
  ImageHandler,
  AudioHandler,
  VideoHandler,
  DocumentHandler,
  StickerHandler,
  LocationHandler,
  UnknownHandler,
  UnsupportedHandler,
} from './Handlers';

// Markup Components
export {
  BaseReplyMarkup,
  InlineButton,
  InlineKeyboard,
  ListItem,
  ListSection,
  InlineList,
  InlineLocationRequest,
} from './Markup';

// Types
export * from './types';

// Utilities
export * from './utils/helpers';

// Default export
export { WhatsApp as default } from './WhatsApp';
