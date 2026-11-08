import { parse } from '../../http/validation.js';
import {
  registerFamilySchema,
  loginSchema,
  familyMembersQuerySchema,
  loginChildSchema,
  resetPasswordSchema,
} from './schemas.js';
import {
  registrationRequestResponseSchema,
  confirmRegistrationInputSchema,
  loginResponseSchema,
  familyMembersResponseSchema,
  loginChildResponseSchema,
  authOkResponseSchema,
  authMeResponseSchema,
  passwordResetResponseSchema,
  passwordRecoveryAvailabilitySchema,
  forgotPasswordInputSchema,
} from '@rodzina/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { createAuthService } from './service.js';
import { createSessionFactory } from './session.js';
import { createPasswordRecovery, RecoveryRateLimitError } from './password-recovery.js';
import type { sendResetMail } from './reset-mail.js';
import type { sendRegistrationMail } from './registration-mail.js';
import { createRegistration, RegistrationRateLimitError } from './registration.js';
import { ApiError } from '../../http/errors.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  database: DatabaseConnection,
  config: AppConfig,
  mailSender?: typeof sendResetMail,
  registrationMailSender?: typeof sendRegistrationMail,
) {
  const service = createAuthService(database);
  const createSession = createSessionFactory(database, config);
  const recoverPassword = createPasswordRecovery(database, config, app.log, mailSender);
  const registration = createRegistration(database, config, app.log, registrationMailSender);
  app.get('/api/auth/password-recovery', { config: { auth: 'public' } }, async () =>
    passwordRecoveryAvailabilitySchema.parse({ enabled: config.RODZINA_PASSWORD_RESET_EMAIL_ENABLED }),
  );
  app.post('/api/auth/forgot-password', { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
    try {
      const email = parse(forgotPasswordInputSchema, request.body, 'Podaj poprawny adres e-mail.').email;
      return reply.code(202).send(authOkResponseSchema.parse(await recoverPassword(email, request.ip)));
    } catch (error) {
      if (error instanceof RecoveryRateLimitError) reply.header('Retry-After', error.retryAfter);
      throw error;
    }
  });
  for (const url of ['/api/auth/registration-requests', '/api/auth/register-family']) {
    app.post(url, { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
      try {
        const result = await registration.request(
          parse(registerFamilySchema, request.body, 'Dane rejestracji są niepoprawne.'),
          request.ip,
        );
        // Older APKs expect a session on success. Their error UI can display the next step safely.
        if (url === '/api/auth/register-family')
          throw new ApiError(
            409,
            'EMAIL_CONFIRMATION_REQUIRED',
            'Sprawdź pocztę i potwierdź założenie rodziny linkiem w wiadomości. Konto powstanie po potwierdzeniu. Następnie zaloguj się w aplikacji.',
          );
        return reply.code(202).send(registrationRequestResponseSchema.parse(result));
      } catch (error) {
        if (error instanceof RegistrationRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    });
  }
  app.post('/api/auth/confirm-registration', { config: { auth: 'public', idempotency: false } }, async (request) => {
    const { token } = parse(confirmRegistrationInputSchema, request.body, 'Link potwierdzenia jest nieprawidłowy.');
    return authOkResponseSchema.parse(registration.confirm(token));
  });
  app.post('/api/auth/login', { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
    return loginResponseSchema.parse(
      await service.login(
        parse(loginSchema, request.body, 'Dane logowania są niepoprawne.'),
        request.ip ?? 'unknown',
        (id, now, expectedPasswordHash) => createSession(reply, request, id, now, expectedPasswordHash),
      ),
    );
  });
  app.get('/api/auth/family-members', { config: { auth: 'public' } }, async (request) => {
    return familyMembersResponseSchema.parse(
      await service.familyMembers(
        parse(familyMembersQuerySchema, request.query, 'Kod rodziny jest wymagany.').joinCode,
      ),
    );
  });
  app.post('/api/auth/login-child', { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
    return loginChildResponseSchema.parse(
      await service.loginChild(
        parse(loginChildSchema, request.body, 'Dane logowania dziecka są niepoprawne.'),
        request.ip ?? 'unknown',
        (id) => createSession(reply, request, id),
      ),
    );
  });
  app.post('/api/auth/logout', { config: { idempotency: false } }, async (request, reply) => {
    const result = authOkResponseSchema.parse(await service.logout(request.cookies?.sid));
    reply.clearCookie('sid', { path: '/' });
    return result;
  });
  app.get('/api/auth/me', async (request) => {
    return authMeResponseSchema.parse(await service.me(requireUser(request)));
  });
  app.post('/api/auth/reset-password', { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
    const result = passwordResetResponseSchema.parse(
      await service.resetPassword(
        parse(resetPasswordSchema, request.body, 'Dane resetu hasła są niepoprawne.'),
        request.cookies?.sid,
      ),
    );
    if (result.resetOwnSession) reply.clearCookie('sid', { path: '/' });
    return result;
  });
}
