import type { AppConfig } from '../../config.js';
import { escapeHtml } from '../auth/mail-html.js';
import { sendMail } from '../auth/reset-mail.js';

export type InvitationMail = { to: string; link: string };

export async function sendInvitationMail(config: AppConfig, { to, link }: InvitationMail) {
  await sendMail(config, {
    to,
    subject: 'Rodzina — potwierdź dołączenie do rodziny',
    text: `Aby dokończyć dołączanie do rodziny, otwórz link i ustaw swoje hasło:\n${link}\n\nLink jest jednorazowy i ważny do 30 minut. Jeśli nie prosisz o dołączenie, zignoruj tę wiadomość.`,
    html: `<p>Aby dokończyć dołączanie do rodziny, <a href="${escapeHtml(link)}">otwórz link i ustaw swoje hasło</a>.</p><p>Link jest jednorazowy i ważny do 30 minut. Jeśli nie prosisz o dołączenie, zignoruj tę wiadomość.</p>`,
  });
}
