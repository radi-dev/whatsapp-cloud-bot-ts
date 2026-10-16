# WhatsApp Bot Client

A powerful, fully-typed **TypeScript (ESM-only)** library for building WhatsApp bots using the [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

Looking for Python? A Python version exists here: [python-whatsapp-bot](https://github.com/radi-dev/python-whatsapp-bot).

[![npm version](https://img.shields.io/npm/v/whatsapp-cloud-bot-ts.svg)](https://www.npmjs.com/package/whatsapp-cloud-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue.svg)](https://www.typescriptlang.org/)

## Features

✨ **Fully Typed** - Complete TypeScript support with comprehensive type definitions
🚀 **Async/Await** - Modern async architecture built from the ground up
📦 **ESM-only, TypeScript-first** - Native ES modules with bundled type declarations; no extra build configuration
🎯 **Event-Driven** - Elegant handler-based message routing
💬 **Interactive Messages** - Support for buttons, lists, and location requests
📸 **Media Support** - Send and receive images, videos, audio, documents, and stickers
🔄 **Conversation Flow** - Persistent per-user context and next-step handlers, backed by Redis / PostgreSQL / MySQL / SQLite — survives restarts and works across multiple instances
🧪 **Well Tested** - Comprehensive test suite included
📚 **Great Documentation** - Detailed guides and API reference

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Getting WhatsApp Credentials](#getting-whatsapp-credentials)
- [Usage Examples](#usage-examples)
- [Conversation Context](#conversation-context)
- [API Reference](#api-reference)
- [TypeScript Usage](#typescript-usage)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install whatsapp-cloud-bot

# or with yarn
yarn add whatsapp-cloud-bot

# or with pnpm
pnpm add whatsapp-cloud-bot
```

**Requirements:** Node.js ≥ 18 and an ES-module project. The package ships native ESM with type declarations only — use `import`, not `require()`:

```typescript
import { WhatsApp } from 'whatsapp-cloud-bot';
```

In a TypeScript project set `"module": "NodeNext"` (or `"ESNext"` + `"moduleResolution": "Bundler"`) so the `exports` map resolves. If your project compiles to CommonJS, load it with a dynamic `await import('whatsapp-cloud-bot')`.

## Quick Start

You can initialize the client in two ways.

### Method 1: Initialize with Handlers (Recommended)

Pass your handlers directly to the constructor for a cleaner setup.

```typescript
import { WhatsApp, MessageHandler } from 'whatsapp-cloud-bot';

const messageHandler = new MessageHandler(async (update) => {
  await update.replyMessage('Hello!');
});

const client = new WhatsApp({
  numberId: 'YOUR_PHONE_NUMBER_ID',
  token: 'YOUR_ACCESS_TOKEN',
  handlers: {
    messageHandler,
  }
});
```

### Method 2: Register Handlers Separately

Initialize the client first, then register handlers.

```typescript
import { WhatsApp } from 'whatsapp-cloud-bot';

const client = new WhatsApp({
  numberId: 'YOUR_PHONE_NUMBER_ID',
  token: 'YOUR_ACCESS_TOKEN',
});

// Register a message handler
client.onTextMessage(async (update) => {
  console.log(`Message from ${update.userDisplayName}: ${update.messageText}`);
  await update.replyWithText('Hello! Thanks for your message.');
});
```

### Webhook Integration

```typescript
// Process incoming webhook (in your Express/HTTP server)
app.post('/webhook', async (req, res) => {
  await client.processUpdate(req.body);
  res.sendStatus(200);
});
```

## Getting WhatsApp Credentials

To use this library, you need to obtain a **Phone Number ID** and **Access Token** from the [Facebook Developer Portal](https://developers.facebook.com/).

### Step-by-Step Guide:

1. **Create a Meta/Facebook Developer Account**
   - Go to [developers.facebook.com](https://developers.facebook.com/)
   - Create an account or log in

2. **Create a New App**
   - Click "Create App"
   - Select "Business" as the app type
   - Fill in the required details

3. **Add WhatsApp Product**
   - In your app dashboard, click "Add Product"
   - Find "WhatsApp" and click "Set Up"

4. **Get Your Credentials**
   - **Phone Number ID**: Found in the WhatsApp > Getting Started section
   - **Temporary Token**: Also in the Getting Started section (valid for 24 hours)
   - **Permanent Token**: Follow [this guide](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#1--acquire-an-access-token-using-a-system-user-or-facebook-login) to create a permanent token

5. **Set Up Webhook** (for receiving messages)
   - In WhatsApp > Configuration
   - Add your webhook URL (must be HTTPS)
   - Subscribe to message events
   - Verify the webhook

### Testing Your Setup

WhatsApp provides a test phone number you can use immediately. For production, you'll need to:
- Add a real phone number
- Complete business verification
- Get your app approved

## Usage Examples

### Sending Different Types of Messages

#### Text Messages

```typescript
// Simple text message
await client.sendMessage('1234567890', 'Hello, World!');

// With web preview
await client.sendMessage('1234567890', 'Check this out: https://example.com', {
  webPagePreview: true
});
```

#### Interactive Messages with Buttons

```typescript
import { InlineKeyboard } from 'whatsapp-cloud-bot';

await client.sendMessage(
  '1234567890',
  'Choose an option:',
  {
    replyMarkup: new InlineKeyboard(['Option 1', 'Option 2', 'Option 3'])
  }
);
```

#### Interactive Lists

```typescript
import { InlineList, ListItem, ListSection } from 'whatsapp-cloud-bot';

// Simple list
const list = new InlineList('Select item', [
  new ListItem('Item 1', 'item_1'),
  new ListItem('Item 2', 'item_2')
]);

// List with sections
const sectionedList = new InlineList('Choose category', [
  new ListSection('Fruits', ['Apple', 'Banana', 'Orange']),
  new ListSection('Vegetables', ['Carrot', 'Broccoli', 'Spinach'])
]);

await client.sendMessage('1234567890', 'Here are your options:', {
  replyMarkup: sectionedList
});
```

#### Interactive Media Carousels

Carousels come in two flavours — **quick-reply buttons** or **CTA URL buttons**. All cards in a carousel must use the same button type and count (all cards must have the same number of buttons).

Use the `ButtonCarouselCard` and `UrlCarouselCard` types — your IDE will guide you through the required fields. Internal fields (`card_index`, `type`, `header.type`, `action.name`/`button.type`) are populated for you at send time, so you only set the header, body, and action.

```typescript
import type { ButtonCarouselCard, UrlCarouselCard } from 'whatsapp-cloud-bot';

// --- Quick-reply button carousel ---
const qrCards: ButtonCarouselCard[] = [
  {
    header: { image: { link: 'https://example.com/img1.jpg' } },
    body: { text: 'First Item — tap a button below' },
    action: {
      buttons: [{ quick_reply: { id: 'buy_1', title: 'Buy Now' } }],
    },
  },
  {
    header: { video: { link: 'https://example.com/vid1.mp4' } },
    body: { text: 'Second Item' },
    action: {
      buttons: [{ quick_reply: { id: 'buy_2', title: 'Add to Cart' } }],
    },
  },
];

await client.sendButtonCarousel('1234567890', 'Check out these items:', qrCards);

// --- CTA URL button carousel ---
const urlCards: UrlCarouselCard[] = [
  {
    header: { image: { link: 'https://example.com/img1.jpg' } },
    body: { text: 'Visit our store' },
    action: {
      parameters: { display_text: 'Shop Now', url: 'https://example.com/shop' },
    },
  },
  {
    header: { image: { link: 'https://example.com/img2.jpg' } },
    body: { text: 'Read our blog' },
    action: {
      parameters: { display_text: 'Read More', url: 'https://example.com/blog' },
    },
  },
];

await client.sendUrlCarousel('1234567890', 'Explore our content:', urlCards);
```

> `CarouselCard<QuickReplyAction>` / `CarouselCard<CtaUrlAction>` remain available and are equivalent to the `ButtonCarouselCard` / `UrlCarouselCard` aliases above.

You can also reply to an incoming message directly from a handler:

```typescript
client.onMessage(async (update) => {
  // Quick-reply carousel reply
  await update.replyWithButtonCarousel('Pick one:', qrCards);

  // CTA URL carousel reply
  await update.replyWithUrlCarousel('Explore:', urlCards);
});
```

#### Flow Messages

Send an interactive [WhatsApp Flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows). Provide **either** `flow_id` **or** `flow_name` (mutually exclusive) plus a `flow_cta`; the library fills in the documented defaults (`flow_message_version: '3'`, `mode: 'published'`, `flow_token: 'unused'`, `flow_action: 'navigate'`) and serializes `flow_action_payload.data` to the JSON string the API expects.

```typescript
// Navigate to a specific screen with prefilled data
await client.sendFlowMessage('1234567890', 'Complete your signup', {
  flow_id: '1234567890',
  flow_cta: 'Sign up',
  flow_token: 'order_42',                 // your correlation id (default 'unused')
  flow_action: 'navigate',                // default
  flow_action_payload: {
    screen: 'WELCOME',                    // default FIRST_ENTRY_SCREEN
    data: { plan: 'pro' },                // serialized to a JSON string for you
  },
});

// data_exchange — first screen resolved by your endpoint (payload omitted)
await client.sendFlowMessage('1234567890', 'Book an appointment', {
  flow_name: 'booking',
  flow_cta: 'Book now',
  flow_action: 'data_exchange',
});

// Reply from a handler
client.onMessage((update) =>
  update.replyWithFlow('Tap to start', { flow_id: '123', flow_cta: 'Start' })
);
```

Building Flow markup directly (e.g. to pass via `sendMessage`) is also supported with `new InlineFlow({...})`.

#### Dedicated interactive senders

Besides `sendMessage({ replyMarkup })`, there are explicit senders: `sendTextMessage` (text only), `sendButtonMessage`, `sendListMessage`, and `sendFlowMessage` — each with `Update` equivalents `replyWithText`, `replyWithButton`, `replyWithList`, `replyWithFlow`.

> **Naming:** newer methods use the `replyWith*` style (e.g. `replyWithMedia`, `replyWithImage`). The older names (`replyMedia`, `replyImage`, `replyMessage`, …) still work but are **deprecated** — prefer the `replyWith*` versions.

#### Media Messages

```typescript
// Send image
await client.sendImage('1234567890', 'https://example.com/image.jpg', 'Check this out!');

// Send video
await client.sendVideo('1234567890', 'https://example.com/video.mp4');

// Send document
await client.sendDocument('1234567890', 'https://example.com/doc.pdf', 'Here is the file');

// Send audio
await client.sendAudio('1234567890', 'https://example.com/audio.mp3');
```

#### Location Messages

```typescript
await client.sendLocation(
  '1234567890',
  37.7749,  // latitude
  -122.4194, // longitude
  'San Francisco',
  '123 Market St, San Francisco, CA'
);
```

#### Template Messages

```typescript
await client.sendTemplateMessage(
  '1234567890',
  'hello_world', // template name
  [],            // components
  'en_US'        // language code
);
```

### Handling Incoming Messages

> **Handler naming:** `onTextMessage` is the preferred name for plain-text handlers (`onMessage` still works but is **deprecated**). For interactive replies, prefer the sub-type-specific `onButtonReply` / `onListReply` / `onFlowReply` over the combined `onInteractiveMessage`.

#### Basic Text Handler

```typescript
client.onTextMessage(async (update) => {
  console.log(`Received: ${update.messageText}`);
  await update.replyWithText('Got your message!');
});
```

#### With Regex Filter

```typescript
// Only respond to messages matching regex
client.onMessage(
  async (update) => {
    await update.replyMessage('You said hello!');
  },
  { regex: /^(hi|hello|hey)/i }
);
```

#### With Custom Filter

```typescript
client.onMessage(
  async (update) => {
    await update.replyMessage('Processing your order...');
  },
  {
    filter: (text) => text.toLowerCase().includes('order')
  }
);
```

#### Interactive Reply Handlers

```typescript
// Button replies only
client.onButtonReply(async (update) => {
  console.log('Button id:', update.buttonReply?.id);
});

// List replies only
client.onListReply(async (update) => {
  console.log('List id:', update.listReply?.id);
});

// Or handle both at once (combined)
client.onInteractiveMessage(async (update) => {
  if (update.messageText === 'option_1') {
    await update.replyWithText('You selected Option 1');
  }
});
```

#### Flow Reply Handler

When a user completes a [Flow](#flow-messages), WhatsApp sends an interactive `nfm_reply`. Register an `onFlowReply` handler — the parsed Flow response is on `update.flowReply`:

```typescript
client.onFlowReply(async (update) => {
  const reply = update.flowReply!;
  console.log('Flow token:', reply.flowToken);  // your correlation token
  console.log('Response data:', reply.data);     // parsed response_json
  // reply.responseJson holds the raw string
});
```

> A ready-made two-step auth Flow (email → OTP, with a "register → not available → back" branch) is included at [`examples/auth_flow.json`](examples/auth_flow.json). The `EMAIL` screen submits `{ email }` to your endpoint; the `OTP` screen quotes the email via `${data.email}` and submits `{ email, otp }`. Pair it with the [Flow endpoint helpers](#implementing-a-flow-endpoint).

#### Media Handlers

```typescript
// Handle images
client.onImageMessage(async (update) => {
  console.log(`Image caption: ${update.messageText}`);
  console.log(`Image ID: ${update.mediaFileId}`);

  // Download the image
  const filePath = await client.downloadMedia(update.mediaFileId);
  console.log(`Image saved to: ${filePath}`);
});

// Handle videos
client.onVideoMessage(async (update) => {
  await update.replyMessage('Thanks for the video!');
});

// Handle audio
client.onAudioMessage(async (update) => {
  if (update.mediaVoice) {
    await update.replyMessage('Got your voice message!');
  }
});

// Handle documents
client.onDocumentMessage(async (update) => {
  const buffer = await client.downloadMediaData(update.mediaFileId);
  // Process document...
});
```

#### Location Handler

```typescript
client.onLocationMessage(async (update) => {
  const { locLatitude, locLongitude, locName } = update;
  await update.replyMessage(
    `Got your location: ${locName || 'Unknown'} (${locLatitude}, ${locLongitude})`
  );
});
```

#### Message Status Handler

WhatsApp sends `statuses` webhooks reporting what happened to messages **you sent** (`sent`, `delivered`, `read`, `failed`). Register a handler with `onMessageStatus`. The status's `messageId` (wamid) is the only field linking it back to the original message.

```typescript
// React to every status change
client.onMessageStatus((status) => {
  console.log(`${status.messageId} → ${status.status}`);
});

// Or only to failures
client.onMessageStatus((status) => {
  console.error(
    `Delivery to ${status.recipientId} failed:`,
    status.error?.code,
    status.error?.title
  );
  // status.callbackData holds your biz_opaque_callback_data, if you set one
}, { status: 'failed' });
```

A `StatusUpdate` exposes `messageId`, `status`, `recipientId`, `timestamp` (a `Date`), `errors`/`error`, `conversation`, `pricing`, `callbackData`, and the booleans `isSent` / `isDelivered` / `isRead` / `isFailed`.

> **Correlating a status to your message:** the library is stateless — it does not retain sent-message ids. To act on a status (especially `failed`), record the wamid returned in the send response (`response.data.messages[0].id`) against your own domain data, or tag outgoing messages with `biz_opaque_callback_data` so it is echoed back on the status. See _Best Practices_ for handling failures.

**Tagging messages for correlation (`bizOpaqueCallbackData`).** Every send method accepts an optional tracking string that WhatsApp echoes back on the status webhook as `status.callbackData`. Stamp your own record id onto the message and you can route the status without a wamid lookup table:

```typescript
// On send — pass your own id (options object on sendMessage/sendMediaMessage,
// last positional arg on the others)
await client.sendMessage(user, 'Your order shipped!', {
  bizOpaqueCallbackData: 'order_12345',
});
await client.sendTemplateMessage(user, 'shipping', [], 'en_US', 'order_12345');

// On status — it comes straight back
client.onMessageStatus((status) => {
  if (status.isFailed) {
    markOrderNotificationFailed(status.callbackData); // "order_12345"
  }
}, { status: 'failed' });
```

**Ignoring stale events.** Every handler (message *and* status) accepts `ignoreAfterMinutes` — if more than that many minutes have elapsed since the webhook's `timestamp` (WEBHOOK_TRIGGER_TIMESTAMP), the handler is skipped. Useful for dropping events replayed or delivered long after the fact:

```typescript
// Ignore messages older than 5 minutes (e.g. webhook retries / backlog)
client.onMessage(handler, { ignoreAfterMinutes: 5 });

// Only act on fresh failures
client.onMessageStatus(handler, { status: 'failed', ignoreAfterMinutes: 10 });
```

### Conversation Flow Management

Multi-turn conversations need two things: somewhere to keep **per-user state** between messages, and a way to say **"route this user's next message to that handler"**. Both are provided by the context manager described in [Conversation Context](#conversation-context) — this section shows the flow side; read that section for setup.

#### Using Next Step Handlers

Step handlers are registered **by name at startup** (on every instance) and the name is persisted with the user's context, so a flow started on one server can continue on another, or after a restart.

```typescript
import { WhatsApp, TextHandler, RedisContextStore } from 'whatsapp-cloud-bot';

const client = new WhatsApp({
  numberId: process.env.WA_PHONE_NUMBER_ID!,
  token: process.env.WA_TOKEN!,
  contextStore: new RedisContextStore(redis), // required for context and next steps
  steps: {
    ask_name: new TextHandler(async (update, context) => {
      context.set('name', update.messageText);
      await update.replyWithText('And your email?');
      await client.setNextStep(update, 'ask_email', { fallback: 'cancel' });
    }),
    ask_email: new TextHandler(async (update, context) => {
      await update.replyWithText(`Thanks ${context.get('name')}, we'll write to ${update.messageText}.`);
      context.clear(); // flow finished
    }),
    cancel: new TextHandler(async (update, context) => {
      context.clear();
      await update.replyWithText('Registration cancelled.');
    }),
  },
});

// Steps can also be registered one at a time:
// client.registerStep('ask_name', new TextHandler(...));

client.onTextMessage(
  async (update) => {
    await update.replyWithText('What is your name?');
    // Route this user's next message to the `ask_name` step. If it matches
    // the fallback regex (default /^(end|stop|cancel)$/i) run `cancel` instead.
    await client.setNextStep(update, 'ask_name', { fallback: 'cancel' });
  },
  { regex: /^register$/i }
);
```

How routing works while a step is pending:

- The step (or its fallback, when the text matches `fallbackRegex`) receives the next message and is **consumed** — the user is back to normal routing afterwards, unless the step sets a new one.
- Regular handlers are skipped; **persistent** handlers (`{ persistent: true }`) still run first and do not consume the step.
- A step only fires for its own message type (a `TextHandler` step ignores an image — the step stays pending).
- If the step handler throws, the step stays pending and its context changes are discarded.
- `setNextStep` / `clearNextStep` / `getNextStep` also accept a phone number, for use outside handlers (cron jobs, admin endpoints).

> **Why names instead of inline handlers?** A closure lives in one process's memory; it cannot be stored in Redis or reached by another server. Passing an unregistered handler instance or a fallback *function* to `setNextStep` throws with guidance. Unknown step names throw `UnknownStepError` immediately.

## Conversation Context

The context manager stores a JSON document per user (keyed by phone number) in an **external store**, so state survives restarts and is shared across workers and servers. You bring an already-connected database/Redis client; the library has no database dependencies.

### Setup

Every backend is instantiated the same way — `new XxxContextStore(client, options)` — and wired the same way:

```typescript
import {
  WhatsApp,
  RedisContextStore,
  PostgresContextStore,
  MySqlContextStore,
  SqliteContextStore,
  MemoryContextStore,
} from 'whatsapp-cloud-bot';

// Redis (>= 4.0) — ioredis or node-redis (v4+, call .connect() first)
const store = new RedisContextStore(redis, { namespace: 'mybot', ttlSeconds: 86400 });

// PostgreSQL — a `pg` Pool or Client
const store = new PostgresContextStore(pgPool, { namespace: 'mybot', ttlSeconds: 86400 });

// MySQL / MariaDB — a `mysql2/promise` Pool or Connection
const store = new MySqlContextStore(mysqlPool, { namespace: 'mybot', ttlSeconds: 86400 });

// SQLite — better-sqlite3, node:sqlite (DatabaseSync), or the `sqlite` package
const store = new SqliteContextStore(db, { namespace: 'mybot', ttlSeconds: 86400 });

// In-process — tests and local development ONLY (lost on restart, not shared)
const store = new MemoryContextStore({ ttlSeconds: 86400 });

const client = new WhatsApp({ numberId, token, contextStore: store });
```

**Options (all backends):**
- `namespace` — Redis key prefix (`<namespace>:<phone>`) or SQL table name. Default `wa_user_context`. Letters, digits, underscores; optionally schema-qualified (`public.bot_ctx`).
- `ttlSeconds` — sliding inactivity expiry; refreshed on every write and on read-only turns. Omit to keep contexts forever. **Recommended in production:** with redelivery dedupe on (the default) every user who has ever been handled keeps a small record holding their last handled message ids, and only a TTL reclaims it.
- SQL stores additionally accept `autoCreateTable` (default `true`; runs `CREATE TABLE IF NOT EXISTS` on first use). Call `store.setup()` to run the DDL yourself during deployment and `store.purgeExpired()` from a cron job to reclaim expired rows (they are otherwise only removed lazily when that user is next read).

The SQL table (identical across dialects; `MEDIUMTEXT`/`utf8mb4` on MySQL):

```sql
CREATE TABLE IF NOT EXISTS wa_user_context (
  user_id    VARCHAR(128) PRIMARY KEY,
  data       TEXT   NOT NULL,  -- JSON document
  version    BIGINT NOT NULL,  -- optimistic-lock counter
  expires_at BIGINT NULL,      -- epoch ms, NULL = never
  updated_at BIGINT NOT NULL   -- epoch ms
);
```

Other drivers (knex, Drizzle, postgres.js, …): extend the exported `SqlContextStore` base class and implement `runQuery(sql, params)`, or implement the small `ContextStore` interface (`get` / `set` / `delete` / optional `touch`) directly.

### Using the context in handlers

Declare a second parameter and the handler becomes **context-aware**: the dispatcher loads the user's document before the handler runs, you read and write it synchronously, and it is saved after the handler resolves.

```typescript
client.onTextMessage(async (update, context) => {
  const step = context.get('step', 0);          // typed as number

  switch (step) {
    case 0:
      context.set('step', 1);
      await update.replyWithText('Welcome! What is your name?');
      break;
    case 1:
      context.set('name', update.messageText).set('step', 2);
      await update.replyWithText('How old are you?');
      break;
    case 2:
      await update.replyWithText(`Hello ${context.get('name')}, you are ${update.messageText}!`);
      context.clear();                          // record is deleted on save
      break;
  }
});
```

- Values must be JSON-serialisable. Nested mutations (`context.get('items').push(x)`) are detected.
- If the handler **throws**, unsaved changes are discarded. Call `await context.save()` to commit earlier.
- `context` is also available as `update.context` (for helper functions that only receive the update); it throws if no store is configured.
- Outside handlers: `const ctx = await client.getContext(phone); ctx.set(...); await ctx.save();` and `await client.clearContext(phone)`.

### Fail-fast configuration

Context is opt-in and **strict**:

- A handler that declares a `context` parameter (or sets `{ context: true }`) **requires** a `contextStore`. Registering one without a store throws `ContextStoreRequiredError` at startup — not on the first message. `{ context: false }` opts a two-argument function out.
- `getContext`, `clearContext`, `update.context`, `registerStep`, `setNextStep`, `clearNextStep` and `getNextStep` throw `ContextStoreRequiredError` without a store.
- Handlers without a `context` parameter never touch the store, so nothing changes for bots that don't use it.

Detection uses the function's declared parameter count; if your handler uses a default value or rest parameter for `context`, set `{ context: true }` explicitly.

### Concurrency: optimistic locking

Within one process, messages from the same user are processed one at a time. Across **multiple instances**, two handlers may run for the same user concurrently. Every record carries a `version`; a save only succeeds if the version is unchanged since the load, otherwise `ContextConflictError` is thrown and the dispatcher **re-runs the handler from scratch against the fresh record** — up to `contextConflictRetries` times (default 3) before the error propagates out of `processUpdate`. Routing is re-resolved on each attempt, so a next step already consumed elsewhere is not run twice.

Consequence: a side effect (e.g. a reply) performed *before* a conflicting save is repeated on the retry. Conflicts are rare in practice (they need the same user to be handled on two servers at the same moment), but keep handlers reasonably idempotent. Set `contextConflictRetries: 0` to handle `ContextConflictError` yourself.

The lock is enforced atomically in each backend: Lua scripts on Redis, `UPDATE … WHERE version = ?` / `INSERT … ON CONFLICT DO NOTHING` (`INSERT IGNORE` on MySQL) checked against affected rows on SQL.

### Webhook retries and idempotency

WhatsApp delivers webhooks **at least once**: if your endpoint does not answer `200` quickly enough (handler still running, process crashed after committing, network hiccup) Meta redelivers the same payload — same `wamid` — repeatedly with backoff, for a long time. Two things in the library deal with this; they are designed to compose, not clash, with the optimistic-locking retries above:

1. **Failed handler → redelivery retries it.** A handler that throws (or exhausts `contextConflictRetries`) commits nothing, so when the redelivered webhook arrives the handler runs again against the same state. Return a non-2xx from your webhook route in that case (the examples below do) and Meta's retry becomes your retry.
2. **Successful handler → redelivery is skipped.** With `dedupeMessages` (default `true` when a `contextStore` is configured) the handled message ids are saved in the user's record **in the same save, under the same lock** as the handler's changes. A redelivery — on any instance, even one racing the original — is therefore either skipped, or loses the lock, re-loads and then skips. The last 20 ids per user are kept; a message no handler matched is not marked.

Notes:

- Handlers default to `ignoreAfterMinutes: 5`, so a redelivery arriving later than that never runs a handler (the route still returns 200, so Meta stops). Raise it if you rely on Meta's longer retry window, or lower it to drop stale traffic sooner.
- The in-process conflict re-runs happen *within* one webhook request, with no delay, so they only add a few handler executions of latency. Keep handlers fast so the response stays well within Meta's timeout; if your handlers are slow, acknowledge first and process asynchronously (`client.processUpdate(req.body).catch(log); res.sendStatus(200);`) — and then rely on dedupe plus your own error reporting, since Meta will no longer retry for you.
- Dedupe needs a store; without one nothing is remembered and a redelivery is processed again, exactly as in previous versions.

## API Reference

### WhatsApp Client

#### Constructor

```typescript
const client = new WhatsApp(config: WhatsAppConfig);
```

**Configuration Options:**
- `numberId` (required): Your WhatsApp Phone Number ID
- `token` (required): Your WhatsApp Access Token
- `markAsRead` (optional, default: `true`): Auto-mark messages as read
- `showTyping` (optional): Show a typing indicator while marking as read
- `version` (optional, default: `21`): WhatsApp API version
- `handlers` (optional): Handlers to register up-front, e.g. `{ greeting: new TextHandler(fn) }`
- `contextStore` (optional): A `ContextStore` (Redis / PostgreSQL / MySQL / SQLite / Memory). **Required** as soon as any handler declares a `context` parameter or you use next steps — see [Conversation Context](#conversation-context)
- `contextConflictRetries` (optional, default: `3`): How many times a handler is re-run after an optimistic-locking conflict
- `dedupeMessages` (optional, default: `true`): Skip webhook redeliveries of messages already handled for that user (needs `contextStore`) — see [Webhook retries and idempotency](#webhook-retries-and-idempotency)
- `steps` (optional): Named step handlers for next-step flows, e.g. `{ ask_name: new TextHandler(fn) }`

#### Methods

**Sending Messages:**
- `sendMessage(phoneNumber, text, options?)` - Send text message
- `sendTemplateMessage(phoneNumber, templateName, components?, languageCode?)` - Send template
- `sendImage(phoneNumber, imagePath, caption?)` - Send image
- `sendVideo(phoneNumber, videoPath, caption?)` - Send video
- `sendAudio(phoneNumber, audioPath)` - Send audio
- `sendDocument(phoneNumber, docPath, caption?)` - Send document
- `sendLocation(phoneNumber, latitude, longitude, name?, address?)` - Send location

**Media Management:**
- `getMediaUrl(mediaId)` - Get media URL from media ID
- `downloadMedia(mediaId, filePath?)` - Download media to file
- `downloadMediaData(mediaId)` - Download media as Buffer

**Handler Registration:**
- `onMessage(action, options?)` - Register text message handler
- `onInteractiveMessage(action, options?)` - Register interactive handler
- `onImageMessage(action, options?)` - Register image handler
- `onAudioMessage(action, options?)` - Register audio handler
- `onVideoMessage(action, options?)` - Register video handler
- `onDocumentMessage(action, options?)` - Register document handler
- `onStickerMessage(action, options?)` - Register sticker handler
- `onLocationMessage(action, options?)` - Register location handler

**Conversation Context & Flow Control:**
- `getContext(phoneNumber)` - Load a user's `UserContext` outside a handler (`await context.save()` to persist)
- `clearContext(phoneNumber)` - Delete a user's context (data and pending step)
- `registerStep(name, handler)` - Register a named step handler (also via the `steps` config option)
- `setNextStep(update | phoneNumber, stepName, { fallback?, fallbackRegex? }?)` - Route the user's next message to a step
- `clearNextStep(update | phoneNumber)` - Cancel the pending step
- `getNextStep(update | phoneNumber)` - Inspect the pending step (`{ step, fallback?, fallbackRegex? }`)

**Webhook Processing:**
- `processUpdate(webhookPayload)` - Process incoming webhook

### Update Object

Available in all handler functions as the first parameter:

```typescript
interface Update {
  bot: WhatsApp;
  userDisplayName: string;
  userPhoneNumber: string;
  messageId: string;
  messageText?: string;
  message: WhatsAppMessage;

  // Conversation context (only when a contextStore is configured; throws otherwise)
  context: UserContext;
  hasContext: boolean;

  // Media properties (when applicable)
  mediaMimeType?: string;
  mediaFileId?: string;
  mediaHash?: string;
  mediaVoice?: boolean;

  // Location properties (when applicable)
  locLatitude?: number;
  locLongitude?: number;
  locName?: string;
  locAddress?: string;

  // Methods
  replyMessage(text, options?): Promise<AxiosResponse>;
  replyMedia(mediaPath, options?): Promise<AxiosResponse>;
  replyTemplate(templateName, components?, languageCode?): Promise<AxiosResponse>;
}
```

### UserContext

The object handed to context-aware handlers (second parameter) and available as `update.context`. Full details in [Conversation Context](#conversation-context).

```typescript
class UserContext {
  readonly userId: string;
  readonly version: number;     // optimistic-lock version (0 = no record yet)
  readonly exists: boolean;
  readonly isDirty: boolean;
  readonly isEmpty: boolean;
  readonly size: number;

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  set(key: string, value: unknown): this;   // undefined removes the key
  assign(values: Record<string, unknown>): this;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;                            // data only; step and handled ids stay
  keys(): string[];
  all(): Record<string, unknown>;

  nextStep: NextStepState | undefined;      // { step, fallback?, fallbackRegex? }
  setNextStep(step: string, options?: { fallback?: string; fallbackRegex?: RegExp | string }): this;
  clearNextStep(): boolean;

  recentMessages: readonly string[];        // handled wamids (redelivery dedupe)
  hasSeenMessage(messageId: string): boolean;
  markMessageSeen(messageId: string): this;

  save(): Promise<void>;                    // throws ContextConflictError on concurrent modification
  reload(): Promise<void>;
  destroy(): Promise<void>;                 // unconditional delete of data + step
}
```

## TypeScript Usage

The library is written in TypeScript and provides full type definitions:

```typescript
import {
  WhatsApp,
  Update,
  InlineKeyboard,
  HandlerFunction,
} from 'whatsapp-cloud-bot';

// Stateless handler
const myHandler: HandlerFunction = async (update: Update) => {
  // Full autocomplete and type checking
  const text: string | undefined = update.messageText;
  await update.replyWithText('Hello!');
};

// Context-aware handler — `context` is a UserContext (requires a contextStore)
const statefulHandler: HandlerFunction = async (update, context) => {
  const visits: number = context.get('visits', 0) + 1;
  context.set('visits', visits);
  await update.replyWithText(`Visit #${visits}`);
};

client.onTextMessage(myHandler);
client.onTextMessage(statefulHandler);
```

## Setting Up a Webhook Server

### Express.js Example

```typescript
import express from 'express';
import { WhatsApp } from 'whatsapp-cloud-bot';

const app = express();
const client = new WhatsApp({
  numberId: process.env.WA_PHONE_NUMBER_ID!,
  token: process.env.WA_TOKEN!,
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook handler (POST)
app.post('/webhook', express.json(), async (req, res) => {
  try {
    await client.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Register handlers
client.onMessage(async (update) => {
  await update.replyMessage('Hello from Express!');
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

## Implementing a Flow Endpoint

For Flows that use `flow_action: 'data_exchange'`, WhatsApp calls **your** endpoint with an encrypted payload. The library provides helpers for the [endpoint protocol](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint): RSA + AES-GCM decryption, response encryption (with the flipped IV), and `x-hub-signature-256` validation.

```typescript
import express from 'express';
import {
  decryptFlowRequest,
  encryptFlowResponse,
  isFlowSignatureValid,
  FlowEndpointException,
} from 'whatsapp-cloud-bot';

const app = express();
// Capture the raw body for signature validation
app.use(express.json({ verify: (req: any, _res, buf) => (req.rawBody = buf) }));

app.post('/flow', (req: any, res) => {
  if (!isFlowSignatureValid(req.rawBody, req.get('x-hub-signature-256'), process.env.APP_SECRET!)) {
    return res.sendStatus(432); // signature mismatch
  }

  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } =
      decryptFlowRequest(req.body, process.env.FLOW_PRIVATE_KEY!);

    // Health check
    if (decryptedBody.action === 'ping') {
      return res.send(
        encryptFlowResponse({ data: { status: 'active' } }, aesKeyBuffer, initialVectorBuffer)
      );
    }

    // ...your screen/data-exchange logic, building `responseObject`...
    const responseObject = { screen: 'SUCCESS', data: {} };

    res.send(encryptFlowResponse(responseObject, aesKeyBuffer, initialVectorBuffer));
  } catch (err) {
    if (err instanceof FlowEndpointException) return res.sendStatus(err.statusCode);
    console.error(err);
    res.sendStatus(500);
  }
});
```

The encrypted response must be returned as the **raw** HTTP 200 body (a base64 string), not wrapped in JSON.

## Best Practices

1. **Use Environment Variables** for sensitive data:
   ```typescript
   const client = new WhatsApp({
     numberId: process.env.WA_PHONE_NUMBER_ID!,
     token: process.env.WA_TOKEN!,
   });
   ```

2. **Handle Errors Gracefully**:
   ```typescript
   client.onMessage(async (update) => {
     try {
       await update.replyMessage('Hello!');
     } catch (error) {
       console.error('Failed to send message:', error);
     }
   });
   ```

3. **Use an External Context Store in Production** — `MemoryContextStore` is for tests and local development only; it is lost on restart and not shared between instances. Set a `ttlSeconds` so abandoned conversations (and the per-user redelivery markers) expire:
   ```typescript
   const client = new WhatsApp({
     numberId: process.env.WA_PHONE_NUMBER_ID!,
     token: process.env.WA_TOKEN!,
     contextStore: new RedisContextStore(redis, { ttlSeconds: 24 * 3600 }),
   });
   ```

4. **Keep Context-Aware Handlers Reasonably Idempotent** — when two instances handle the same user at the same time, the loser of the optimistic lock is re-run from scratch, so a reply sent *before* the conflicting save is sent again. Prefer doing state changes first and sends last, or `await context.save()` before an irreversible side effect.

5. **Format Phone Numbers Consistently**:
   ```typescript
   // Library handles formatting, but ensure you include country code
   await client.sendMessage('1234567890', 'Hello'); // Good
   ```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Radi](https://github.com/Radi-dev)

## Links

- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [GitHub Repository](https://github.com/Radi-dev/whatsapp-cloud-bot-ts)
- [NPM Package](https://www.npmjs.com/package/whatsapp-cloud-bot-ts)
- [Issue Tracker](https://github.com/Radi-dev/whatsapp-cloud-bot-ts/issues)
- [Python version (python-whatsapp-bot)](https://github.com/radi-dev/python-whatsapp-bot)

## Support

If you find this library useful, please consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting new features
- 📖 Improving documentation
- 🤝 Contributing code

---

Made with ❤️ by the community
