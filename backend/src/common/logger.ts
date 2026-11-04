import { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { redact } from './redact';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // Every logged object passes through redact().
  formatters: { log: (obj) => redact(obj) as Record<string, unknown> },
});

function fmt(message: unknown, rest: unknown[]): [Record<string, unknown>, string] {
  const ctx = rest.length && typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : undefined;
  return [ctx ? { context: ctx } : {}, typeof message === 'string' ? message : JSON.stringify(redact(message))];
}

/** Nest LoggerService backed by pino. */
export class PinoLoggerService implements LoggerService {
  log(message: unknown, ...rest: unknown[]): void {
    const [o, m] = fmt(message, rest);
    logger.info(o, m);
  }
  error(message: unknown, ...rest: unknown[]): void {
    const [o, m] = fmt(message, rest);
    logger.error(o, m);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    const [o, m] = fmt(message, rest);
    logger.warn(o, m);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    const [o, m] = fmt(message, rest);
    logger.debug(o, m);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    const [o, m] = fmt(message, rest);
    logger.trace(o, m);
  }
}
