import { Injectable } from '@nestjs/common';
import { createLogger } from '@surfgen/telemetry';
import nodemailer, { type Transporter } from 'nodemailer';

const logger = createLogger({ service: 'surfgen-api-mailer' });

/**
 * Outbound email. SMTP is configured entirely via env (SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, MAIL_FROM); when SMTP_HOST is unset the mailer logs
 * the message instead of sending — dev/trial stacks keep working and the
 * verification link is readable in the API logs.
 */
@Injectable()
export class MailerService {
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.from = process.env.MAIL_FROM ?? 'SurfGen <no-reply@surfgen.local>';
    if (!host) {
      this.transport = null;
      return;
    }
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(process.env.SMTP_USER && {
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' },
      }),
    });
  }

  get isConfigured(): boolean {
    return this.transport !== null;
  }

  async sendVerificationEmail(to: string, name: string, verifyUrl: string): Promise<void> {
    const subject = 'Verify your SurfGen email address';
    const text = [
      `Hi ${name},`,
      '',
      'Confirm this email address to activate your SurfGen account:',
      verifyUrl,
      '',
      'The link is valid for 24 hours and can be used once.',
      "If you didn't create a SurfGen account, ignore this email.",
    ].join('\n');
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#221E1B">Verify your email</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>Confirm this email address to activate your SurfGen account:</p>
        <p style="margin:28px 0">
          <a href="${verifyUrl}" style="background:#8B5E2F;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">
            Verify email
          </a>
        </p>
        <p style="color:#7A6B5C;font-size:13px">The link is valid for 24 hours and can be used once.<br/>
        If you didn't create a SurfGen account, ignore this email.</p>
      </div>`;

    if (!this.transport) {
      logger.info({ to, verifyUrl }, 'SMTP not configured — verification link logged instead');
      return;
    }
    await this.transport.sendMail({ from: this.from, to, subject, text, html });
    logger.info({ to }, 'verification email sent');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
