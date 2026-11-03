import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { MailService } from '../mail/mail.service';
import { PersonPhoneService } from '../people/phone';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenService } from './auth-token.service';
import { PasswordService } from './password.service';
import { englishName } from './registration.service';
import { SessionService } from './session.service';
import { TokenPhoneLimiter } from './token-phone-limiter';

export interface ResetPasswordInput {
  token: string;
  password: string;
  passwordConfirmation: string;
  phoneNumber: string;
}

const invalidToken = (): AppError => new AppError(404, 'INVALID_TOKEN', 'This link is invalid or has expired.');
const nonBlank = (s: string | null | undefined): string | null => (s && s.trim() !== '' ? s.trim() : null);

/**
 * Forgot password, reset password, forgot username.
 *
 * D1: the two "forgot" requests must not reveal whether a username or email is on record. The controller answers
 * 202 {} immediately and the lookup, token issue and mail run detached afterwards (runDetached), so the status,
 * body and response time are the same whether or not anything matches. Failures there are logged without
 * recipient, token or username and never reach the client.
 */
@Injectable()
export class AccountService implements OnModuleDestroy {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly phones: PersonPhoneService,
    private readonly sessions: SessionService,
    private readonly limiter: TokenPhoneLimiter,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Resolves once all detached work started so far (and any it started) has settled. */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  onModuleDestroy(): Promise<void> {
    return this.whenIdle();
  }

  /** Detached: mails a reset link to the user's personal email address if there is one. Returns nothing observable. */
  requestPasswordReset(username: string): void {
    this.runDetached('password reset request', () => this.sendPasswordReset(username.trim()));
  }

  /** Detached: mails one reminder listing the usernames reachable from addresses with this email. */
  requestUsernameReminder(email: string): void {
    this.runDetached('username reminder', () => this.sendUsernameReminder(email.trim().toLowerCase()));
  }

  /** 404 INVALID_TOKEN unless `token` is an unused, unexpired password-reset token. */
  async checkResetToken(token: string): Promise<void> {
    await this.tokens.peek('password_reset', token);
  }

  /**
   * Same discipline as registration: token (404), confirmation and policy (422), then, under the per-token lock
   * of TokenPhoneLimiter, the phone (422 PHONE_MISMATCH, counted; the 5th failure kills the token). Only then,
   * in that one transaction: consume the token, set password_hash_v2 (legacy columns untouched; v2 is
   * authoritative from now on), drop every session of the user and audit. Exactly one user is reset: the
   * lowest-id user of the person (legacy data may hold duplicates; the others are named in the audit meta).
   * A person without a user is an invalid token (forgot-password only issues tokens for people with a user).
   */
  async resetPassword(input: ResetPasswordInput, ip?: string): Promise<void> {
    const { personId } = await this.tokens.peek('password_reset', input.token);
    if (input.password !== input.passwordConfirmation) {
      throw new AppError(422, 'PASSWORD_MISMATCH', 'Password and confirmation do not match');
    }
    this.passwords.assertPolicy(input.password);
    // Slow and side-effect free: done before the transaction so the lock is held briefly.
    const passwordHashV2 = await this.passwords.hash(input.password);
    const phoneOk = await this.phones.phoneMatchesPerson(personId, input.phoneNumber);

    const outcome = await this.limiter.redeem('password_reset', input.token, phoneOk, ip, async (tx, row): Promise<boolean> => {
      const [user, ...others] = await tx.user.findMany({
        where: { personId: row.personId },
        orderBy: { id: 'asc' },
        select: { id: true, username: true },
      });
      if (!user) return false;
      await this.tokens.consume('password_reset', input.token, tx);
      await tx.user.update({ where: { id: user.id }, data: { passwordHashV2, updatedAt: this.clock.now() } });
      await this.sessions.destroyAllForUser(user.id, tx);
      const meta: Record<string, unknown> = { personId: row.personId };
      if (others.length > 0) meta.otherUserIds = others.map((u) => u.id);
      await this.audit.record(
        {
          action: 'auth.password_reset',
          actorUserId: user.id,
          actorUsername: user.username ?? undefined,
          targetType: 'user',
          targetId: user.id,
          ip,
          meta,
        },
        tx,
      );
      return true;
    });

    if (outcome.kind === 'phone_mismatch') throw new AppError(422, 'PHONE_MISMATCH', 'The phone number does not match our records');
    if (outcome.kind === 'invalid' || !outcome.value) throw invalidToken();
  }

  private runDetached(label: string, work: () => Promise<void>): void {
    const p: Promise<void> = work()
      .catch((err: unknown) => {
        // Only the error class: messages may carry query parameters (usernames, addresses).
        logger.error({ errName: err instanceof Error ? err.name : typeof err }, `${label} failed`);
      })
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** signin#forgot_password: User.find_by_username (first row; case-sensitive), then Person#personal_email_address. */
  private async sendPasswordReset(username: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { username }, orderBy: { id: 'asc' }, select: { personId: true } });
    if (!user || user.personId === null) return;
    const person = await this.prisma.person.findUnique({
      where: { id: user.personId },
      select: { id: true, englishFirstName: true, englishLastName: true, chineseName: true, address: { select: { email: true } } },
    });
    if (!person) return;
    const to = await this.personalEmailAddress(person.id, person.address);
    if (!to) return;
    const { token } = await this.tokens.issue('password_reset', person.id);
    await this.mail.send('password_reset', to, { name: englishName(person) ?? person.chineseName ?? 'Parent', token });
  }

  /**
   * Person#personal_email_address: a person with an own address uses that address's email (blank = none, as the
   * phone check also uses that address only); otherwise the first family, as parent then as child, each by id,
   * whose address has a non-blank email.
   */
  private async personalEmailAddress(personId: number, own: { email: string | null } | null): Promise<string | null> {
    if (own) return nonBlank(own.email);
    const select = { address: { select: { email: true } } } as const;
    const asParent = await this.prisma.family.findMany({
      where: { OR: [{ parentOneId: personId }, { parentTwoId: personId }] },
      orderBy: { id: 'asc' },
      select,
    });
    const asChild = await this.prisma.family.findMany({
      where: { familiesChildren: { some: { childId: personId } } },
      orderBy: { id: 'asc' },
      select,
    });
    for (const f of [...asParent, ...asChild]) {
      const email = nonBlank(f.address?.email);
      if (email) return email;
    }
    return null;
  }

  /**
   * signin#forgot_username: every address with this email (trimmed, case-insensitive); an address used by a
   * person yields that person's users, otherwise the users of the parents of the families using it. One mail to
   * the first matching address on record, listing each username once.
   */
  private async sendUsernameReminder(email: string): Promise<void> {
    const addresses = await this.prisma.$queryRaw<{ id: number; email: string }[]>`
      SELECT id, email FROM addresses WHERE lower(btrim(email)) = ${email} ORDER BY id`;
    if (addresses.length === 0) return;
    const ids = addresses.map((a) => a.id);
    const people = await this.prisma.person.findMany({ where: { addressId: { in: ids } }, select: { id: true, addressId: true } });
    const personAddressIds = new Set(people.map((p) => p.addressId));
    const familyAddressIds = ids.filter((id) => !personAddressIds.has(id));
    const families =
      familyAddressIds.length === 0
        ? []
        : await this.prisma.family.findMany({ where: { addressId: { in: familyAddressIds } }, select: { parentOneId: true, parentTwoId: true } });
    const personIds = [
      ...people.map((p) => p.id),
      ...families.flatMap((f) => [f.parentOneId, f.parentTwoId]).filter((id): id is number => id !== null),
    ];
    const users = await this.prisma.user.findMany({
      where: { personId: { in: personIds } },
      orderBy: { id: 'asc' },
      select: { username: true, person: { select: { id: true, englishFirstName: true, englishLastName: true, chineseName: true } } },
    });
    const usernames = [...new Set(users.map((u) => nonBlank(u.username)).filter((u): u is string => u !== null))];
    if (usernames.length === 0) return;
    const owners = new Set(users.map((u) => u.person?.id));
    const only = owners.size === 1 ? users[0].person : null;
    const name = (only && (englishName(only) ?? only.chineseName)) || 'Parent';
    await this.mail.send('username_reminder', addresses[0].email.trim(), { name, usernames: usernames.join('\n') });
  }
}
