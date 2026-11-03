import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';

export const LOCKOUT_WINDOW_MS = 15 * 60_000;
export const LOCKOUT_THRESHOLD = 5;
/** Upper bound: failures are not recorded while locked, so the lock ends at most 15 min after the last one. */
export const LOCKOUT_RETRY_AFTER_SECONDS = LOCKOUT_WINDOW_MS / 1000;

/** D2: 5 consecutive failures for the same (lower-cased, via AuditService) username within 15 minutes lock it. */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly audit: AuditService) {}

  async assertAllowed(username: string): Promise<void> {
    if ((await this.audit.countRecentFailures(username, LOCKOUT_WINDOW_MS)) >= LOCKOUT_THRESHOLD) {
      throw new AppError(429, 'LOGIN_LOCKED', 'Too many failed login attempts. Try again later.', {
        retryAfterSeconds: LOCKOUT_RETRY_AFTER_SECONDS,
      });
    }
  }
}
