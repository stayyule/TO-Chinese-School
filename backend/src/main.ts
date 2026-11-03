import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { assertRouteCoverage } from './access/route-coverage';
import { AppModule } from './app.module';
import { mountOpenApi } from './openapi';
import { configureApp } from './configure-app';
import { loadEnv } from './config/env';
import { loadDotenv } from './config/load-dotenv';

async function bootstrap(): Promise<void> {
  loadDotenv(); // dev convenience: backend/.env fills only variables the real environment lacks
  loadEnv(process.env); // fail fast, naming any missing/invalid variable, before the app is created
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  assertRouteCoverage(app); // default-deny: refuse to start if any route lacks an access rule
  mountOpenApi(app, process.env.NODE_ENV); // JSON document for client generation; skipped in production
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
