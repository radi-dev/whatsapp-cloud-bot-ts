import dotenv from 'dotenv';

// `quiet` keeps the library from logging to the consumer's console on import.
dotenv.config({ quiet: true });

export const DEBUG =
  process.env.DEBUG === 'true' ||
  process.env.LOG_LEVEL === 'debug' ||
  process.env.LOG_LEVEL === 'trace';

export const DEFAULT_IGNORE_AFTER_MINUTES = process.env.IGNORE_AFTER_MINUTES
  ? parseInt(process.env.IGNORE_AFTER_MINUTES)
  : 5;
