import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { PinoLoggerService } from './common/logger';
import { ProblemFilter } from './common/problem.filter';
import { requestIdMiddleware } from './common/request-id.middleware';

export const API_PREFIX = 'api/v1';

/**
 * Proxies whose X-Forwarded-For is believed when computing req.ip (per-IP throttling, audit ip): Caddy reaches
 * the app over loopback or a private (Docker) network. The app port must not be reachable from the internet.
 */
export const TRUSTED_PROXIES = 'loopback, linklocal, uniquelocal';

export function configureApp(app: INestApplication): void {
  app.useLogger(new PinoLoggerService());
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', TRUSTED_PROXIES);
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  // Unknown body fields are rejected; violations surface as 422 VALIDATION_ERROR through ProblemFilter.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 }));
  app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz'] });
}
