import nodemailer from 'nodemailer';
import { config } from './config.js';

export const mailEnabled = () => Boolean(config.smtp.host);

let transport: nodemailer.Transporter | null = null;

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!mailEnabled()) throw new Error('SMTP is not configured');
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, to, subject, html });
}
