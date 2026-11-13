import { AppError } from '../common/errors';
import { PasswordService } from './password.service';

const NO_HASH = { passwordHashV2: null, passwordHash: null, passwordSalt: null };

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('computes the legacy SHA256(password + salt) hex digest, salt used as stored', () => {
    expect(svc.legacyHash('secret1', 'abcdefgh')).toBe('914727a8b6364a21cd6cc46e4e4d2142e24ededdf404611d60fd99834be3e7d0');
    expect(svc.legacyHash('Pa55word!x', '/ab+c=')).toBe('972b0585dcc05a98d22da9509125f971e5d837384436fa50c5e9ee341357b532');
  });

  it('verifies a legacy-only user and asks for an upgrade', async () => {
    const user = { ...NO_HASH, passwordHash: svc.legacyHash('secret1', 'abcdefgh'), passwordSalt: 'abcdefgh' };
    await expect(svc.verify('secret1', user)).resolves.toEqual({ ok: true, needsUpgrade: true });
    await expect(svc.verify('secret2', user)).resolves.toEqual({ ok: false, needsUpgrade: false });
  });

  it('verifies an argon2id (v2) hash without asking for an upgrade', async () => {
    const v2 = await svc.hash('correct horse');
    expect(v2).toMatch(/^\$argon2id\$/);
    await expect(svc.verify('correct horse', { ...NO_HASH, passwordHashV2: v2 })).resolves.toEqual({ ok: true, needsUpgrade: false });
    await expect(svc.verify('wrong horse', { ...NO_HASH, passwordHashV2: v2 })).resolves.toEqual({ ok: false, needsUpgrade: false });
  });

  it('never falls back to the legacy hash once a v2 hash exists (old password stops working after a reset)', async () => {
    const user = {
      passwordHashV2: await svc.hash('brand new password'),
      passwordHash: svc.legacyHash('secret1', 'abcdefgh'),
      passwordSalt: 'abcdefgh',
    };
    await expect(svc.verify('secret1', user)).resolves.toEqual({ ok: false, needsUpgrade: false });
    await expect(svc.verify('brand new password', user)).resolves.toEqual({ ok: true, needsUpgrade: false });
  });

  it('returns ok:false without throwing for NULL or blank hash and salt', async () => {
    await expect(svc.verify('anything', NO_HASH)).resolves.toEqual({ ok: false, needsUpgrade: false });
    await expect(svc.verify('', NO_HASH)).resolves.toEqual({ ok: false, needsUpgrade: false });
    await expect(svc.verify('anything', { passwordHashV2: '', passwordHash: '', passwordSalt: '' })).resolves.toEqual({
      ok: false,
      needsUpgrade: false,
    });
    await expect(svc.verify('anything', { passwordHashV2: '  ', passwordHash: '  ', passwordSalt: null })).resolves.toEqual({
      ok: false,
      needsUpgrade: false,
    });
  });

  it('returns ok:false for a malformed v2 hash instead of throwing', async () => {
    await expect(svc.verify('anything', { ...NO_HASH, passwordHashV2: 'not-an-argon2-hash' })).resolves.toEqual({
      ok: false,
      needsUpgrade: false,
    });
  });

  it('enforces the 10-character minimum for new passwords', () => {
    expect(() => svc.assertPolicy('123456789')).toThrow(AppError);
    try {
      svc.assertPolicy('123456789');
    } catch (e) {
      expect(e).toMatchObject({ status: 422, code: 'PASSWORD_TOO_SHORT' });
    }
    expect(() => svc.assertPolicy('1234567890')).not.toThrow();
  });
});
