# Example Bot Implementation

This example demonstrates how to build a complete WhatsApp bot with various features.

## Basic Echo Bot

```typescript
import { WhatsApp } from 'whatsapp-cloud-bot';

const client = new WhatsApp({
  numberId: process.env.WA_PHONE_NUMBER_ID!,
  token: process.env.WA_TOKEN!,
});

client.onMessage(async (update) => {
  await update.replyMessage(`You said: ${update.messageText}`);
});

// Or using constructor registration:
// const handler = new MessageHandler(async (update) => {
//   await update.replyMessage(`You said: ${update.messageText}`);
// });
//
// const client = new WhatsApp({
//   numberId: '...',
//   token: '...',
//   handlers: { handler }
// });
```

## Survey Bot with Context

```typescript
client.onMessage(async (update, context) => {
  const step = context.get('step', 0);

  switch (step) {
    case 0:
      context.set('step', 1);
      await update.replyMessage('Welcome! What is your name?');
      break;

    case 1:
      context.set('name', update.messageText);
      context.set('step', 2);
      await update.replyMessage('How old are you?');
      break;

    case 2:
      context.set('age', update.messageText);
      context.set('step', 3);
      await update.replyMessage('What is your email?');
      break;

    case 3:
      context.set('email', update.messageText);
      const name = context.get('name');
      const age = context.get('age');
      const email = context.get('email');

      await update.replyMessage(
        `Thank you!

Name: ${name}
Age: ${age}
Email: ${email}`
      );

      context.clear();
      break;
  }
});
```

## Menu Bot with Buttons

```typescript
import { InlineKeyboard } from 'whatsapp-cloud-bot';

client.onMessage(
  async (update) => {
    await update.replyMessage('Main Menu', {
      replyMarkup: new InlineKeyboard(['Products', 'Services', 'Contact']),
    });
  },
  { regex: /^(menu|start)$/i }
);

client.onInteractiveMessage(async (update) => {
  switch (update.messageText) {
    case 'Products':
      await update.replyMessage('Our products...');
      break;
    case 'Services':
      await update.replyMessage('Our services...');
      break;
    case 'Contact':
      await update.replyMessage('Contact us at support@example.com');
      break;
  }
});
```

## Order Bot with Lists

```typescript
import { InlineList, ListSection } from 'whatsapp-cloud-bot';

client.onMessage(
  async (update) => {
    const menu = new InlineList('View Menu', [
      new ListSection('Pizza', [
        { title: 'Margherita', id: 'pizza_margherita' },
        { title: 'Pepperoni', id: 'pizza_pepperoni' },
      ]),
      new ListSection('Pasta', [
        { title: 'Carbonara', id: 'pasta_carbonara' },
        { title: 'Bolognese', id: 'pasta_bolognese' },
      ]),
    ]);

    await update.replyMessage('What would you like to order?', {
      replyMarkup: menu,
    });
  },
  { regex: /^order$/i }
);

client.onInteractiveMessage(async (update, context) => {
  const orderId = update.messageText;
  context.set('order', orderId);

  await update.replyMessage(
    `You ordered: ${orderId}\n\nConfirm your order?`,
    {
      replyMarkup: new InlineKeyboard(['Yes', 'No']),
    }
  );
});
```

## Image Processing Bot

```typescript
client.onImageMessage(async (update) => {
  await update.replyMessage('Processing your image...');

  try {
    // Download image
    const imagePath = await client.downloadMedia(update.mediaFileId);
    console.log(`Image saved to: ${imagePath}`);

    // Or get as buffer
    const imageBuffer = await client.downloadMediaData(update.mediaFileId);

    // Process image here...

    await update.replyMessage('Image processed successfully!');
  } catch (error) {
    await update.replyMessage('Failed to process image.');
  }
});
```

## Location Tracking Bot

```typescript
import { InlineLocationRequest } from 'whatsapp-cloud-bot';

client.onMessage(
  async (update) => {
    await update.replyMessage('Please share your location', {
      replyMarkup: new InlineLocationRequest(),
    });
  },
  { regex: /^location$/i }
);

client.onLocationMessage(async (update, context) => {
  const { locLatitude, locLongitude, locName, locAddress } = update;

  context.set('location', {
    lat: locLatitude,
    lng: locLongitude,
  });

  await update.replyMessage(
    `Location received!\n` +
      `Name: ${locName || 'N/A'}\n` +
      `Address: ${locAddress || 'N/A'}\n` +
      `Coordinates: ${locLatitude}, ${locLongitude}`
  );
});
```

## Advanced: Multi-Step Wizard

```typescript
import { MessageHandler, InlineKeyboard } from 'whatsapp-cloud-bot';

client.onMessage(
  async (update, context) => {
    await update.replyMessage('Welcome to the registration wizard!');
    await update.replyMessage('Step 1: What is your name?');

    client.setNextStep(
      update,
      new MessageHandler(async (nextUpdate, nextContext) => {
        nextContext.set('name', nextUpdate.messageText);
        await nextUpdate.replyMessage('Step 2: What is your email?');

        client.setNextStep(
          nextUpdate,
          new MessageHandler(async (finalUpdate, finalContext) => {
            finalContext.set('email', finalUpdate.messageText);

            const name = finalContext.get('name');
            const email = finalContext.get('email');

            await finalUpdate.replyMessage(
              `Registration complete!\nName: ${name}\nEmail: ${email}`
            );

            finalContext.clear();
          }),
          async (cancelUpdate) => {
            await cancelUpdate.replyMessage('Registration cancelled.');
          }
        );
      }),
      async (cancelUpdate) => {
        await cancelUpdate.replyMessage('Registration cancelled.');
      }
    );
  },
  { regex: /^register$/i }
);
```

## Complete Express Server Example

```typescript
import express from 'express';
import { WhatsApp, InlineKeyboard } from 'whatsapp-cloud-bot';

const app = express();
const port = process.env.PORT || 3000;

// Initialize WhatsApp client
const client = new WhatsApp({
  numberId: process.env.WA_PHONE_NUMBER_ID!,
  token: process.env.WA_TOKEN!,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook handler (POST)
app.post('/webhook', async (req, res) => {
  try {
    await client.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
});

// Register message handlers
client.onMessage(
  async (update) => {
    await update.replyMessage('Welcome! Type "menu" to see options.');
  },
  { regex: /^(start|hi|hello)$/i }
);

client.onMessage(
  async (update) => {
    await update.replyMessage('Main Menu', {
      replyMarkup: new InlineKeyboard(['Help', 'About', 'Contact']),
    });
  },
  { regex: /^menu$/i }
);

client.onInteractiveMessage(async (update) => {
  switch (update.messageText) {
    case 'Help':
      await update.replyMessage('How can I help you?');
      break;
    case 'About':
      await update.replyMessage('This is a WhatsApp bot example.');
      break;
    case 'Contact':
      await update.replyMessage('Email: support@example.com');
      break;
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook URL: http://localhost:${port}/webhook`);
});

export default app;
```

## Environment Variables (.env)

```env
WA_PHONE_NUMBER_ID=your_phone_number_id
WA_TOKEN=your_access_token
WEBHOOK_VERIFY_TOKEN=your_verify_token
PORT=3000
```
