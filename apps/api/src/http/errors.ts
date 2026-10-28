import type { FastifyInstance, FastifyReply } from 'fastify';

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

declare module 'fastify' {
  interface FastifyContextConfig {
    primaryKeyConflictMessage?: string;
  }
}

const clientErrors: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' },
  401: { code: 'UNAUTHORIZED', message: 'Brak aktywnej sesji.' },
  403: { code: 'FORBIDDEN', message: 'Brak uprawnień do wykonania tej operacji.' },
  404: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Dane żądania są zbyt duże.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Nieobsługiwany typ danych żądania.' },
  429: { code: 'RATE_LIMITED', message: 'Zbyt wiele żądań. Spróbuj ponownie później.' },
};

export function registerApiErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (
      request.routeOptions.config.primaryKeyConflictMessage &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    )
      return sendError(reply, 409, 'OPERATION_CONFLICT', request.routeOptions.config.primaryKeyConflictMessage);
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      const { code, message } = clientErrors[error.statusCode] ?? {
        code: 'HTTP_ERROR',
        message: 'Nie udało się obsłużyć żądania.',
      };
      return sendError(reply, error.statusCode, code, message);
    }
    app.log.error({ err: error }, 'API request failed');
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie udało się obsłużyć żądania.');
  });
}
