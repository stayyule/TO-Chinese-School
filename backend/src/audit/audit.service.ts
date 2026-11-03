import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { redact } from '../common/redact';
import { PrismaService } from '../prisma/prisma.service';

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
  async record(e: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
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

  /** Failed logins for `username` within the last `sinceMs`, after its most recent successful login. */
  async countRecentFailures(username: string, sinceMs: number): Promise<number> {
    const user = username.toLowerCase();
    const cutoff = new Date(this.clock.now().getTime() - sinceMs);
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
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
