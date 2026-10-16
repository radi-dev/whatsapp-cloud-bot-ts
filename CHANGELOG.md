# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-16

### Added
- **Persistent conversation context** backed by an external store so state survives restarts and is shared across workers/servers. Configure with `new WhatsApp({ contextStore })`. Built-in adapters, all instantiated as `new XxxContextStore(client, { namespace?, ttlSeconds? })`: `RedisContextStore` (ioredis / node-redis), `PostgresContextStore` (`pg`), `MySqlContextStore` (`mysql2/promise`), `SqliteContextStore` (better-sqlite3 / `node:sqlite` / `sqlite`), and `MemoryContextStore` (tests and local development only). No new runtime dependencies — bring your own connected client.
- `UserContext`: the session-style object handed to handlers that declare a `context` parameter (`get` / `set` / `assign` / `has` / `delete` / `clear` / `keys` / `all` / `save` / `reload` / `destroy`, plus `version`, `exists`, `isDirty`). Loaded before the handler, saved after it resolves; changes are discarded if the handler throws. Also exposed as `update.context`.
- `client.getContext(phone)` / `client.clearContext(phone)` for use outside handlers.
- **Optimistic locking** across instances: every record carries a `version`; a save that loses the race throws `ContextConflictError` and the dispatcher re-runs the handler against fresh state, up to `contextConflictRetries` (default 3). Enforced atomically per backend (Lua on Redis, version-checked `UPDATE`/conditional `INSERT` on SQL).
- **Persistent next steps**: step handlers are registered by name (`client.registerStep(name, handler)` or the `steps` config option) and the pending step is stored in the user's context record, so flows continue across restarts and instances. `client.getNextStep(target)`, `context.setNextStep()` / `context.clearNextStep()` / `context.nextStep`.
- **Webhook redelivery idempotency** (`dedupeMessages`, default `true` when a `contextStore` is configured): the ids (wamids) of handled messages are stored in the user's context record in the same optimistically-locked save as the handler's changes, so a webhook WhatsApp redelivers after a late/missing 200 is skipped instead of being applied twice. A message whose handler threw is not marked, so the redelivery retries it. `UserContext.hasSeenMessage()` / `markMessageSeen()` / `recentMessages`.
- Errors: `ContextStoreRequiredError`, `ContextStoreError`, `ContextConflictError`, `UnknownStepError`. Fail-fast: registering a context-aware handler, a step, or calling any context/next-step API without a `contextStore` throws at registration time.
- SQL stores: `setup()` (explicit DDL), `purgeExpired()` (cron), `autoCreateTable` option, exported `SqlContextStore` base class for other drivers. `ContextStore` interface exported for custom backends.

### Changed
- **Breaking (major bump):** this release changes public signatures and behaviour — see the items below — hence 2.0.0.
- **Breaking:** `setNextStep(update, handler, fallbackFn?, fallbackRegex?)` → `setNextStep(update | phone, stepName, { fallback?, fallbackRegex? }?)` and now returns a `Promise`. Inline handler closures and fallback functions are rejected with guidance; register steps by name instead. `clearNextStep` is async and accepts an `Update` or phone number. `NextStepConfig` type replaced by `NextStepState` / `NextStepOptions`.
- **Breaking:** next steps require a `contextStore` (they were previously held in process memory).
- `HandlerFunction` is now `(update, context: UserContext)`; `context` is non-optional inside context-aware handlers. One-argument handlers are unaffected. The `HandlerOptions.context` flag is no longer deprecated: `true` forces, `false` opts out, omitted auto-detects from the declared parameter count.
- When a `contextStore` is configured, every inbound message loads the user's record once (needed to resolve pending steps and skip redeliveries) and every handled message writes it (the handled-id marker). Without a store nothing changes.
- `Dispatcher` constructor: context settings moved into an options object — `new Dispatcher(bot, markAsRead, showTyping, { store, conflictRetries, dedupeMessages })`.
- Redis adapter uses multi-field `HSET` (Redis ≥ 4.0) rather than the deprecated `HMSET`.

- Packaging: the package is now explicitly **ESM-only / TypeScript-first**. The stale `"module": "dist/esm/index.js"` field (pointing at a build that never existed) is gone, the `exports` map lists `types` before `import` as TypeScript requires, and the docs no longer advertise a CommonJS build. `engines.node` is now `>=18`.
- ESLint config renamed to `.eslintrc.cjs` so it loads under `"type": "module"`; the never-installed `eslint-plugin-import` was dropped (TypeScript's NodeNext resolution already enforces `.js` import extensions). `npm run lint` now covers `tests/` and passes; `src/` and `tests/` were formatted with Prettier.

### Fixed
- `mime-types` is now a declared dependency (it was only reachable transitively via `form-data`, so installs with a different layout could fail at import).
- Importing the library no longer prints dotenv's "injecting env" tip to the consumer's console (`dotenv.config({ quiet: true })`).

### Removed
- The deprecated in-memory context notes/types from 1.7.x (`UserContext` is a real class again).
- The non-existent CommonJS build from package metadata and documentation.

## [1.0.0] - 2025-01-14

### Added
- Initial release of whatsapp-cloud-bot
- Full TypeScript support with comprehensive type definitions
- Async/await-based architecture optimized for JavaScript
- WhatsApp client with message sending capabilities
- Handler system for incoming messages (text, interactive, media, location)
- Interactive message support (buttons, lists, location requests)
- Media handling (send/receive images, videos, audio, documents, stickers)
- User context management for stateful conversations
- Next-step handler for conversation flows
- Async message queue with proper event handling
- Complete test suite
- Comprehensive documentation and examples
- Support for both ESM and CommonJS
- MIT License

### Features
- Send text messages with optional reply markup
- Send interactive messages with buttons (up to 3)
- Send interactive lists with sections (up to 10 items)
- Send template messages
- Send media messages (image, video, audio, document, sticker)
- Send location messages
- Request location from users
- Download media files from WhatsApp
- Mark messages as read
- Event-driven message handlers with filtering
- Regex and custom filter support for handlers
- Persistent handlers that always run
- Context-based conversation state management
- Next-step handlers for multi-step flows
- Proper TypeScript types for all APIs
- Comprehensive error handling
- Queue-based message processing

### Technical
- Built with TypeScript 5.2
- Uses Axios for HTTP requests
- Async queue for message processing
- Map-based context storage
- Modular architecture with clear separation of concerns
- Dual package (ESM + CommonJS)
- Complete type declarations
- Jest for testing
- ESLint and Prettier for code quality

[2.0.0]: https://github.com/Radi-dev/whatsapp-cloud-bot-ts/compare/v1.7.2...v2.0.0
[1.0.0]: https://github.com/Radi-dev/whatsapp-cloud-bot-ts/releases/tag/v1.0.0
