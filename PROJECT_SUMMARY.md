# WhatsApp Bot Client - Project Summary

## Overview

This is a TypeScript-only, ESM-only library for building WhatsApp bots using the WhatsApp Business Cloud API. The library is a modern, async-first reimplementation of the original Python library for Node.js ≥ 18.

## Project Structure

```
js-library/
├── src/                      # Source code
│   ├── types/               # TypeScript type definitions
│   │   └── index.ts         # Core types and interfaces
│   ├── utils/               # Utility functions
│   │   └── helpers.ts       # Helper functions and validators
│   ├── WhatsApp.ts          # Main client class
│   ├── Dispatcher.ts        # Message routing and handler management
│   ├── Update.ts            # Incoming message wrapper
│   ├── context/             # Persistent conversation context
│   │   ├── ContextStore.ts      # ContextStore interface, options, errors
│   │   ├── UserContext.ts       # Session object handed to handlers (+ next step)
│   │   ├── MemoryContextStore.ts # In-process store (tests/dev only)
│   │   ├── RedisContextStore.ts  # Redis adapter (Lua-based optimistic locking)
│   │   └── SqlContextStore.ts    # PostgreSQL / MySQL / SQLite adapters
│   ├── Handlers.ts          # Message handler classes
│   ├── Markup.ts            # Interactive message components
│   ├── Message.ts           # WhatsApp API functions
│   └── index.ts             # Main entry point with exports
├── tests/                   # Test files
│   ├── Markup.test.ts       # Markup component tests
│   ├── helpers.test.ts      # Utility function tests
│   ├── UserContext.test.ts  # Session semantics + optimistic locking
│   ├── ContextStores.test.ts # Store contract across every adapter
│   ├── ContextDispatch.test.ts # Handler wiring, fail-fast, cross-instance retries
│   └── NextStep.test.ts     # Persistent next-step flows
├── docs/                    # Documentation
│   └── EXAMPLES.md          # Code examples and tutorials
├── dist/                    # Build output (generated): ESM .js + .d.ts, mirrors src/
├── package.json             # NPM package configuration ("type": "module")
├── tsconfig.json            # TypeScript configuration (single NodeNext build)
├── jest.config.cjs          # Jest testing configuration
├── .eslintrc.cjs            # ESLint configuration
├── .prettierrc              # Prettier configuration
├── .gitignore               # Git ignore rules
├── .npmignore               # NPM ignore rules
├── LICENSE                  # MIT License
├── CHANGELOG.md             # Version history
└── README.md                # Main documentation
```

## Key Features

### Architecture Improvements over Python Version

1. **Async/Await Native**: Built from ground up for async JavaScript
2. **Event Queue**: Proper async message queue instead of threading
3. **TypeScript First**: Complete type safety and IDE autocomplete
4. **ESM-only**: Native ES modules, no CommonJS build or dual-package plumbing
5. **Modern JavaScript**: Uses Map, Set, and other modern features
6. **Promise-based**: All async operations return Promises

### Core Components

#### 1. WhatsApp Client (`WhatsApp.ts`)
- Main entry point for the library
- Handles API communication
- Provides convenience methods for sending messages
- Manages dispatcher and handler registration

#### 2. Dispatcher (`Dispatcher.ts`)
- Routes incoming messages to appropriate handlers
- Serialises processing per phone number; different users run concurrently
- Loads the user's context record, resolves pending next steps, runs the handler and saves — with optimistic-locking retries
- Registry of named step handlers; fail-fast when context is referenced without a store

#### 3. Update (`Update.ts`)
- Wraps incoming webhook messages
- Provides convenience methods for replying
- Exposes user and message information

#### 4. Conversation Context (`context/`)
- `ContextStore` interface: `get` / `set` / `delete` (compare-and-set on a `version`) / optional `touch`
- Adapters for Redis, PostgreSQL, MySQL, SQLite (bring your own client) and an in-memory store for tests
- `UserContext`: synchronous key-value session loaded before and saved after each handler; also carries the user's pending next step
- Survives restarts and works across multiple instances; concurrent modification is detected and the handler re-run

#### 5. Handlers (`Handlers.ts`)
- MessageHandler - Text messages
- InteractiveQueryHandler - Button/list replies
- MediaHandlers - Images, videos, audio, documents, stickers
- LocationHandler - Location messages
- Regex and custom filter support

#### 6. Markup (`Markup.ts`)
- InlineKeyboard - Up to 3 buttons
- InlineList - Up to 10 items with optional sections
- InlineButton - Individual button component
- ListItem - Individual list item
- ListSection - Grouped list items
- InlineLocationRequest - Request user location

#### 7. Message API (`Message.ts`)
- sendTextMessage - Send text
- sendInteractiveMessage - Send buttons/lists
- sendTemplateMessage - Send approved templates
- sendMediaMessage - Send media files
- sendLocationMessage - Send location
- downloadMedia - Download media files
- markAsRead - Mark messages as read

### Type Safety

Complete TypeScript definitions for:
- All classes and interfaces
- WhatsApp API payloads
- Handler functions
- Configuration options
- Return types

### Testing

- Jest test framework
- Unit tests for core functionality
- Tests for markup components
- Tests for utility functions
- Tests for context management, every store adapter, optimistic locking and next-step flows
- Test coverage reporting

### Build System

A single `tsc` build (`module: NodeNext`, target ES2020) emitting into `dist/`:
- **ESM** `.js` files — the only runtime format
- **Type declarations** (`.d.ts` + declaration maps) — always shipped
- No CommonJS output; consumers must `import` the package

### Documentation

Comprehensive documentation:
- README with quick start guide
- API reference
- Usage examples
- Setup instructions
- TypeScript usage guide
- Best practices
- Code examples for common scenarios

## NPM Package Details

**Package Name**: `whatsapp-cloud-bot`
**Version**: 2.0.0
**License**: MIT
**Node**: ≥ 18
**Entry point** (`exports["."]`):
- `dist/index.js` - ES module entry (`import` condition)
- `dist/index.d.ts` - Type declarations (`types` condition)

**Dependencies**:
- axios - HTTP client
- form-data - Multipart form data (media uploads)
- mime-types - MIME lookup for media uploads
- dotenv - Optional `.env` loading (`DEBUG`, `LOG_LEVEL`, `IGNORE_AFTER_MINUTES`)
- No database or Redis drivers — context stores accept your own connected client

**Dev Dependencies**:
- TypeScript 5.2
- Jest with ts-jest
- ESLint with TypeScript plugin
- Prettier
- Type definitions

## Installation

```bash
npm install whatsapp-cloud-bot
```

## Basic Usage

```typescript
import { WhatsApp } from 'whatsapp-cloud-bot';

const client = new WhatsApp({
  numberId: 'YOUR_PHONE_NUMBER_ID',
  token: 'YOUR_ACCESS_TOKEN',
});

client.onTextMessage(async (update) => {
  await update.replyWithText('Hello!');
});

await client.processUpdate(webhookPayload);
```

## Building the Package

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build for production
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

## Publishing to NPM

```bash
# Build and test
npm run build
npm test

# Login to NPM
npm login

# Publish
npm publish
```

## Key Differences from Python Version

### Architectural Changes

1. **Queue System**
   - Python: Threading with Queue
   - JavaScript: Async queue with Promise-based processing

2. **Type System**
   - Python: Type hints (optional)
   - JavaScript: Full TypeScript with strict types

3. **Handler Registration**
   - Python: Decorators
   - JavaScript: Method calls with function parameters

4. **Context Management**
   - Python: In-process dictionary
   - JavaScript: External store (Redis / SQL) with optimistic locking; next steps persisted by name

5. **Error Handling**
   - Python: Try/except
   - JavaScript: Try/catch with Promise rejections

### API Improvements

1. **Async Operations**: All operations are async by default
2. **Better Ergonomics**: Cleaner API with fewer parameters
3. **Type Safety**: Complete IDE support with autocomplete
4. **Modern Patterns**: Uses ES6+ features throughout
5. **Error Messages**: More descriptive validation errors

### New Features

1. **Document Handler**: Added support for document messages
2. **Better Validation**: More comprehensive input validation
3. **Queue Status**: Can check queue processing status
4. **Persistent Context & Next Steps**: External storage with optimistic locking, safe for multi-instance deployments
5. **Multiple Exports**: Export individual classes for flexibility

## Next Steps

To deploy this library:

1. **Install Dependencies**:
   ```bash
   cd js-library
   npm install
   ```

2. **Run Tests**:
   ```bash
   npm test
   ```

3. **Build**:
   ```bash
   npm run build
   ```

4. **Publish to NPM**:
   ```bash
   npm publish
   ```

## Maintenance

- Update dependencies regularly
- Add new WhatsApp API features as they're released
- Expand test coverage
- Add more examples
- Improve documentation
- Monitor issues and PRs

## Support

For issues and feature requests:
- GitHub Issues: [https://github.com/Radi-dev/whatsapp-cloud-bot-ts/issues](https://github.com/Radi-dev/whatsapp-cloud-bot-ts/issues)
- Email: evaradi18@gmail.com

## License

MIT License - see LICENSE file for details.

---

**Ready for NPM Publishing**: ✅

All necessary files are in place:
- ✅ Source code with TypeScript
- ✅ Type definitions
- ✅ Build configurations
- ✅ Tests with Jest
- ✅ Documentation (README, examples, API docs)
- ✅ Package.json with proper metadata
- ✅ LICENSE file
- ✅ .gitignore and .npmignore
- ✅ CHANGELOG
- ✅ Single ESM build with type declarations

The library is production-ready and can be published to NPM immediately after running `npm install` and `npm run build`.
