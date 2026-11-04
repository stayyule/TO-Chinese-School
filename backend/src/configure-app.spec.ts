import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { configureApp } from './configure-app';

@Module({})
class EmptyModule {}

describe('configureApp trust proxy', () => {
  const saved = process.env.TRUST_PROXY;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  });

  const trustFor = async (value: string | undefined): Promise<{ setting: unknown; trusts: (addr: string, hop: number) => boolean }> => {
    if (value === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = value;
    const app = await NestFactory.create<NestExpressApplication>(EmptyModule, { logger: false });
    try {
      configureApp(app);
      const express = app.getHttpAdapter().getInstance() as Express;
      return { setting: express.get('trust proxy'), trusts: express.get('trust proxy fn') as (a: string, h: number) => boolean };
    } finally {
      await app.close();
    }
  };

  it('keeps the private-network default when TRUST_PROXY is unset', async () => {
    const { setting, trusts } = await trustFor(undefined);
    expect(setting).toBe('loopback, linklocal, uniquelocal');
    expect(trusts('172.18.0.5', 0)).toBe(true);
    expect(trusts('8.8.8.8', 0)).toBe(false);
  });

  it('uses a hop count from TRUST_PROXY=1 (only the nearest proxy is trusted)', async () => {
    const { setting, trusts } = await trustFor('1');
    expect(setting).toBe(1);
    expect(trusts('172.18.0.5', 0)).toBe(true);
    expect(trusts('172.18.0.5', 1)).toBe(false);
  });

  it('refuses TRUST_PROXY=true', async () => {
    await expect(trustFor('true')).rejects.toThrow(/TRUST_PROXY/);
  });
});
