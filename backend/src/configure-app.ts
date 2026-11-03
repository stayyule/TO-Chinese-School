import { INestApplication } from '@nestjs/common';
import { PinoLoggerService } from './common/logger';
import { ProblemFilter } from './common/problem.filter';
import { requestIdMiddleware } from './common/request-id.middleware';

export const API_PREFIX = 'api/v1';

export function configureApp(app: INestApplication): void {
  app.useLogger(new PinoLoggerService());
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ProblemFilter());
  app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz'] });
}
