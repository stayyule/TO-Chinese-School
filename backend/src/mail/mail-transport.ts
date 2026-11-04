import { createTransport } from 'nodemailer';

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface MailTransportConfig {
  transport: 'smtp' | 'memory';
  smtpUrl: string | undefined;
}

export interface MailTransport {
  kind: 'smtp' | 'memory';
  deliver(mail: OutgoingMail): Promise<void>;
}

/** Chooses the transport from config. Neither branch opens a socket here (nodemailer connects on first send). */
export function createMailTransport(config: MailTransportConfig, outbox: OutgoingMail[]): MailTransport {
  if (config.transport === 'memory') {
    return {
      kind: 'memory',
      deliver: (mail) => {
        outbox.push(mail);
        return Promise.resolve();
      },
    };
  }
  if (!config.smtpUrl) throw new Error('SMTP_URL is required when MAIL_TRANSPORT=smtp');
  const smtp = createTransport(config.smtpUrl);
  return {
    kind: 'smtp',
    deliver: async (mail) => {
      await smtp.sendMail({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}
