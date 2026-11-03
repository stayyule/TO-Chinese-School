import { existsSync } from 'fs';
import * as path from 'path';
import { createMailTransport } from './mail-transport';
import { MailConfig, MailService } from './mail.service';

const config: MailConfig = { appBaseUrl: 'https://example.test', transport: 'memory', smtpUrl: undefined };
const TOKEN = 'abc_DEF-123';

describe('MailService', () => {
  let mail: MailService;
  beforeEach(() => {
    mail = new MailService(config);
  });

  it('renders the invitation with exact subject, From, link and 72 hours', async () => {
    await mail.send('account_invitation', 'parent@example.com', { name: 'Ada Lin', token: TOKEN });
    expect(mail.outbox).toHaveLength(1);
    const m = mail.outbox[0];
    expect(m.subject).toBe('Thousand Oaks Chinese School - Account Invitation');
    expect(m.from).toBe('engineering@to-cs.org');
    expect(m.to).toBe('parent@example.com');
    expect(m.text).toContain('Dear Ada Lin,');
    expect(m.text).toContain(`https://example.test/register-with-invitation/${TOKEN}`);
    expect(m.text).toContain('72 hours');
    expect(m.text).toContain('https://example.test/signin');
    expect(m.text).not.toContain('{{');
  });

  it('renders the password reset with exact subject, link and 6 hours', async () => {
    await mail.send('password_reset', 'parent@example.com', { name: 'Ada Lin', token: TOKEN });
    const m = mail.outbox[0];
    expect(m.subject).toBe('Thousand Oaks Chinese School - Password Reset');
    expect(m.from).toBe('engineering@to-cs.org');
    expect(m.text).toContain(`https://example.test/reset-password/${TOKEN}`);
    expect(m.text).toContain('6 hours');
  });

  it('renders the username reminder with usernames and sign-in URL', async () => {
    await mail.send('username_reminder', 'parent@example.com', { name: 'Ada Lin', usernames: 'ada1\nada2' });
    const m = mail.outbox[0];
    expect(m.subject).toBe('Thousand Oaks Chinese School - Username Reminder');
    expect(m.text).toContain('ada1\nada2');
    expect(m.text).toContain('https://example.test/signin');
  });

  it.each([
    'a@b.com\r\nBcc: x@y.com',
    'a@b.com\nBcc: x@y.com',
    'a@b.com, c@d.com',
    'a@b.com;c@d.com',
    'Ada <a@b.com>',
    'no-at-sign',
    '',
    'a b@c.com',
  ])('rejects recipient %j', async (to) => {
    await expect(mail.send('password_reset', to, { name: 'A', token: TOKEN })).rejects.toThrow(/recipient/i);
    expect(mail.outbox).toHaveLength(0);
  });

  it('throws when a template variable is missing', async () => {
    await expect(mail.send('account_invitation', 'a@b.com', { token: TOKEN })).rejects.toThrow(/missing/i);
    expect(mail.outbox).toHaveLength(0);
  });

  it('rejects a token that is not base64url', async () => {
    await expect(mail.send('password_reset', 'a@b.com', { name: 'A', token: 'x/../y z' })).rejects.toThrow(/token/i);
  });

  it('does not re-expand placeholders found inside values', async () => {
    await mail.send('password_reset', 'a@b.com', { name: '{{token}}', token: TOKEN });
    expect(mail.outbox[0].text).toContain('Dear {{token}},');
  });

  it('ships its templates next to the service (copied by nest build assets)', () => {
    for (const t of ['account_invitation', 'password_reset', 'username_reminder']) {
      expect(existsSync(path.join(__dirname, 'templates', `${t}.txt`))).toBe(true);
    }
  });
});

describe('createMailTransport', () => {
  it('chooses memory without opening sockets', () => {
    expect(createMailTransport(config, []).kind).toBe('memory');
  });

  it('chooses smtp when configured (nodemailer connects lazily)', () => {
    const t = createMailTransport({ ...config, transport: 'smtp', smtpUrl: 'smtp://localhost:2525' }, []);
    expect(t.kind).toBe('smtp');
  });

  it('requires SMTP_URL for smtp', () => {
    expect(() => createMailTransport({ ...config, transport: 'smtp', smtpUrl: undefined }, [])).toThrow(/SMTP_URL/);
  });
});
