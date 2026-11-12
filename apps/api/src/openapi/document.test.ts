// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateOpenApi } from './document.js';

describe('OpenAPI from registered routes', async () => {
  const document = await generateOpenApi();

  it('documents the cookie session, public routes and legacy registration', () => {
    const registration = document.paths['/api/auth/registration-requests']?.post;
    const legacy = document.paths['/api/auth/register-family']?.post;

    expect(document.security).toEqual([{ sessionCookie: [] }]);
    expect(document.components.securitySchemes.sessionCookie).toEqual({ type: 'apiKey', in: 'cookie', name: 'sid' });
    expect(registration?.security).toEqual([]);
    expect(registration?.requestBody?.content['application/json'].schema).toMatchObject({
      required: expect.arrayContaining(['email', 'acceptedTerms']),
      properties: { acceptedTerms: { const: true } },
    });
    expect(registration?.responses['202']).toBeDefined();
    expect(legacy?.deprecated).toBe(true);
    expect(legacy?.responses['202']).toBeUndefined();
    expect(legacy?.responses['409']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              error: {
                properties: {
                  code: {
                    const: 'EMAIL_CONFIRMATION_REQUIRED',
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(document.paths['/api/auth/me']?.get?.security).toBeUndefined();
    expect(document.paths['/api/auth/me']?.get?.responses['401']).toEqual({ $ref: '#/components/responses/ApiError' });
    expect(document.paths['/api/health']?.get?.responses['503']).toBeDefined();
  });

  it('uses the query schemas from idempotency profiles and the parameters from the router', () => {
    const meals = document.paths['/api/meals/to-shopping-list']?.post;
    const shopping = document.paths['/api/shopping/lists']?.post;
    const checklist = document.paths['/api/tasks/{id}/checklist/{itemId}']?.delete;
    const parentChecklist = document.paths['/api/tasks/{id}/checklist']?.get;

    expect(meals?.parameters).toMatchObject([
      { name: 'operationId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'actorId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
    ]);
    expect(shopping?.parameters).toContainEqual(expect.objectContaining({ name: 'operationId', required: false }));
    expect(checklist?.parameters.filter((parameter) => parameter.in === 'path')).toMatchObject([
      { name: 'id', required: true },
      { name: 'itemId', required: true },
    ]);
    expect(parentChecklist?.parameters.map(({ name }) => name)).toEqual(['id']);
    expect(document.paths['/api/tasks/lists/{id}/tasks']?.get?.parameters).toContainEqual(
      expect.objectContaining({
        name: 'status',
        required: false,
        schema: expect.objectContaining({ default: 'open' }),
      }),
    );
  });

  it('documents body and response shapes, including the split between offline writes and exports', () => {
    const writes = document.paths['/api/meals/offline']?.post;
    const imports = document.paths['/api/events/import']?.post;
    const events = document.paths['/api/events']?.post;
    const documents = document.paths['/api/documents']?.post;
    expect(writes?.requestBody?.content['application/json'].schema).toMatchObject({
      additionalProperties: false,
      properties: {
        type: { const: 'write' },
        expectedDays: {
          type: 'object',
          maxProperties: 7,
          additionalProperties: { type: 'array', items: { format: 'uuid' } },
        },
        writes: { type: 'array', items: { properties: { data: { anyOf: expect.any(Array) } } } },
      },
    });
    expect(documents?.requestBody?.content['application/json'].schema).toMatchObject({
      properties: { reminders: { type: 'array', maxItems: 20, items: { oneOf: expect.any(Array) } } },
    });
    expect(imports?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { properties: { results: { type: 'array' } } } } },
    });
    expect(events?.responses['201']).toBeDefined();
    expect(events?.requestBody?.content['application/json'].schema).toMatchObject({
      properties: {
        durationMinutes: {
          anyOf: expect.arrayContaining([{ type: 'integer', exclusiveMinimum: 0, maximum: 525600 }]),
        },
      },
    });
    expect(document.paths['/api/events']?.head).toBeUndefined();
    expect(document.paths['/.well-known/assetlinks.json']).toBeUndefined();
    expect(document.paths['/api/test/families']).toBeUndefined();
  });
});
