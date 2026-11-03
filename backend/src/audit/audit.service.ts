import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { redact } from '../common/redact';
import { PrismaService } from '../prisma/prisma.service';

/** The root client or an interactive-transaction client; pass the latter to read/write inside a transaction. */
export type AuditDb = Prisma.TransactionClient;

export interface AuditEvent {
  action: string;
  actorUserId?: number;
  actorUsername?: string;
  targetType?: string;
  targetId?: string | number;
  ip?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Append-only. Write failures propagate: security events must not be silently dropped. */
  async record(e: AuditEvent, db: AuditDb = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        occurredAt: this.clock.now(),
        action: e.action,
        actorUserId: e.actorUserId ?? null,
        actorUsername: e.actorUsername?.toLowerCase() ?? null,
        targetType: e.targetType ?? null,
        targetId: e.targetId === undefined ? null : String(e.targetId),
        ip: e.ip ?? null,
        meta: redact(e.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * `failedAction` rows of the user (by id) within the last `sinceMs`, after the user's most recent
   * `resetAction` row (e.g. auth.password_change_failed after the last auth.password_changed).
   */
  async countRecentUserFailures(
    userId: number,
    failedAction: string,
    resetAction: string,
    sinceMs: number,
    db: AuditDb = this.prisma,
  ): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - sinceMs);
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM audit_logs f
      WHERE f.action = ${failedAction}
        AND f.actor_user_id = ${userId}
        AND f.occurred_at > ${cutoff}::timestamptz
        AND f.id > COALESCE(
          (SELECT max(s.id) FROM audit_logs s WHERE s.action = ${resetAction} AND s.actor_user_id = ${userId}),
          0)`;
    return rows[0]?.n ?? 0;
  }

  /** Failed logins for `username` within the last `sinceMs`, after its most recent successful login. */
  async countRecentFailures(username: string, sinceMs: number, db: AuditDb = this.prisma): Promise<number> {
    const user = username.toLowerCase();
    const cutoff = new Date(this.clock.now().getTime() - sinceMs);
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM audit_logs f
      WHERE f.action = 'auth.login_failed'
        AND f.actor_username = ${user}
        AND f.occurred_at > ${cutoff}::timestamptz
        AND f.id > COALESCE(
          (SELECT max(s.id) FROM audit_logs s WHERE s.action = 'auth.login_succeeded' AND s.actor_username = ${user}),
          0)`;
    return rows[0]?.n ?? 0;
  }
}
