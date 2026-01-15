/**
 * Tests for utility functions
 */

import {
  keysExist,
  isValidPhoneNumber,
  formatPhoneNumber,
  isLink,
  getExtensionFromMimeType,
} from '../src/utils/helpers';

describe('keysExist', () => {
  const testObj = {
    spam: {
      egg: {
        bacon: 'Well..',
        sausages: 'Spam egg sausages',
      },
    },
  };

  it('should return true for existing keys', () => {
    expect(keysExist(testObj, 'spam')).toBe(true);
    expect(keysExist(testObj, 'spam', 'egg')).toBe(true);
    expect(keysExist(testObj, 'spam', 'egg', 'bacon')).toBe(true);
  });

  it('should return false for non-existing keys', () => {
    expect(keysExist(testObj, 'spam', 'bacon')).toBe(false);
    expect(keysExist(testObj, 'nonexistent')).toBe(false);
  });

  it('should work with array indices', () => {
    const arr = { items: [{ id: 1 }, { id: 2 }] };
    expect(keysExist(arr, 'items', 0, 'id')).toBe(true);
    expect(keysExist(arr, 'items', 5)).toBe(false);
  });

  it('should throw error when no keys provided', () => {
    expect(() => {
      keysExist(testObj);
    }).toThrow('keysExist() expects at least one key argument');
  });
});

describe('isValidPhoneNumber', () => {
  it('should validate correct phone numbers', () => {
    expect(isValidPhoneNumber('1234567890')).toBe(true);
    expect(isValidPhoneNumber('+1 234 567 8900')).toBe(true);
    expect(isValidPhoneNumber('234-567-8900')).toBe(true);
  });

  it('should reject invalid phone numbers', () => {
    expect(isValidPhoneNumber('123')).toBe(false);
    expect(isValidPhoneNumber('abc')).toBe(false);
    expect(isValidPhoneNumber('')).toBe(false);
  });
});

describe('formatPhoneNumber', () => {
  it('should remove non-digit characters', () => {
    expect(formatPhoneNumber('+1 234 567-8900')).toBe('12345678900');
    expect(formatPhoneNumber('(234) 567-8900')).toBe('2345678900');
  });
});

describe('isLink', () => {
  it('should identify links correctly', () => {
    expect(isLink('http://example.com')).toBe(true);
    expect(isLink('https://example.com')).toBe(true);
    expect(isLink('www.example.com')).toBe(true);
    expect(isLink('/local/path')).toBe(false);
    expect(isLink('example.com')).toBe(false);
  });
});

describe('getExtensionFromMimeType', () => {
  it('should return correct extension for known MIME types', () => {
    expect(getExtensionFromMimeType('image/jpeg')).toBe('.jpg');
    expect(getExtensionFromMimeType('image/png')).toBe('.png');
    expect(getExtensionFromMimeType('application/pdf')).toBe('.pdf');
    expect(getExtensionFromMimeType('audio/mpeg')).toBe('.mp3');
  });

  it('should return default extension for unknown MIME types', () => {
    expect(getExtensionFromMimeType('unknown/type')).toBe('.bin');
  });
});
