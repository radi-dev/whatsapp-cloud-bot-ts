/**
 * Tests for UserContext
 */

import { UserContext, clearAllContexts, getAllContextUsers } from '../src/UserContext';

describe('UserContext', () => {
  beforeEach(() => {
    clearAllContexts();
  });

  it('should create a context for a user', () => {
    const context = new UserContext('1234567890');
    expect(context.userData).toBeDefined();
    expect(context.userData).toEqual({});
  });

  it('should set and get values', () => {
    const context = new UserContext('1234567890');
    context.set('name', 'John');
    expect(context.get('name')).toBe('John');
  });

  it('should return default value for non-existent keys', () => {
    const context = new UserContext('1234567890');
    expect(context.get('nonexistent', 'default')).toBe('default');
  });

  it('should check if key exists', () => {
    const context = new UserContext('1234567890');
    context.set('name', 'John');
    expect(context.has('name')).toBe(true);
    expect(context.has('age')).toBe(false);
  });

  it('should delete values', () => {
    const context = new UserContext('1234567890');
    context.set('name', 'John');
    expect(context.has('name')).toBe(true);
    context.delete('name');
    expect(context.has('name')).toBe(false);
  });

  it('should get all keys', () => {
    const context = new UserContext('1234567890');
    context.set('name', 'John');
    context.set('age', 25);
    const keys = context.keys();
    expect(keys).toContain('name');
    expect(keys).toContain('age');
    expect(keys.length).toBe(2);
  });

  it('should get size', () => {
    const context = new UserContext('1234567890');
    expect(context.size()).toBe(0);
    context.set('name', 'John');
    expect(context.size()).toBe(1);
  });

  it('should clear context', () => {
    const context = new UserContext('1234567890');
    context.set('name', 'John');
    context.set('age', 25);
    expect(context.size()).toBe(2);
    context.clear();
    expect(context.size()).toBe(0);
  });

  it('should share context data for same user', () => {
    const context1 = new UserContext('1234567890');
    context1.set('name', 'John');

    const context2 = new UserContext('1234567890');
    expect(context2.get('name')).toBe('John');
  });

  it('should isolate context data for different users', () => {
    const context1 = new UserContext('1234567890');
    context1.set('name', 'John');

    const context2 = new UserContext('0987654321');
    expect(context2.get('name')).toBeUndefined();
  });

  it('should track all context users', () => {
    new UserContext('1234567890');
    new UserContext('0987654321');

    const users = getAllContextUsers();
    expect(users).toHaveLength(2);
    expect(users).toContain('1234567890');
    expect(users).toContain('0987654321');
  });

  it('should clear all contexts', () => {
    new UserContext('1234567890');
    new UserContext('0987654321');

    clearAllContexts();
    expect(getAllContextUsers()).toHaveLength(0);
  });
});
