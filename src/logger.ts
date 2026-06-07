import pino from 'pino';
import { REDACT_PATHS } from './logger/redaction.js';
import { effectiveLogLevel } from './logger/levels.js';
import { isDevelopment, prettyTransportOptions } from './logger/format.js';

const level = effectiveLogLevel();
const redact = { paths: REDACT_PATHS, censor: '[REDACTED]' };

function createLogger() {
  if (isDevelopment()) {
    return pino({ level, redact }, pino.transport(prettyTransportOptions));
  }
  return pino({ level, redact }, pino.destination(2));
}

export const logger = createLogger();
export type Logger = typeof logger;
