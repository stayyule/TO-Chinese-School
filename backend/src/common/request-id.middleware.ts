import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,}$/;

/** Masks path segments that look like single-use tokens. */
export function maskPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (TOKEN_LIKE.test(seg) ? ':redacted' : seg))
    .join('/');
}

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

export type RequestWithId = Request & { requestId: string };

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  (req as RequestWithId).requestId = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      { requestId: id, method: req.method, path: req.route?.path ? String(req.route.path) : maskPath(req.path), status: res.statusCode, ms: Date.now() - start },
      'request',
    );
  });
  next();
}
