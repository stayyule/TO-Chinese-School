import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createMailTransport, MailTransport, OutgoingMail } from './mail-transport';

export const MAIL_CONFIG = Symbol('MAIL_CONFIG');

export interface MailConfig {
  appBaseUrl: string;
  transport: 'smtp' | 'memory';
  smtpUrl: string | undefined;
}

export type MailTemplate = 'account_invitation' | 'password_reset' | 'username_reminder';

export const MAIL_FROM = 'engineering@to-cs.org';
const SUPPORT_EMAIL = 'engineering@to-cs.org';
const SUBJECT_PREFIX = 'Thousand Oaks Chinese School - ';

const SUBJECTS: Record<MailTemplate, string> = {
  account_invitation: `${SUBJECT_PREFIX}Account Invitation`,
  password_reset: `${SUBJECT_PREFIX}Password Reset`,
  username_reminder: `${SUBJECT_PREFIX}Username Reminder`,
};

/** Templates that carry a `token` var get a `link` built from this path. */
const LINK_PATHS: Partial<Record<MailTemplate, string>> = {
  account_invitation: '/register-with-invitation/',
  password_reset: '/reset-password/',
};

// One plausible address: no whitespace/control chars, no list or display-name syntax.
const EMAIL = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\]+$/;
const TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * Plain-text mail. Callers pass `name` plus `token` (invitation/reset: the service builds the link from
 * APP_BASE_URL) or `usernames` (reminder, one per line). Never logs recipients, links or bodies.
 */
@Injectable()
export class MailService {
  readonly outbox: OutgoingMail[] = [];
  private readonly baseUrl: string;
  private transport: MailTransport | undefined;

  constructor(@Inject(MAIL_CONFIG) private readonly config: MailConfig) {
    this.baseUrl = config.appBaseUrl.replace(/\/+$/, '');
  }

  async send(template: MailTemplate, to: string, vars: Record<string, string>): Promise<void> {
    if (!EMAIL.test(to)) throw new Error('Invalid mail recipient');
    const text = this.render(template, vars);
    this.transport ??= createMailTransport(this.config, this.outbox);
    await this.transport.deliver({ from: MAIL_FROM, to, subject: SUBJECTS[template], text });
  }

  private render(template: MailTemplate, vars: Record<string, string>): string {
    const all: Record<string, string> = { ...vars, signinUrl: `${this.baseUrl}/signin`, supportEmail: SUPPORT_EMAIL };
    const linkPath = LINK_PATHS[template];
    if (linkPath) {
      if (!vars.token || !TOKEN.test(vars.token)) throw new Error('Invalid or missing token for mail link');
      all.link = `${this.baseUrl}${linkPath}${vars.token}`;
    }
    const source = readFileSync(path.join(__dirname, 'templates', `${template}.txt`), 'utf8');
    // Single pass: values are never re-scanned for placeholders.
    const text = source.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      const value = all[key];
      if (value === undefined) throw new Error(`Missing mail template variable "${key}" for ${template}`);
      return value;
    });
    if (source.replace(/\{\{(\w+)\}\}/g, '').includes('{{')) throw new Error(`Malformed placeholder in ${template}`);
    return text;
  }
}
