import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';

const projectRoot = process.cwd();
const indexPath = join(projectRoot, 'src', 'index.ts');
const isWin = process.platform === 'win32';

function spawnIndex(extraEnv: Record<string, string | undefined>) {
  return spawn(isWin ? 'npx.cmd' : 'npx', ['tsx', indexPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    cwd: projectRoot,
    shell: isWin,
  });
}

function waitForExit(proc: ReturnType<typeof spawn>, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function collectStderr(proc: ReturnType<typeof spawn>): string[] {
  const lines: string[] = [];
  proc.stderr?.on('data', (d: Buffer) => lines.push(d.toString()));
  return lines;
}

describe('startup — arranque del servidor', () => {
  it('arranca correctamente con vars válidas y stdout permanece vacío', async () => {
    const proc = spawnIndex({
      LOG_GATEWAY_URL: 'http://localhost:59999',
      LOG_GATEWAY_API_KEY: 'test_key.test_secret',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
    });

    let stdoutData = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdoutData += d.toString();
    });

    const stderrLines = collectStderr(proc);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 4000);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Proceso terminó inesperadamente con código ${code}\nstderr: ${stderrLines.join('')}`));
      });
    });

    expect(proc.exitCode).toBeNull();
    expect(stdoutData).toBe('');
    proc.kill();
  }, 12000);

  it('falla con mensaje claro cuando LOG_GATEWAY_URL está ausente', async () => {
    const proc = spawnIndex({
      LOG_GATEWAY_API_KEY: 'test_key.test_secret',
      LOG_GATEWAY_URL: undefined,
    });

    const stderrLines = collectStderr(proc);
    const code = await waitForExit(proc);

    const stderrText = stderrLines.join('');
    expect(code).not.toBe(0);
    expect(stderrText).toMatch(/LOG_GATEWAY_URL/);
  }, 10000);

  it('falla con mensaje claro cuando LOG_GATEWAY_API_KEY está ausente', async () => {
    const proc = spawnIndex({
      LOG_GATEWAY_URL: 'http://localhost:59999',
      LOG_GATEWAY_API_KEY: undefined,
    });

    const stderrLines = collectStderr(proc);
    const code = await waitForExit(proc);

    const stderrText = stderrLines.join('');
    expect(code).not.toBe(0);
    expect(stderrText).toMatch(/LOG_GATEWAY_API_KEY/);
  }, 10000);

  it('falla con mensaje claro cuando OO_URL está presente (FR-004)', async () => {
    const proc = spawnIndex({
      LOG_GATEWAY_URL: 'http://localhost:59999',
      LOG_GATEWAY_API_KEY: 'test_key.test_secret',
      OO_URL: 'http://openobserve',
    });

    const stderrLines = collectStderr(proc);
    const code = await waitForExit(proc);

    const stderrText = stderrLines.join('');
    expect(code).not.toBe(0);
    expect(stderrText).toMatch(/OO_URL/);
  }, 10000);

  it('la API key no aparece en stderr cuando la config falla', async () => {
    const secretKey = 'super_secret_key_value_12345';
    const proc = spawnIndex({
      LOG_GATEWAY_URL: 'http://localhost:59999',
      LOG_GATEWAY_API_KEY: secretKey,
      OO_URL: 'http://bad',
    });

    const stderrLines = collectStderr(proc);
    await waitForExit(proc);

    const stderrText = stderrLines.join('');
    expect(stderrText).not.toContain(secretKey);
  }, 10000);
});
