import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './errors';
import { logger } from './logger';
import type { RequestWithId } from './request-id.middleware';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown = null;

    if (exception instanceof AppError) {
      ({ status, code, message } = exception);
      details = exception.details ?? null;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'HTTP_ERROR';
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as { message?: unknown; error?: unknown };
        if (Array.isArray(b.message)) {
          // class-validator style: list of violations.
          status = 422;
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = b.message;
        } else {
          message = typeof b.message === 'string' ? b.message : exception.message;
        }
      } else {
        message = exception.message;
      }
    } else {
      logger.error({ requestId, err: exception }, 'unhandled exception');
    }

    res.status(status).json({ code, message, details, requestId });
  }
}
