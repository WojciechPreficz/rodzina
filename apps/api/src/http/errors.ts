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

export function registerApiErrorHandler(
  app: FastifyInstance,
  options?: { internalMessage: string; logMessage: string; primaryKeyConflictMessage?: string },
) {
  const fallback = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (
      options?.primaryKeyConflictMessage &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    )
      return sendError(reply, 409, 'OPERATION_CONFLICT', options.primaryKeyConflictMessage);
    if (!options) return fallback.call(app, error, request, reply);
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' } });
    app.log.error({ err: error }, options.logMessage);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: options.internalMessage } });
  });
}
