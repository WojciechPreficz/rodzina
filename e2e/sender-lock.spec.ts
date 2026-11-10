import { expect, test, type Page } from '@playwright/test';
import { readOfflineSnapshot } from './offlineDatabase.js';

async function setOnline(page: Page, online: boolean) {
  await page.evaluate((online) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  }, online);
}

async function queueTask(page: Page, title: string) {
  await setOnline(page, false);
  await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(page.getByRole('article', { name: title })).toBeVisible();
  await expect.poll(() => pendingTasks(page)).toHaveLength(1);
}

async function pendingTasks(page: Page) {
  return (await readOfflineSnapshot<{ operations: { id: string }[] }>(page, 'tasks'))?.operations;
}

for (const scenario of ['settled', 'closed', 'lost response', 'missing Web Locks'] as const) {
  test(`account sender: ${scenario}`, async ({ page, context, baseURL }, info) => {
    const response = await page.request.post('/api/test/families', {
      headers: { Origin: baseURL! },
      data: {
        familyName: 'Blokada nadawcy',
        displayName: 'Ania',
        email: `sync-${scenario.replaceAll(' ', '-')}-${info.project.name}@example.com`.toLowerCase(),
        password: 'password123',
      },
    });
    expect(response.ok()).toBe(true);
    const { family, user } = await (await page.request.get('/api/auth/me')).json();
    const lockName = `sync:${family.id}:${user.id}`;
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const apiPath = `/api/tasks/lists/${lists[0].id}/tasks`;
    const path = `/zadania/${lists[0].id}`;
    const title = 'Zadanie ze wspólnej kolejki';
    const input = (tab: Page) => tab.getByRole('textbox', { name: 'Dodaj zadanie', exact: true });
    await page.goto(path);
    await expect(input(page)).toBeEnabled();
    expect(await page.evaluate(() => isSecureContext && typeof navigator.locks?.request === 'function')).toBe(true);
    const peer = await context.newPage();
    const attempts: { tab: string; operationId: string | null }[] = [];
    if (scenario === 'missing Web Locks') {
      await queueTask(page, title);
      await page.close();
      await peer.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
      await peer.route(`**${apiPath}*`, (route) => {
        if (route.request().method() === 'POST') attempts.push({ tab: 'peer', operationId: null });
        return route.continue();
      });
      await peer.goto(path);
      await expect(peer.getByRole('alert').filter({ hasText: 'nie obsługuje bezpiecznego dostępu' })).toBeVisible();
      expect(await pendingTasks(peer)).toHaveLength(1);
      expect(attempts).toEqual([]);
      return;
    }

    await peer.goto(path);
    await expect(input(peer)).toBeEnabled();
    await setOnline(peer, false);
    let accept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      accept = resolve;
    });
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${apiPath}*`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts.push({ tab: 'first', operationId: new URL(route.request().url()).searchParams.get('operationId') });
      if (attempts.length > 1) return route.continue();
      const server = await route.fetch({ maxRetries: 0 });
      expect(server.ok()).toBe(true);
      accept();
      await responseGate;
      if (page.isClosed()) return;
      if (scenario === 'lost response') return route.abort('connectionreset');
      return route.fulfill({ response: server });
    });
    await peer.route(`**${apiPath}*`, (route) => {
      if (route.request().method() === 'POST')
        attempts.push({ tab: 'peer', operationId: new URL(route.request().url()).searchParams.get('operationId') });
      return route.continue();
    });
    try {
      await queueTask(page, title);
      const operationId = (await pendingTasks(page))![0]!.id;
      await setOnline(page, true);
      await accepted;
      await setOnline(peer, true);
      await expect
        .poll(() =>
          peer.evaluate(async (name) => {
            const { held, pending } = await navigator.locks.query();
            return {
              held: held?.filter((lock) => lock.name === name && lock.mode === 'exclusive').length,
              pending: pending?.filter((lock) => lock.name === name).length,
            };
          }, lockName),
        )
        .toEqual({ held: 1, pending: 1 });
      expect(attempts).toEqual([{ tab: 'first', operationId }]);

      if (scenario === 'closed') await page.close();
      release();
      await expect.poll(() => pendingTasks(peer), { timeout: 15000 }).toEqual([]);
      await expect(peer.getByRole('article', { name: title })).toBeVisible();
      if (scenario === 'closed') expect(attempts.map(({ tab }) => tab)).toEqual(['first', 'peer']);
      expect(attempts.map((entry) => entry.operationId)).toEqual(
        scenario === 'settled' ? [operationId] : [operationId, operationId],
      );
      const { tasks } = await (await peer.request.get(apiPath)).json();
      expect(tasks.map((task: { title: string }) => task.title)).toEqual([title]);
      expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release();
    }
  });
}
