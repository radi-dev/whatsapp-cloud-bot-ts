/**
 * Tests for Markup Components
 */

import {
  InlineButton,
  InlineKeyboard,
  ListItem,
  ListSection,
  InlineList,
  InlineLocationRequest,
} from '../src/Markup';

describe('InlineButton', () => {
  it('should create a button with text and auto-generated ID', () => {
    const button = new InlineButton('Click me');
    expect(button.button.reply.id).toBe('Click me');
    expect(button.button.reply.title).toBe('Click me');
  });

  it('should create a button with custom ID', () => {
    const button = new InlineButton('Click me', 'custom_id');
    expect(button.button.reply.id).toBe('custom_id');
    expect(button.button.reply.title).toBe('Click me');
  });

  it('should throw error for text longer than 20 characters', () => {
    expect(() => {
      new InlineButton('This text is way too long for a button');
    }).toThrow('Button text must be 20 characters or less');
  });
});

describe('InlineKeyboard', () => {
  it('should create keyboard with string buttons', () => {
    const keyboard = new InlineKeyboard(['Yes', 'No']);
    expect(keyboard.type).toBe('button');
    expect(keyboard.markup.buttons).toHaveLength(2);
  });

  it('should create keyboard with InlineButton objects', () => {
    const buttons = [
      new InlineButton('Yes', 'yes_id'),
      new InlineButton('No', 'no_id'),
    ];
    const keyboard = new InlineKeyboard(buttons);
    expect(keyboard.markup.buttons).toHaveLength(2);
  });

  it('should throw error for less than 1 button', () => {
    expect(() => {
      new InlineKeyboard([]);
    }).toThrow();
  });

  it('should throw error for more than 3 buttons', () => {
    expect(() => {
      new InlineKeyboard(['One', 'Two', 'Three', 'Four']);
    }).toThrow('InlineKeyboard must have 1-3 buttons');
  });

  it('should throw error for duplicate button IDs', () => {
    const buttons = [
      new InlineButton('Button 1', 'same_id'),
      new InlineButton('Button 2', 'same_id'),
    ];
    expect(() => {
      new InlineKeyboard(buttons);
    }).toThrow('Button IDs and titles must be unique');
  });
});

describe('ListItem', () => {
  it('should create a list item with title only', () => {
    const item = new ListItem('Option 1');
    expect(item.item.title).toBe('Option 1');
    expect(item.item.id).toBe('Option 1');
  });

  it('should create a list item with custom ID', () => {
    const item = new ListItem('Option 1', 'opt_1');
    expect(item.item.id).toBe('opt_1');
  });

  it('should create a list item with description', () => {
    const item = new ListItem('Option 1', 'opt_1', 'This is option 1');
    expect(item.item.description).toBe('This is option 1');
  });

  it('should throw error for title longer than 24 characters', () => {
    expect(() => {
      new ListItem('This title is way too long for a list item');
    }).toThrow('List item title must be 24 characters or less');
  });

  it('should throw error for description longer than 72 characters', () => {
    expect(() => {
      new ListItem(
        'Title',
        'id',
        'This description is way too long and exceeds the maximum allowed character limit for list item descriptions'
      );
    }).toThrow('List item description must be 72 characters or less');
  });
});

describe('ListSection', () => {
  it('should create a section with string items', () => {
    const section = new ListSection('Colors', ['Red', 'Blue', 'Green']);
    expect(section.section.title).toBe('Colors');
    expect(section.section.rows).toHaveLength(3);
  });

  it('should create a section with ListItem objects', () => {
    const items = [
      new ListItem('Red', 'red'),
      new ListItem('Blue', 'blue'),
    ];
    const section = new ListSection('Colors', items);
    expect(section.section.rows).toHaveLength(2);
  });

  it('should throw error for more than 10 items', () => {
    const items = Array.from({ length: 11 }, (_, i) => `Item ${i + 1}`);
    expect(() => {
      new ListSection('Section', items);
    }).toThrow('Section must have 1-10 items');
  });
});

describe('InlineList', () => {
  it('should create list without sections', () => {
    const items = [new ListItem('Option 1'), new ListItem('Option 2')];
    const list = new InlineList('Select option', items);
    expect(list.type).toBe('list');
    expect(list.markup.button).toBe('Select option');
    expect(list.markup.sections).toHaveLength(1);
  });

  it('should create list with sections', () => {
    const sections = [
      new ListSection('Section 1', ['Item 1', 'Item 2']),
      new ListSection('Section 2', ['Item 3', 'Item 4']),
    ];
    const list = new InlineList('Select option', sections);
    expect(list.markup.sections).toHaveLength(2);
  });

  it('should throw error for button text longer than 20 characters', () => {
    expect(() => {
      new InlineList('This button text is too long', [new ListItem('Item')]);
    }).toThrow('List button text must be 20 characters or less');
  });

  it('should throw error for more than 10 total items', () => {
    const items = Array.from({ length: 11 }, (_, i) =>
      new ListItem(`Item ${i + 1}`)
    );
    expect(() => {
      new InlineList('Select', items);
    }).toThrow('List can have maximum 10 items');
  });
});

describe('InlineLocationRequest', () => {
  it('should create location request markup', () => {
    const locationRequest = new InlineLocationRequest();
    expect(locationRequest.type).toBe('location_request_message');
    expect(locationRequest.markup.name).toBe('send_location');
  });
});
