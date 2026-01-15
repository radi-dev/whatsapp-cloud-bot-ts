# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/Radi-dev/whatsapp-cloud-bot-ts/releases/tag/v1.0.0
