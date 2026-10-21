import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

export function registerSecurityHeaders(app: FastifyInstance, config: AppConfig) {
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (request.url.startsWith('/api/') || request.url.startsWith('/downloads/android/latest.json'))
      reply.header('Cache-Control', 'no-store');
    if (request.url.split('?')[0] === '/sw.js') reply.header('Cache-Control', 'no-store');
    if (config.NODE_ENV === 'production' && new URL(config.RODZINA_PUBLIC_URL).protocol === 'https:')
      reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
}
