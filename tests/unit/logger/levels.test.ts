import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { effectiveLogLevel } from '../../../src/logger/levels.js';

describe('effectiveLogLevel', () => {
  let savedLogLevel: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedLogLevel = process.env.LOG_LEVEL;
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = savedLogLevel;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('returns LOG_LEVEL when explicitly set', () => {
    process.env.LOG_LEVEL = 'debug';
    delete process.env.NODE_ENV;
    expect(effectiveLogLevel()).toBe('debug');
  });

  it('returns warn in production when LOG_LEVEL not set', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    expect(effectiveLogLevel()).toBe('warn');
  });

  it('returns info outside production when LOG_LEVEL not set', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'development';
    expect(effectiveLogLevel()).toBe('info');
  });

  it('returns info when NODE_ENV is undefined and LOG_LEVEL not set', () => {
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    expect(effectiveLogLevel()).toBe('info');
  });

  it('explicit LOG_LEVEL overrides NODE_ENV production default', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'trace';
    expect(effectiveLogLevel()).toBe('trace');
  });

  it('explicit LOG_LEVEL overrides NODE_ENV development default', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'warn';
    expect(effectiveLogLevel()).toBe('warn');
  });
});
