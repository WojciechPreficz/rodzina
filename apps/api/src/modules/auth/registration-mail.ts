import { escapeHtml } from './mail-html.js';
import type { AppConfig } from '../../config.js';
import { sendMail } from './reset-mail.js';

export type RegistrationMail = { to: string; link: string; expiresAt: number };

export function registrationMailContent({ link, expiresAt }: RegistrationMail) {
  const expiry = new Date(expiresAt).toISOString();
  return {
    subject: 'Rodzina — potwierdź założenie konta',
    text: `Aby potwierdzić chęć założenia konta rodziny, otwórz link i potwierdź rejestrację:\n${link}\n\nDopiero po potwierdzeniu utworzymy rodzinę i konto administratora. Link jest jednorazowy i ważny przez 24 godziny, do ${expiry} (UTC).\nJeśli nie prosisz o założenie konta, zignoruj tę wiadomość.`,
    html: `<p>Aby potwierdzić chęć założenia konta rodziny, <a href="${escapeHtml(link)}">otwórz link i potwierdź rejestrację</a>.</p><p>Dopiero po potwierdzeniu utworzymy rodzinę i konto administratora. Link jest jednorazowy i ważny przez 24 godziny, do ${expiry} (UTC).</p><p>Jeśli nie prosisz o założenie konta, zignoruj tę wiadomość.</p>`,
  };
}

export async function sendRegistrationMail(config: AppConfig, mail: RegistrationMail) {
  await sendMail(config, { to: mail.to, ...registrationMailContent(mail) });
}
