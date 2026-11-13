import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { buildOpenApiDocument } from './openapi';

/**
 * Writes backend/openapi.json without a database: providers are instantiated but the app is never initialised, so
 * PrismaService.onModuleInit (the only connect) does not run. Env values below are dummies for construction only.
 * Run via `npm run openapi:build` (compiled with the Nest CLI so the swagger plugin's DTO metadata is present).
 */
async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';
  process.env.DATABASE_MIGRATOR_URL ??= 'postgresql://stub:stub@localhost:5432/stub';
  process.env.SESSION_SECRET ??= 'openapi-build-stub-secret-0123456789abcdef';
  process.env.MAIL_TRANSPORT = 'memory';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  const out = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
