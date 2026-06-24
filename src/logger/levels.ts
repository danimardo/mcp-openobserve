export function effectiveLogLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}
