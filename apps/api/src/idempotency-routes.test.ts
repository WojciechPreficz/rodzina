// @vitest-environment node
import type { FastifyServerOptions, RouteOptions } from 'fastify';
import { expect, it, vi } from 'vitest';
import { createTestApp } from './test-helpers.js';

const registeredRoutes: RouteOptions[] = [];

vi.mock('fastify', async (importOriginal) => {
  const fastify = await importOriginal<typeof import('fastify')>();
  return {
    ...fastify,
    default(options: FastifyServerOptions) {
      const app = fastify.default(options);
      app.addHook('onRoute', (route) => {
        registeredRoutes.push(route);
      });
      return app;
    },
  };
});

it('declares the expected idempotency policy for every API mutation', async () => {
  const { app, database } = await createTestApp();
  try {
    await app.ready();
    const mutations = registeredRoutes
      .filter(({ url }) => url === '/api' || url.startsWith('/api/'))
      .flatMap(({ method, url, config }) =>
        [method]
          .flat()
          .filter((method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
          .map((method) => [`${method} ${url}`, config?.idempotency] as const),
      );
    const expected = {
      'POST /api/auth/forgot-password': false,
      'POST /api/auth/login': false,
      'POST /api/auth/login-child': false,
      'POST /api/auth/logout': false,
      'POST /api/test/families': false,
      'POST /api/auth/register-family': false,
      'POST /api/auth/registration-requests': false,
      'POST /api/auth/confirm-registration': false,
      'POST /api/auth/reset-password': false,
      'POST /api/contact-groups': false,
      'PATCH /api/contact-groups/:id': false,
      'DELETE /api/contact-groups/:id': false,
      'POST /api/contacts': false,
      'PATCH /api/contacts/:id': false,
      'DELETE /api/contacts/:id': false,
      'POST /api/documents': false,
      'PATCH /api/documents/:id': false,
      'DELETE /api/documents/:id': false,
      'POST /api/documents/:id/renew': false,
      'POST /api/events': false,
      'PATCH /api/events/:id': false,
      'DELETE /api/events/:id': false,
      'POST /api/events/import': false,
      'PATCH /api/family': false,
      'DELETE /api/family': false,
      'POST /api/family/join-code/rotate': false,
      'POST /api/invitations': false,
      'POST /api/invitations/:token/email-verification': false,
      'POST /api/invitations/:token/accept': false,
      'PUT /api/meals/:date/:slot': false,
      'DELETE /api/meals/:date/:slot': false,
      'POST /api/meals/copy-week': false,
      'POST /api/meals/offline': 'meal-offline',
      'POST /api/meals/to-shopping-list': 'meal-export',
      'PATCH /api/members/:id': false,
      'DELETE /api/members/:id': false,
      'POST /api/members/:id/password-reset-link': false,
      'POST /api/members/child': false,
      'POST /api/reminders/mine': false,
      'DELETE /api/reminders/mine/:id': false,
      'PATCH /api/shopping/items/:id': 'shopping',
      'DELETE /api/shopping/items/:id': 'shopping',
      'POST /api/shopping/lists': 'shopping',
      'PATCH /api/shopping/lists/:id': 'shopping',
      'DELETE /api/shopping/lists/:id': 'shopping',
      'POST /api/shopping/lists/:id/clear-checked': 'shopping',
      'POST /api/shopping/lists/:id/items': 'shopping',
      'PATCH /api/tasks/:id': 'task-entity',
      'DELETE /api/tasks/:id': 'task-entity',
      'POST /api/tasks/:id/checklist': 'task-checklist',
      'PATCH /api/tasks/:id/checklist/:itemId': 'task-checklist',
      'DELETE /api/tasks/:id/checklist/:itemId': 'task-checklist',
      'PATCH /api/tasks/:id/checklist/order': 'task-checklist',
      'POST /api/tasks/:id/recurrence': 'task-recurrence',
      'POST /api/tasks/:id/skip': 'task-recurrence',
      'POST /api/tasks/lists': false,
      'PATCH /api/tasks/lists/:id': false,
      'DELETE /api/tasks/lists/:id': false,
      'POST /api/tasks/lists/:id/leave': false,
      'POST /api/tasks/lists/:id/tasks': 'task-entity',
      'PATCH /api/tasks/series/:id': 'task-series',
      'POST /api/tasks/series/:id/stop': 'task-series',
    };
    expect(mutations.sort()).toStrictEqual(Object.entries(expected).sort());
  } finally {
    await app.close();
    database.sqlite.close();
  }
});
