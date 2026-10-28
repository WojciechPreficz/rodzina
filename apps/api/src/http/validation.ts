import type { z } from 'zod';
import { ApiError } from './errors.js';

export function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
  message = 'Dane żądania są niepoprawne.',
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', message);
  return result.data;
}
