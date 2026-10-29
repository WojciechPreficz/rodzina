import nodemailer from 'nodemailer';
import { Socket } from 'node:net';
import type { AppConfig } from '../../config.js';

export const SMTP_TIMEOUT_MS = 4000;
export type ResetMail = { to: string; link: string; expiresAt: number };

export function resetMailContent({ link, expiresAt }: ResetMail) {
  const expiry = new Date(expiresAt).toISOString();
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  return {
    subject: 'Rodzina — zmiana hasła',
    text: `Aby ustawić nowe hasło w aplikacji Rodzina, otwórz link:\n${link}\n\nLink jest jednorazowy i ważny przez 30 minut, do ${expiry} (UTC).\nJeśli nie prosisz o zmianę hasła, zignoruj tę wiadomość.`,
    html: `<p>Aby ustawić nowe hasło w aplikacji Rodzina, <a href="${escape(link)}">otwórz link zmiany hasła</a>.</p><p>Link jest jednorazowy i ważny przez 30 minut, do ${escape(expiry)} (UTC).</p><p>Jeśli nie prosisz o zmianę hasła, zignoruj tę wiadomość.</p>`,
  };
}

export async function sendResetMail(config: AppConfig, mail: ResetMail): Promise<void> {
  const socket = new Socket();
  const transport = nodemailer.createTransport({
    // Open the socket here so the total deadline also cancels DNS/connect work;
    // handing over a connected socket leaves TLS/STARTTLS to Nodemailer.
    getSocket: (_options, callback) => {
      const failed = (error: Error) => callback(error, false);
      socket.once('error', failed);
      socket.connect(config.RODZINA_SMTP_PORT, config.RODZINA_SMTP_HOST, () => {
        socket.removeListener('error', failed);
        callback(null, { connection: socket });
      });
    },
    host: config.RODZINA_SMTP_HOST,
    port: config.RODZINA_SMTP_PORT,
    secure: config.RODZINA_SMTP_SECURE,
    requireTLS: !config.RODZINA_SMTP_SECURE,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: config.RODZINA_SMTP_USER, pass: config.RODZINA_SMTP_PASSWORD },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    dnsTimeout: SMTP_TIMEOUT_MS,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport
        .sendMail({
          from: { name: 'Rodzina', address: config.RODZINA_MAIL_FROM },
          to: mail.to,
          ...resetMailContent(mail),
        })
        .then((result) => {
          if (result.accepted.length !== 1 || result.rejected.length)
            throw new Error('SMTP recipient was not accepted.');
        }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          socket.destroy();
          transport.close();
          reject(new Error('SMTP delivery timed out.'));
        }, SMTP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    socket.destroy();
    transport.close();
  }
}
