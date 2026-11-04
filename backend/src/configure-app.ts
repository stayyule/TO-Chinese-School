import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { PinoLoggerService } from './common/logger';
import { parseTrustProxy } from './config/env';
import { ProblemFilter } from './common/problem.filter';
import { requestIdMiddleware } from './common/request-id.middleware';

export const API_PREFIX = 'api/v1';

/**
 * Shared app setup (main, tests, openapi build). Proxies whose X-Forwarded-For is believed for req.ip come from
 * TRUST_PROXY (see parseTrustProxy; default loopback, linklocal, uniquelocal). The app port must not be reachable
 * from the internet: in production only Caddy reaches it, over the private `edge` network.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(new PinoLoggerService());
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  // Unknown body fields are rejected; violations surface as 422 VALIDATION_ERROR through ProblemFilter.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 }));
  app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz'] });
}
