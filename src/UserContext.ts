/**
 * User Context Management
 * Manages user-specific data in conversations
 */

import type { UserContextData } from './types';

/**
 * Global context storage for all users
 */
class ContextStore {
  private usersData: Map<string, UserContextData> = new Map();

  /**
   * Add a new user to the context store
   * @param phoneNumber - User's phone number
   */
  addUser(phoneNumber: string): void {
    if (!this.usersData.has(phoneNumber)) {
      this.usersData.set(phoneNumber, {});
    }
  }

  /**
   * Check if user exists in context store
   * @param phoneNumber - User's phone number
   * @returns true if user exists
   */
  userExists(phoneNumber: string): boolean {
    return this.usersData.has(phoneNumber);
  }

  /**
   * Get user data from context store
   * @param phoneNumber - User's phone number
   * @returns User's context data
   */
  getUserData(phoneNumber: string): UserContextData {
    if (!this.userExists(phoneNumber)) {
      this.addUser(phoneNumber);
    }
    return this.usersData.get(phoneNumber)!;
  }

  /**
   * Clear user data from context store
   * @param phoneNumber - User's phone number
   */
  clearUser(phoneNumber: string): void {
    this.usersData.delete(phoneNumber);
  }

  /**
   * Clear all users data
   */
  clearAll(): void {
    this.usersData.clear();
  }

  /**
   * Get all users phone numbers
   * @returns Array of phone numbers
   */
  getAllUsers(): string[] {
    return Array.from(this.usersData.keys());
  }
}

// Global context store instance
const contextStore = new ContextStore();

/**
 * User Context Class
 * Manages a specific user's data in a conversation
 * The user's phone number is used as the unique identifier
 *
 * @example
 * ```typescript
 * const context = new UserContext('1234567890');
 * context.userData.step = 1;
 * context.userData.name = 'John';
 * ```
 */
export class UserContext {
  /**
   * User's context data storage
   */
  public userData: UserContextData;

  /**
   * User's phone number (identifier)
   */
  private phoneNumber: string;

  /**
   * Creates a new UserContext instance
   * @param phoneNumber - User's phone number
   */
  constructor(phoneNumber: string) {
    this.phoneNumber = phoneNumber;
    this.userData = contextStore.getUserData(phoneNumber);
  }

  /**
   * Set a value in user context
   * @param key - Context key
   * @param value - Value to store
   */
  set(key: string, value: any): void {
    this.userData[key] = value;
  }

  /**
   * Get a value from user context
   * @param key - Context key
   * @param defaultValue - Default value if key doesn't exist
   * @returns Stored value or default value
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined {
    return this.userData[key] !== undefined ? this.userData[key] : defaultValue;
  }

  /**
   * Check if key exists in user context
   * @param key - Context key
   * @returns true if key exists
   */
  has(key: string): boolean {
    return key in this.userData;
  }

  /**
   * Delete a key from user context
   * @param key - Context key
   */
  delete(key: string): void {
    delete this.userData[key];
  }

  /**
   * Clear all user context data
   */
  clear(): void {
    contextStore.clearUser(this.phoneNumber);
    this.userData = contextStore.getUserData(this.phoneNumber);
  }

  /**
   * Get all keys in user context
   * @returns Array of keys
   */
  keys(): string[] {
    return Object.keys(this.userData);
  }

  /**
   * Get number of items in user context
   * @returns Number of items
   */
  size(): number {
    return Object.keys(this.userData).length;
  }
}

/**
 * Clear all users context data (useful for testing)
 */
export function clearAllContexts(): void {
  contextStore.clearAll();
}

/**
 * Get all users with active contexts
 * @returns Array of phone numbers
 */
export function getAllContextUsers(): string[] {
  return contextStore.getAllUsers();
}
