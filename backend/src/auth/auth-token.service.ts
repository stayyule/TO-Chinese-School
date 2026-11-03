import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AppError } from '../common/errors';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

export type TokenPurpose = 'invitation' | 'password_reset';

const HOUR_MS = 3_600_000;
const LIFETIME_MS: Record<TokenPurpose, number> = {
  invitation: 72 * HOUR_MS,
  password_reset: 6 * HOUR_MS,
};

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const invalidToken = (): AppError => new AppError(404, 'INVALID_TOKEN', 'This link is invalid or has expired.');

/**
 * Single-use emailed tokens. Only the SHA-256 hex is stored. A token is valid while `expires_at > now`
 * (the exact expiry instant is already expired), judged against the injected Clock. Issuing a new token
 * invalidates the person's older unused tokens of the same purpose, so only the latest link works.
 */
@Injectable()
export class AuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async issue(purpose: TokenPurpose, personId: number): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + LIFETIME_MS[purpose]);
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({ where: { purpose, personId, usedAt: null }, data: { usedAt: now } }),
      this.prisma.authToken.create({ data: { tokenHash: hashToken(token), purpose, personId, expiresAt } }),
    ]);
    return { token, expiresAt };
  }

  async peek(purpose: TokenPurpose, token: string): Promise<{ personId: number }> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.purpose !== purpose || row.usedAt !== null || row.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw invalidToken();
    }
    return { personId: row.personId };
  }

  /** Pass a transaction client to make consumption part of a larger write (it rolls back with it). */
  async consume(purpose: TokenPurpose, token: string, db: Prisma.TransactionClient = this.prisma): Promise<{ personId: number }> {
    const tokenHash = hashToken(token);
    const now = this.clock.now();
    // Atomic: only one concurrent caller can flip used_at from NULL.
    const { count } = await db.authToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) throw invalidToken();
    const row = await db.authToken.findUniqueOrThrow({ where: { tokenHash } });
    return { personId: row.personId };
  }
}
