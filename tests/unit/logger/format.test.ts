import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { isDevelopment, prettyTransportOptions } from '../../../src/logger/format.js';

describe('prettyTransportOptions', () => {
  it('is configured to write to stderr (destination 2)', () => {
    expect(prettyTransportOptions.options.destination).toBe(2);
  });

  it('uses correct date format for es-ES locale', () => {
    expect(prettyTransportOptions.options.translateTime).toMatch(/dd\/MM\/yyyy HH:mm:ss/);
  });

  it('targets pino-pretty', () => {
    expect(prettyTransportOptions.target).toBe('pino-pretty');
  });
});

describe('isDevelopment', () => {
  it('returns false in production', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(isDevelopment()).toBe(false);
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  });

  it('returns true outside production', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(isDevelopment()).toBe(true);
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  });
});

describe('no console.* in src/ files', () => {
  async function collectTsFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await collectTsFiles(full)));
        } else if (entry.name.endsWith('.ts')) {
          files.push(full);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    return files;
  }

  it('no source file uses console.* directly', async () => {
    const srcDir = join(process.cwd(), 'src');
    const files = await collectTsFiles(srcDir);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (/\bconsole\.(log|warn|error|info|debug|trace)\b/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
