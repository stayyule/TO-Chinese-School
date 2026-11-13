import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppError } from '../common/errors';

export interface PasswordColumns {
  passwordHashV2: string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
}

/** OWASP Password Storage Cheat Sheet minimum for argon2id: m=19 MiB, t=2, p=1 (~20 ms per hash). */
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;

const isBlank = (s: string | null): s is null => s === null || s.trim() === '';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash?: Promise<string>;

  onModuleInit(): Promise<string> {
    return this.dummy();
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  /** The old Rails format: hex SHA256(password + salt), salt used exactly as stored. */
  legacyHash(plain: string, salt: string): string {
    return createHash('sha256').update(plain + salt, 'utf8').digest('hex');
  }

  /**
   * A v2 (argon2id) hash, when present, is authoritative: the legacy columns are never consulted, so an old
   * password stops working once a new one is set. Without a v2 hash the legacy hash is checked, and an argon2
   * verification against a dummy hash is always performed too, so unknown users (pass all-null columns),
   * users without a usable hash and legacy users all cost about one argon2 verification.
   */
  async verify(plain: string, user: PasswordColumns): Promise<{ ok: boolean; needsUpgrade: boolean }> {
    if (!isBlank(user.passwordHashV2)) {
      return { ok: await this.argonVerify(user.passwordHashV2, plain), needsUpgrade: false };
    }
    await this.argonVerify(await this.dummy(), plain);
    if (isBlank(user.passwordHash) || user.passwordSalt === null || user.passwordSalt === '') {
      return { ok: false, needsUpgrade: false };
    }
    const computed = Buffer.from(this.legacyHash(plain, user.passwordSalt), 'utf8');
    const stored = Buffer.from(user.passwordHash, 'utf8');
    const ok = computed.length === stored.length && timingSafeEqual(computed, stored);
    return { ok, needsUpgrade: ok };
  }

  /** Policy for NEW passwords (register, reset, change). Legacy short passwords still log in. */
  assertPolicy(plain: string): void {
    if ([...plain].length < MIN_PASSWORD_LENGTH) {
      throw new AppError(422, 'PASSWORD_TOO_SHORT', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
  }

  private async argonVerify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false; // malformed stored hash
    }
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    return this.dummyHash;
  }
}
