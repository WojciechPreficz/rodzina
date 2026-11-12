import type { RouteOptions } from 'fastify';
import { z } from 'zod';
import { apiVersion, buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { apiErrorSchema } from '../http/errors.js';
import type { RouteContract } from '../http/route-contract.js';

type JsonSchema = Record<string, unknown>;
type Response = { $ref: string } | { description: string; content: { 'application/json': { schema: JsonSchema } } };

function toSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { io });
  delete json.$schema;
  return json;
}

function parameters(schema: z.ZodTypeAny | undefined, location: 'path' | 'query', names?: string[]) {
  const converted = schema && toSchema(schema, 'input');
  const properties = (converted?.properties ?? {}) as Record<string, JsonSchema>;
  const required = (converted?.required ?? []) as string[];

  return (names ?? Object.keys(properties)).map((name) => {
    const field = properties[name];
    if (!field) throw new Error(`Missing ${location} parameter schema for "${name}"`);
    return { name, in: location, required: location === 'path' || required.includes(name), schema: field };
  });
}

const statusDescriptions: Record<number, string> = {
  200: 'Żądanie obsłużone.',
  201: 'Zasób utworzony.',
  202: 'Żądanie przyjęte.',
  409: 'Konflikt.',
  503: 'Usługa niedostępna.',
};

function operation(route: RouteOptions, contract: RouteContract, pathParams: string[]) {
  const isPublic = route.config?.auth === 'public';
  const responses: Record<string, Response> = Object.fromEntries(
    Object.entries(contract.responses).map(([status, schema]) => [
      status,
      {
        description: statusDescriptions[Number(status)] ?? 'Odpowiedź API.',
        content: { 'application/json': { schema: toSchema(schema) } },
      },
    ]),
  );
  const errorResponse = { $ref: '#/components/responses/ApiError' };
  if (!isPublic) responses['401'] ??= errorResponse;
  responses['429'] ??= { $ref: '#/components/responses/RateLimited' };
  responses.default = errorResponse;
  return {
    tags: [route.url.split('/')[2] ?? 'api'],
    description: contract.description,
    deprecated: contract.deprecated || undefined,
    ...(isPublic && { security: [] }),
    parameters: [...parameters(contract.params, 'path', pathParams), ...parameters(contract.query, 'query')],
    ...(contract.body && {
      requestBody: { required: true, content: { 'application/json': { schema: toSchema(contract.body, 'input') } } },
    }),
    responses,
  };
}

export async function generateOpenApi() {
  const routes: RouteOptions[] = [];
  const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
  const database = createDatabase(config);
  try {
    const app = await buildApp(config, database, undefined, undefined, (route) => {
      routes.push(route);
    });
    try {
      await app.ready();
    } finally {
      await app.close();
    }
  } finally {
    database.sqlite.close();
  }

  const paths: Record<string, Record<string, ReturnType<typeof operation>>> = {};
  for (const route of routes) {
    if (route.url !== '/api' && !route.url.startsWith('/api/')) continue;
    // Fastify registers HEAD automatically alongside GET.
    const methods = [route.method].flat().filter((method) => method !== 'HEAD');
    if (!methods.length) continue;
    const contract = route.config?.contract;
    if (!contract || !Object.keys(contract.responses).length)
      throw new Error(`Missing OpenAPI contract for ${methods.join(', ')} ${route.url}`);

    const pathParams = [...route.url.matchAll(/:([a-zA-Z0-9_]+)/g)].map(([, name]) => name!);
    const path = route.url.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    const item = (paths[path] ??= {});
    for (const method of methods) {
      const key = method.toLowerCase();
      if (item[key]) throw new Error(`Duplicate OpenAPI operation for ${method} ${path}`);
      item[key] = operation(route, contract, pathParams);
    }
  }

  const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } };
  return {
    openapi: '3.1.1',
    info: {
      title: 'Rodzina API',
      version: apiVersion,
      description:
        'Kontrakty tras Fastify i schematów Zod. Dodatkowe warunki sprawdzają reguły domenowe oraz walidacja Zod w czasie obsługi żądania.',
    },
    security: [{ sessionCookie: [] }],
    paths: Object.fromEntries(
      Object.keys(paths)
        .sort()
        .map((path) => [path, paths[path]!]),
    ),
    components: {
      schemas: { ApiError: toSchema(apiErrorSchema) },
      securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'sid' } },
      responses: {
        ApiError: { description: 'Błąd API z kodem i komunikatem.', content: errorContent },
        RateLimited: {
          description: 'Przekroczono limit żądań.',
          headers: { 'Retry-After': { description: 'Czas do ponowienia w sekundach.', schema: { type: 'integer' } } },
          content: errorContent,
        },
      },
    },
  };
}
