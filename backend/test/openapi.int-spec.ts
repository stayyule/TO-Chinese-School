import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { assertRouteCoverage } from '../src/access/route-coverage';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { buildOpenApiDocument, mountOpenApi } from '../src/openapi';

async function createApp(nodeEnv: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  assertRouteCoverage(app); // the SwaggerModule route is not a controller route, so default-deny still holds
  mountOpenApi(app, nodeEnv);
  await app.init();
  return app;
}

describe('OpenAPI document', () => {
  it('is served at /api/v1/openapi.json outside production and lists the API routes', async () => {
    const app = await createApp('test');
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/openapi.json');
      expect(res.status).toBe(200);
      const body = res.body as { openapi: string; paths: Record<string, unknown> };
      expect(body.openapi).toMatch(/^3\./);
      expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/api/v1/auth/login', '/api/v1/me']));
      expect(buildOpenApiDocument(app).paths['/api/v1/me']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('is not served in production', async () => {
    const app = await createApp('production');
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/openapi.json');
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
