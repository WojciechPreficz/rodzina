import type { FastifyContextConfig } from 'fastify';
import type { z } from 'zod';

export interface RouteContract {
  params?: z.ZodTypeAny | undefined;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  responses: Record<number, z.ZodTypeAny>;
  description?: string;
  deprecated?: boolean;
}

export function routeOptions(contract: RouteContract, config?: FastifyContextConfig): { config: FastifyContextConfig } {
  return { config: { ...config, contract } };
}

declare module 'fastify' {
  interface FastifyContextConfig {
    contract?: RouteContract;
  }
}
