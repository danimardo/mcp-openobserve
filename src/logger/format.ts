export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export const prettyTransportOptions = {
  target: 'pino-pretty' as const,
  options: {
    destination: 2,
    colorize: true,
    translateTime: 'SYS:dd/MM/yyyy HH:mm:ss',
    messageFormat: '{msg}',
  },
};
