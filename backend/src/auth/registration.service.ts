import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RoleDerivationService } from '../access/role-derivation.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { MailService, SINGLE_EMAIL } from '../mail/mail.service';
import { PersonPhoneService } from '../people/phone';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenService } from './auth-token.service';
import { PasswordService } from './password.service';
import { TokenPhoneLimiter } from './token-phone-limiter';

export const STUDENT_PARENT_ROLE = 'Student Parent';

export interface Actor {
  userId?: number;
  username?: string;
  ip?: string;
}

export interface RegisterInput {
  token: string;
  username: string;
  password: string;
  passwordConfirmation: string;
  phoneNumber: string;
}

type RegisterOutcome = { kind: 'created'; userId: number } | { kind: 'account_exists' };

const invalidToken = (): AppError => new AppError(404, 'INVALID_TOKEN', 'This link is invalid or has expired.');

export function englishName(p: { englishFirstName: string | null; englishLastName: string | null }): string | null {
  const name = [p.englishFirstName, p.englishLastName].filter((s) => s && s.trim() !== '').join(' ');
  return name === '' ? null : name;
}

/** Account invitations and self-registration with an invitation link. */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly phones: PersonPhoneService,
    private readonly roles: RoleDerivationService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limiter: TokenPhoneLimiter,
  ) {}

  /**
   * users.username has no unique index, so uniqueness is enforced here: takes a transaction-scoped advisory lock
   * on the lower-cased name, then checks case-sensitively (the old system's lookups are case-sensitive). Callers
   * must create the user in the same transaction `tx`, after this returns. 409 USERNAME_TAKEN otherwise.
   */
  async assertUsernameFree(tx: Prisma.TransactionClient, username: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('username:' || lower(${username})))`;
    if ((await tx.user.count({ where: { username } })) > 0) {
      throw new AppError(409, 'USERNAME_TAKEN', 'This username is already taken. Please choose another.');
    }
  }

  async invite(personId: number, emailDestination: string | undefined, actor: Actor): Promise<{ personId: number; expiresAt: string }> {
    const to = (emailDestination ?? '').trim();
    if (to === '') throw new AppError(422, 'EMAIL_REQUIRED', 'Email destination can not be empty');
    if (!SINGLE_EMAIL.test(to)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Validation failed', ['emailDestination must be a single email address']);
    }
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { id: true, englishFirstName: true, englishLastName: true, chineseName: true },
    });
    if (!person) throw new AppError(404, 'PERSON_NOT_FOUND', 'Person not found');
    if ((await this.prisma.user.count({ where: { personId } })) > 0) {
      throw new AppError(409, 'PERSON_ALREADY_HAS_ACCOUNT', 'This person already has an account');
    }

    const { token, expiresAt } = await this.tokens.issue('invitation', personId);
    const name = englishName(person) ?? person.chineseName ?? 'Parent';
    await this.mail.send('account_invitation', to, { name, token });
    await this.audit.record({
      action: 'auth.invitation_sent',
      actorUserId: actor.userId,
      actorUsername: actor.username,
      targetType: 'person',
      targetId: personId,
      ip: actor.ip,
      meta: { personId },
    });
    return { personId, expiresAt: expiresAt.toISOString() };
  }

  async invitationInfo(token: string): Promise<{ personName: string | null }> {
    const { personId } = await this.tokens.peek('invitation', token);
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { englishFirstName: true, englishLastName: true, chineseName: true },
    });
    if (!person) throw invalidToken();
    return { personName: englishName(person) ?? person.chineseName };
  }

  /**
   * Check order (so a failed attempt reveals as little as possible and never burns the link): token valid (404),
   * password confirmation and policy (422), then, under the per-token lock of TokenPhoneLimiter, the phone (422;
   * counted, the MAX_PHONE_FAILURES-th failure invalidates the token), existing account (409 ACCOUNT_EXISTS, no
   * username disclosed) and username (409). The token is consumed only in the transaction that creates the user.
   */
  async register(input: RegisterInput, ip?: string): Promise<{ userId: number }> {
    const username = input.username.trim();
    const { personId } = await this.tokens.peek('invitation', input.token);
    if (input.password !== input.passwordConfirmation) {
      throw new AppError(422, 'PASSWORD_MISMATCH', 'Password and confirmation do not match');
    }
    this.passwords.assertPolicy(input.password);
    // Slow and side-effect free: done before the transaction so the locks are held briefly.
    const passwordHashV2 = await this.passwords.hash(input.password);
    const phoneOk = await this.phones.phoneMatchesPerson(personId, input.phoneNumber);

    const outcome = await this.limiter.redeem('invitation', input.token, phoneOk, ip, async (tx, row): Promise<RegisterOutcome> => {
      if ((await tx.user.count({ where: { personId: row.personId } })) > 0) return { kind: 'account_exists' };

      // Nothing has been written yet, so a USERNAME_TAKEN thrown here leaves the invitation usable.
      await this.assertUsernameFree(tx, username);
      await this.tokens.consume('invitation', input.token, tx);
      const now = this.clock.now();
      const user = await tx.user.create({
        data: { username, personId: row.personId, passwordHashV2, passwordHash: null, passwordSalt: null, createdAt: now, updatedAt: now },
        select: { id: true },
      });
      const studentParent = await tx.role.findFirst({ where: { name: STUDENT_PARENT_ROLE }, select: { id: true }, orderBy: { id: 'asc' } });
      if (!studentParent) throw new Error(`Role "${STUDENT_PARENT_ROLE}" is missing`);
      await tx.roleUser.create({ data: { roleId: studentParent.id, userId: user.id, createdAt: now, updatedAt: now } });
      await this.roles.adjust(user.id, tx);
      await this.audit.record(
        {
          action: 'auth.account_created',
          actorUserId: user.id,
          actorUsername: username,
          targetType: 'user',
          targetId: user.id,
          ip,
          meta: { personId: row.personId },
        },
        tx,
      );
      return { kind: 'created', userId: user.id };
    });

    if (outcome.kind === 'invalid') throw invalidToken();
    if (outcome.kind === 'phone_mismatch') throw new AppError(422, 'PHONE_MISMATCH', 'The phone number does not match our records');
    if (outcome.value.kind === 'account_exists') {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'An account already exists for this person. Use "Forgot username" to recover it.');
    }
    return { userId: outcome.value.userId };
  }
}
