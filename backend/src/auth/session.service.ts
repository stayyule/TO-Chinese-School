import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

export const SESSION_IDLE_MS = 8 * 3_600_000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 3_600_000;

/** 32 random bytes, base64url without padding. */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

const hashId = (rawId: string): string => createHash('sha256').update(rawId, 'utf8').digest('hex');

/** Server-side sessions. The raw id lives only in the client's cookie; the DB stores its SHA-256 hex. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async create(userId: number, meta: { ip?: string; userAgent?: string }): Promise<{ id: string; expiresAt: Date }> {
    const id = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await this.prisma.session.create({
      data: {
        tokenHash: hashId(id),
        userId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { id, expiresAt };
  }

  /** Valid while used at least every 8 h and younger than 7 days; each use slides `last_seen_at`. */
  async resolve(rawId: string): Promise<{ userId: number } | null> {
    if (!SESSION_ID.test(rawId)) return null;
    const tokenHash = hashId(rawId);
    const row = await this.prisma.session.findUnique({ where: { tokenHash } });
    if (!row) return null;
    const now = this.clock.now();
    if (now.getTime() >= row.expiresAt.getTime() || now.getTime() - row.lastSeenAt.getTime() > SESSION_IDLE_MS) {
      await this.prisma.session.deleteMany({ where: { tokenHash } });
      return null;
    }
    // updateMany: a concurrent logout may have deleted the row; that must not turn into a 500.
    const { count } = await this.prisma.session.updateMany({ where: { tokenHash }, data: { lastSeenAt: now } });
    return count === 1 ? { userId: row.userId } : null;
  }

  async destroy(rawId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashId(rawId) } });
  }

  /** Pass a transaction client to make this part of a larger write. */
  async destroyAllForUser(userId: number, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    await db.session.deleteMany({ where: { userId } });
  }
}
