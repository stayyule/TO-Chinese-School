import { Injectable } from '@nestjs/common';
import type { AuthToken, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, TokenPurpose } from './auth-token.service';

/** Wrong phone numbers allowed per token; the attempt that reaches this count invalidates the link. */
export const MAX_PHONE_FAILURES = 5;

/** Audit action of a failed phone check, per purpose (counted per auth_tokens.id). */
export const PHONE_FAILED_ACTION: Record<TokenPurpose, string> = {
  invitation: 'auth.invitation_phone_failed',
  password_reset: 'auth.password_reset_phone_failed',
};

export type PhoneCheckedOutcome<T> = { kind: 'invalid' } | { kind: 'phone_mismatch' } | { kind: 'ok'; value: T };

/**
 * Brute-force limit for emailed links that are redeemed with a phone number (invitation, password reset).
 * Under a transaction-scoped advisory lock per token: the token row must be valid (unused, unexpired, right
 * purpose) and below MAX_PHONE_FAILURES; a wrong phone is audited against the token id and the failure that
 * reaches the limit marks the token used. Only with the right phone does `onMatch` run, in the same
 * transaction, so callers consume the token and write their changes atomically with the check.
 */
@Injectable()
export class TokenPhoneLimiter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async redeem<T>(
    purpose: TokenPurpose,
    token: string,
    phoneOk: boolean,
    ip: string | undefined,
    onMatch: (tx: Prisma.TransactionClient, row: AuthToken) => Promise<T>,
  ): Promise<PhoneCheckedOutcome<T>> {
    const tokenHash = hashToken(token);
    const failedAction = PHONE_FAILED_ACTION[purpose];
    return this.prisma.$transaction(
      async (tx): Promise<PhoneCheckedOutcome<T>> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${purpose}:${tokenHash}`}))`;
        const now = this.clock.now();
        const row = await tx.authToken.findUnique({ where: { tokenHash } });
        if (!row || row.purpose !== purpose || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
          return { kind: 'invalid' };
        }
        const failures = await tx.auditLog.count({
          where: { action: failedAction, targetType: 'auth_token', targetId: String(row.id) },
        });
        if (failures >= MAX_PHONE_FAILURES) return { kind: 'invalid' };
        if (!phoneOk) {
          await this.audit.record(
            { action: failedAction, targetType: 'auth_token', targetId: String(row.id), ip, meta: { personId: row.personId } },
            tx,
          );
          if (failures + 1 >= MAX_PHONE_FAILURES) await tx.authToken.update({ where: { id: row.id }, data: { usedAt: now } });
          return { kind: 'phone_mismatch' };
        }
        return { kind: 'ok', value: await onMatch(tx, row) };
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
