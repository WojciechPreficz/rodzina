import { routeOptions } from '../../http/route-contract.js';
import { parse } from '../../http/validation.js';
import {
  registerFamilySchema,
  registrationTermsSchema,
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
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { createAuthService } from './service.js';
import { createSessionFactory } from './session.js';
import { createPasswordRecovery, RecoveryRateLimitError } from './password-recovery.js';
import type { sendResetMail } from './reset-mail.js';
import type { sendRegistrationMail } from './registration-mail.js';
import { createRegistration, RegistrationRateLimitError } from './registration.js';
import { ApiError, apiErrorSchema } from '../../http/errors.js';
import { AuthRateLimitError } from './rate-limit-service.js';

const registrationRequestSchema = registerFamilySchema.merge(registrationTermsSchema);
const registrationConfirmationRequired = 'EMAIL_CONFIRMATION_REQUIRED';
const registrationConfirmationRequiredSchema = apiErrorSchema.extend({
  error: apiErrorSchema.shape.error.extend({ code: z.literal(registrationConfirmationRequired) }),
});

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
  app.get(
    '/api/auth/password-recovery',
    routeOptions({ responses: { 200: passwordRecoveryAvailabilitySchema } }, { auth: 'public' }),
    async () => passwordRecoveryAvailabilitySchema.parse({ enabled: config.RODZINA_PASSWORD_RESET_EMAIL_ENABLED }),
  );
  app.post(
    '/api/auth/forgot-password',
    routeOptions(
      { body: forgotPasswordInputSchema, responses: { 202: authOkResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      try {
        const email = parse(forgotPasswordInputSchema, request.body, 'Podaj poprawny adres e-mail.').email;
        return reply.code(202).send(authOkResponseSchema.parse(await recoverPassword(email, request.ip)));
      } catch (error) {
        if (error instanceof RecoveryRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    },
  );
  const registrationUrl = new URL('/register', config.RODZINA_PUBLIC_URL).href;
  for (const url of ['/api/auth/registration-requests', '/api/auth/register-family']) {
    const legacyRegistration = url === '/api/auth/register-family';
    app.post(
      url,
      routeOptions(
        {
          body: registrationRequestSchema,
          deprecated: legacyRegistration,
          responses: legacyRegistration
            ? { 409: registrationConfirmationRequiredSchema }
            : { 202: registrationRequestResponseSchema },
        },
        { auth: 'public', idempotency: false },
      ),
      async (request, reply) => {
        try {
          const data = parse(registerFamilySchema, request.body, 'Dane rejestracji są niepoprawne.');
          parse(
            registrationTermsSchema,
            request.body,
            `Zaakceptuj regulamin, aby założyć rodzinę. Jeśli aplikacja nie ma pola akceptacji, otwórz ${registrationUrl} w przeglądarce.`,
          );
          const result = await registration.request(data, request.ip);
          // Older APKs expect a session on success. Their error UI can display the next step safely.
          if (legacyRegistration)
            throw new ApiError(
              409,
              registrationConfirmationRequired,
              'Sprawdź pocztę i potwierdź założenie rodziny linkiem w wiadomości. Konto powstanie po potwierdzeniu. Następnie zaloguj się w aplikacji.',
            );
          return reply.code(202).send(registrationRequestResponseSchema.parse(result));
        } catch (error) {
          if (error instanceof RegistrationRateLimitError) reply.header('Retry-After', error.retryAfter);
          throw error;
        }
      },
    );
  }
  app.post(
    '/api/auth/confirm-registration',
    routeOptions(
      { body: confirmRegistrationInputSchema, responses: { 200: authOkResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request) => {
      const { token } = parse(confirmRegistrationInputSchema, request.body, 'Link potwierdzenia jest nieprawidłowy.');
      return authOkResponseSchema.parse(registration.confirm(token));
    },
  );
  app.post(
    '/api/auth/login',
    routeOptions(
      { body: loginSchema, responses: { 200: loginResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      return loginResponseSchema.parse(
        await service.login(
          parse(loginSchema, request.body, 'Dane logowania są niepoprawne.'),
          request.ip ?? 'unknown',
          (id, now, credential) => createSession(reply, request, id, now, credential),
        ),
      );
    },
  );
  app.get(
    '/api/auth/family-members',
    routeOptions(
      { query: familyMembersQuerySchema, responses: { 200: familyMembersResponseSchema } },
      { auth: 'public' },
    ),
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return familyMembersResponseSchema.parse(
          service.familyMembers(
            parse(familyMembersQuerySchema, request.query, 'Kod rodziny jest wymagany.').joinCode,
            request.ip,
          ),
        );
      } catch (error) {
        if (error instanceof AuthRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    },
  );
  app.post(
    '/api/auth/login-child',
    routeOptions(
      { body: loginChildSchema, responses: { 200: loginChildResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      try {
        return loginChildResponseSchema.parse(
          await service.loginChild(
            parse(loginChildSchema, request.body, 'Dane logowania dziecka są niepoprawne.'),
            request.ip,
            (id, now, credential) => createSession(reply, request, id, now, credential),
          ),
        );
      } catch (error) {
        if (error instanceof AuthRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    },
  );
  app.post(
    '/api/auth/logout',
    routeOptions({ responses: { 200: authOkResponseSchema } }, { idempotency: false }),
    async (request, reply) => {
      const result = authOkResponseSchema.parse(await service.logout(request.cookies?.sid));
      reply.clearCookie('sid', { path: '/' });
      return result;
    },
  );
  app.get('/api/auth/me', routeOptions({ responses: { 200: authMeResponseSchema } }), async (request) => {
    return authMeResponseSchema.parse(await service.me(requireUser(request)));
  });
  app.post(
    '/api/auth/reset-password',
    routeOptions(
      { body: resetPasswordSchema, responses: { 200: passwordResetResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      const result = passwordResetResponseSchema.parse(
        await service.resetPassword(
          parse(resetPasswordSchema, request.body, 'Dane resetu hasła są niepoprawne.'),
          request.cookies?.sid,
        ),
      );
      if (result.resetOwnSession) reply.clearCookie('sid', { path: '/' });
      return result;
    },
  );
}
