import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { assertRouteCoverage } from './access/route-coverage';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  assertRouteCoverage(app); // default-deny: refuse to start if any route lacks an access rule
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
