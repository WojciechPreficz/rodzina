// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { Socket } from 'node:net';
import { loadConfig } from '../../config.js';
import { resetMailContent, sendResetMail, SMTP_TIMEOUT_MS } from './reset-mail.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
const mail = {
  to: 'recipient@example.com',
  link: 'https://rodzina.example.com/reset-hasla/test-token',
  expiresAt: Date.UTC(2026, 9, 29, 12),
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('SMTP sender', () => {
  it('sends Polish text and escaped HTML without trackers', () => {
    const content = resetMailContent({ ...mail, link: 'https://example.com/?a=1&b="unsafe"' });
    expect(content.text).toContain('30 minut');
    expect(content.text).toContain('2026-10-29T12:00:00.000Z');
    expect(content.html).toContain('&amp;b=&quot;unsafe&quot;');
    expect(content.html).not.toContain('<img');
    expect(content.text).toContain('zignoruj');
  });
  it.each([true, false])('uses verified encryption with secure=%s and closes the socket', async (secure) => {
    const destroy = vi.spyOn(Socket.prototype, 'destroy');
    const sendMail = vi.fn().mockResolvedValue({ accepted: [mail.to], rejected: [] });
    const close = vi.fn();
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as unknown as ReturnType<
      typeof nodemailer.createTransport
    >);
    await sendResetMail(
      { ...loadConfig({}), RODZINA_SMTP_SECURE: secure, RODZINA_MAIL_FROM: 'sender@example.com' },
      mail,
    );
    const options = vi.mocked(nodemailer.createTransport).mock.calls.at(-1)![0];
    expect(options).toMatchObject({
      secure,
      requireTLS: !secure,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      debug: false,
      logger: false,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: mail.to,
        from: { name: 'Rodzina', address: 'sender@example.com' },
        text: expect.stringContaining(mail.link),
      }),
    );
    expect(close).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
  it('bounds the whole send, destroys its socket and rejects ambiguous delivery', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn(() => new Promise(() => {})),
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    const pending = expect(sendResetMail(loadConfig({}), mail)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(SMTP_TIMEOUT_MS);
    await pending;
    expect(close).toHaveBeenCalled();
  });
  it('rejects an unaccepted recipient', async () => {
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ accepted: [], rejected: [mail.to] }),
      close: vi.fn(),
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await expect(sendResetMail(loadConfig({}), mail)).rejects.toThrow('not accepted');
  });
});
