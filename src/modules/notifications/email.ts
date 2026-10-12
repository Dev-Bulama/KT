import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

/** Development fallback: logs the email instead of sending it. Content is retained in the outbox table. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(message: EmailMessage) {
    logger.info("email.console", { to: message.to, subject: message.subject, text: message.text.slice(0, 2000) });
    return { id: null };
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private client: Resend;
  constructor(apiKey: string, private from: string) {
    this.client = new Resend(apiKey);
  }
  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) throw new Error(`Resend error: ${error.name}: ${error.message}`);
    return { id: data?.id ?? null };
  }
}

export type SmtpSecurity = "tls" | "starttls" | "none";

export interface SmtpOptions {
  host: string;
  port: number;
  /** "tls": implicit TLS (usually port 465). "starttls": upgrade required (usually 587). "none": plaintext (development only). */
  security: SmtpSecurity;
  username?: string | null;
  password?: string | null;
  from: string;
  replyTo?: string | null;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transport: Transporter;
  constructor(private opts: SmtpOptions) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.security === "tls",
      requireTLS: opts.security === "starttls",
      ignoreTLS: opts.security === "none",
      auth: opts.username ? { user: opts.username, pass: opts.password ?? "" } : undefined,
      // Certificates are always verified; TLS 1.2+ only.
      tls: { minVersion: "TLSv1.2", servername: opts.host },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  /** Connects and authenticates without sending (used by the admin "test connection" button). */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: this.opts.from,
      replyTo: this.opts.replyTo || undefined,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { id: info.messageId ?? null };
  }
  close() {
    this.transport.close();
  }
}

let provider: EmailProvider | null = null;

/** Provider configured by environment variables (EMAIL_PROVIDER). Admin-configured SMTP takes precedence; see email-config.ts. */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const kind = process.env.EMAIL_PROVIDER ?? "console";
  if (kind === "smtp") {
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST");
    const security = (process.env.SMTP_SECURITY ?? "starttls") as SmtpSecurity;
    provider = new SmtpEmailProvider({
      host,
      port: Number(process.env.SMTP_PORT ?? (security === "tls" ? 465 : 587)),
      security,
      username: process.env.SMTP_USER || null,
      password: process.env.SMTP_PASSWORD || null,
      from: process.env.EMAIL_FROM ?? "no-reply@localhost",
    });
  } else if (kind === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    provider = new ResendEmailProvider(key, process.env.EMAIL_FROM ?? "no-reply@localhost");
  } else {
    if (process.env.NODE_ENV === "production") logger.warn("email.console_provider_in_production");
    provider = new ConsoleEmailProvider();
  }
  return provider;
}

let override: EmailProvider | null = null;

/** Tests may inject a provider; it takes precedence over all configuration. */
export function setEmailProvider(p: EmailProvider | null) {
  override = p;
}

export function getEmailOverride(): EmailProvider | null {
  return override;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmailHtml(title: string, body: string, link?: string | null): string {
  const appUrl = process.env.APP_URL ?? "";
  const href = link ? (link.startsWith("http") ? link : `${appUrl}${link}`) : null;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6fa;padding:24px;color:#0f1d3a">
<table role="presentation" width="100%" style="max-width:560px;margin:auto;background:#fff;border-radius:8px;border:1px solid #dde3ee">
<tr><td style="background:#0b2a5b;color:#fff;padding:16px 24px;font-weight:bold">KATDICT Service &amp; Project Intelligence Platform</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
<p style="white-space:pre-line;line-height:1.5">${esc(body)}</p>
${href ? `<p><a href="${esc(href)}" style="display:inline-block;background:#0b2a5b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in platform</a></p>` : ""}
<p style="font-size:12px;color:#5b6b85;margin-top:24px">Katsina State Directorate of ICT. This is an automated message; do not reply.</p></td></tr></table></body></html>`;
}
