// @vitest-environment node
import { createServer, type Socket } from 'node:net';
import { expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { sendResetMail } from './reset-mail.js';

it('never sends credentials or a reset link to a server refusing STARTTLS', async () => {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', (chunk) => {
      const command = chunk.toString();
      received.push(command);
      socket.write(command.startsWith('EHLO') ? '250-localhost\r\n250 AUTH PLAIN\r\n' : '502 STARTTLS unavailable\r\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await expect(
      sendResetMail(
        {
          ...loadConfig({}),
          RODZINA_SMTP_HOST: '127.0.0.1',
          RODZINA_SMTP_PORT: (server.address() as { port: number }).port,
          RODZINA_SMTP_USER: 'private-user',
          RODZINA_SMTP_PASSWORD: 'private-password',
          RODZINA_MAIL_FROM: 'sender@example.com',
        },
        {
          to: 'recipient@example.com',
          link: 'https://example.com/reset-hasla/private-token',
          expiresAt: Date.now() + 30 * 60_000,
        },
      ),
    ).rejects.toThrow();
    expect(received.join('')).toContain('EHLO');
    expect(received.join('')).not.toMatch(/AUTH PLAIN|private-user|private-password|private-token|MAIL FROM/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
