import { Injectable } from '@nestjs/common';
import { AuditDb, AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export const LOCKOUT_WINDOW_MS = 15 * 60_000;
export const LOCKOUT_THRESHOLD = 5;
/** Upper bound: failures are not recorded while locked, so the lock ends at most 15 min after the last one. */
export const LOCKOUT_RETRY_AFTER_SECONDS = LOCKOUT_WINDOW_MS / 1000;

/** D2: 5 consecutive failures for the same (lower-cased, via AuditService) username within 15 minutes lock it. */
@Injectable()
export class LoginThrottleService {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Pass the transaction client from `withUsernameLock` so the count is taken under the lock. */
  async assertAllowed(username: string, db?: AuditDb): Promise<void> {
    if ((await this.audit.countRecentFailures(username, LOCKOUT_WINDOW_MS, db)) >= LOCKOUT_THRESHOLD) {
      throw new AppError(429, 'LOGIN_LOCKED', 'Too many failed login attempts. Try again later.', {
        retryAfterSeconds: LOCKOUT_RETRY_AFTER_SECONDS,
      });
    }
  }

  /**
   * Runs `fn` in a transaction holding a per-username (case-insensitive) advisory lock, so the
   * check -> verify -> record sequence cannot interleave between concurrent attempts (otherwise N parallel
   * guesses would all see fewer than 5 failures). The lock is released at commit/rollback. `fn` must do its
   * audit reads/writes through `tx` and should contain nothing slower than one argon2 verify. An error
   * thrown by `fn` rolls back its writes, so return outcomes rather than throwing after writing.
   */
  withUsernameLock<T>(username: string, fn: (tx: AuditDb) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'login:' + username.toLowerCase()}))`;
        return fn(tx);
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
