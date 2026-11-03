import { BadRequestException, Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppError } from '../src/common/errors';
import { configureApp } from '../src/configure-app';

@Controller('boom')
class BoomController {
  @Get('app')
  app(): never {
    throw new AppError(409, 'X', 'm', { a: 1 });
  }
  @Get('plain')
  plain(): never {
    throw new Error('secret stack info');
  }
  @Get('nf')
  nf(): never {
    throw new NotFoundException();
  }
  @Get('bad')
  bad(): never {
    throw new BadRequestException(['field must be string']);
  }
}

describe('problem errors', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [BoomController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('renders AppError with requestId matching header', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/app');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: 'X', message: 'm', details: { a: 1 }, requestId: res.headers['x-request-id'] });
  });

  it('renders unhandled errors as 500 INTERNAL_ERROR without stack', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/plain');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/secret stack info|at /);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('renders 404 as NOT_FOUND and validation 400 as VALIDATION_ERROR', async () => {
    const nf = await request(app.getHttpServer()).get('/api/v1/boom/nf');
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe('NOT_FOUND');
    const bad = await request(app.getHttpServer()).get('/api/v1/boom/bad');
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.details).toEqual(['field must be string']);
  });

  it('generates a request id, and honors a valid incoming one only', async () => {
    const gen = await request(app.getHttpServer()).get('/healthz');
    expect(gen.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    const ok = await request(app.getHttpServer()).get('/healthz').set('X-Request-Id', 'abc-12345678');
    expect(ok.headers['x-request-id']).toBe('abc-12345678');
    const bad = await request(app.getHttpServer()).get('/healthz').set('X-Request-Id', 'bad id!');
    expect(bad.headers['x-request-id']).not.toBe('bad id!');
  });
});
