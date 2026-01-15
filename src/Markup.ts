/**
 * Interactive Message Markup Components
 * Used to create buttons, lists, and other interactive elements
 */

import type { ReplyMarkup, ReplyMarkupType } from './types';

/**
 * Base Reply Markup Class
 */
export abstract class BaseReplyMarkup implements ReplyMarkup {
  public type: ReplyMarkupType;
  public markup: any;

  constructor(type: ReplyMarkupType, markup: any) {
    this.type = type;
    this.markup = markup;
  }
}

/**
 * Inline Button
 * Represents a single button in an inline keyboard
 *
 * @example
 * ```typescript
 * const button = new InlineButton('Click me', 'btn_id_1');
 * ```
 */
export class InlineButton {
  public button: {
    type: string;
    reply: {
      id: string;
      title: string;
    };
  };

  /**
   * Creates a new inline button
   * @param text - Button text (max 20 characters)
   * @param buttonId - Button ID (defaults to text if not provided)
   */
  constructor(text: string, buttonId?: string) {
    if (text.length > 20) {
      throw new Error('Button text must be 20 characters or less');
    }

    this.button = {
      type: 'reply',
      reply: {
        id: buttonId || text,
        title: text,
      },
    };
  }
}

/**
 * Inline Keyboard
 * Creates a keyboard with up to 3 buttons
 *
 * @example
 * ```typescript
 * const keyboard = new InlineKeyboard(['Yes', 'No', 'Maybe']);
 * // or with InlineButton objects
 * const keyboard = new InlineKeyboard([
 *   new InlineButton('Yes', 'yes_id'),
 *   new InlineButton('No', 'no_id')
 * ]);
 * ```
 */
export class InlineKeyboard extends BaseReplyMarkup {
  /**
   * Creates an inline keyboard
   * @param buttons - Array of button texts or InlineButton objects (1-3 buttons)
   */
  constructor(buttons: (string | InlineButton)[]) {
    const inlineButtons = InlineKeyboard.setButtons(buttons);
    InlineKeyboard.validateButtons(inlineButtons);

    const markup = {
      buttons: inlineButtons.map((btn) => btn.button),
    };

    super('button', markup);
  }

  /**
   * Convert strings to InlineButton objects
   */
  private static setButtons(
    buttons: (string | InlineButton)[]
  ): InlineButton[] {
    if (!Array.isArray(buttons)) {
      throw new Error('Buttons must be an array');
    }

    return buttons.map((btn) => {
      if (typeof btn === 'string') {
        return new InlineButton(btn);
      } else if (btn instanceof InlineButton) {
        return btn;
      } else {
        throw new Error(
          'Button elements must be strings or InlineButton instances'
        );
      }
    });
  }

  /**
   * Validate button constraints
   */
  private static validateButtons(buttons: InlineButton[]): void {
    if (buttons.length < 1 || buttons.length > 3) {
      throw new Error(
        `InlineKeyboard must have 1-3 buttons, got ${buttons.length}`
      );
    }

    const ids = new Set<string>();
    const titles = new Set<string>();

    for (const button of buttons) {
      const id = button.button.reply.id;
      const title = button.button.reply.title;

      if (ids.has(id) || titles.has(title)) {
        throw new Error('Button IDs and titles must be unique');
      }

      ids.add(id);
      titles.add(title);
    }
  }
}

/**
 * List Item
 * Represents a single item in a list
 *
 * @example
 * ```typescript
 * const item = new ListItem('Option 1', 'opt_1', 'Description here');
 * ```
 */
export class ListItem {
  public item: {
    id: string;
    title: string;
    description?: string;
  };

  /**
   * Creates a list item
   * @param title - Item title (max 24 characters)
   * @param id - Item ID (defaults to title if not provided)
   * @param description - Item description (max 72 characters, optional)
   */
  constructor(title: string, id?: string, description?: string) {
    if (title.length > 24) {
      throw new Error('List item title must be 24 characters or less');
    }

    if (description && description.length > 72) {
      throw new Error('List item description must be 72 characters or less');
    }

    this.item = {
      id: id || title,
      title: title,
    };

    if (description) {
      this.item.description = description;
    }
  }
}

/**
 * List Section
 * Groups list items under a section title
 *
 * @example
 * ```typescript
 * const section = new ListSection('Colors', ['Red', 'Blue', 'Green']);
 * ```
 */
export class ListSection {
  public section: {
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  };

  /**
   * Creates a list section
   * @param title - Section title (max 24 characters)
   * @param items - Array of item texts or ListItem objects (max 10 items)
   */
  constructor(title: string, items: (string | ListItem)[]) {
    if (title.length > 24) {
      throw new Error('Section title must be 24 characters or less');
    }

    const listItems = ListSection.setItems(items);
    ListSection.validateItems(listItems);

    this.section = {
      title: title,
      rows: listItems.map((item) => item.item),
    };
  }

  /**
   * Convert strings to ListItem objects
   */
  private static setItems(items: (string | ListItem)[]): ListItem[] {
    if (!Array.isArray(items)) {
      throw new Error('Items must be an array');
    }

    return items.map((item) => {
      if (typeof item === 'string') {
        return new ListItem(item);
      } else if (item instanceof ListItem) {
        return item;
      } else {
        throw new Error('Items must be strings or ListItem instances');
      }
    });
  }

  /**
   * Validate items constraints
   */
  private static validateItems(items: ListItem[]): void {
    if (items.length < 1 || items.length > 10) {
      throw new Error(`Section must have 1-10 items, got ${items.length}`);
    }
  }
}

/**
 * Inline List
 * Creates an interactive list menu
 *
 * @example
 * ```typescript
 * // Simple list without sections
 * const list = new InlineList('Choose option', [
 *   new ListItem('Option 1'),
 *   new ListItem('Option 2')
 * ]);
 *
 * // List with sections
 * const list = new InlineList('Choose option', [
 *   new ListSection('Section 1', ['Item 1', 'Item 2']),
 *   new ListSection('Section 2', ['Item 3', 'Item 4'])
 * ]);
 * ```
 */
export class InlineList extends BaseReplyMarkup {
  /**
   * Creates an inline list
   * @param buttonText - Button text to display the list (max 20 characters)
   * @param listItems - Array of ListItem or ListSection objects (max 10 items total)
   */
  constructor(buttonText: string, listItems: (ListItem | ListSection)[]) {
    if (buttonText.length > 20) {
      throw new Error('List button text must be 20 characters or less');
    }

    InlineList.validateList(listItems);

    let sections;
    if (listItems.length > 0 && listItems[0] instanceof ListSection) {
      // List with sections
      sections = (listItems as ListSection[]).map((section) => section.section);
    } else {
      // List without sections (single default section)
      sections = [
        {
          rows: (listItems as ListItem[]).map((item) => item.item),
        },
      ];
    }

    const markup = {
      button: buttonText,
      sections: sections,
    };

    super('list', markup);
  }

  /**
   * Validate list constraints
   */
  private static validateList(items: (ListItem | ListSection)[]): void {
    if (!Array.isArray(items)) {
      throw new Error('List items must be an array');
    }

    if (items.length === 0) {
      throw new Error('List must have at least one item or section');
    }

    // Check that all items are of the same type
    const isAllListItems = items.every((item) => item instanceof ListItem);
    const isAllSections = items.every((item) => item instanceof ListSection);

    if (!isAllListItems && !isAllSections) {
      throw new Error(
        'List items must be all ListItem or all ListSection instances'
      );
    }

    // Count total items
    let totalItems = 0;
    if (isAllSections) {
      for (const section of items as ListSection[]) {
        totalItems += section.section.rows.length;
      }
    } else {
      totalItems = items.length;
    }

    if (totalItems > 10) {
      throw new Error(`List can have maximum 10 items, got ${totalItems}`);
    }
  }
}

/**
 * Location Request Button
 * Creates a button that requests user's location
 *
 * @example
 * ```typescript
 * const locationRequest = new InlineLocationRequest();
 * ```
 */
export class InlineLocationRequest extends BaseReplyMarkup {
  /**
   * Creates a location request button
   */
  constructor() {
    const markup = {
      name: 'send_location',
    };

    super('location_request_message', markup);
  }
}
