import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

test.use({ actionTimeout: 10000 });

for (const native of [false, true]) {
  test(`task sharing, reminders and today card through ${native ? 'Android transport' : 'the website'}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120000);
    const headers = { Origin: baseURL! };
    const registered = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Wspólne zadania',
        displayName: 'Ania',
        email: `sharing-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registered.ok()).toBe(true);
    const { family } = await registered.json();
    const child = await page.request.post('/api/members/child', {
      headers,
      data: { displayName: 'Zosia', pin: '1234', color: '#1C7ED6' },
    });
    const { member } = await child.json();
    const second = await browser.newContext({
      baseURL: baseURL!,
      viewport: info.project.use.viewport!,
      serviceWorkers: 'block',
    });
    try {
      expect(
        (
          await second.request.post('/api/auth/login-child', {
            headers,
            data: { joinCode: family.joinCode, userId: member.id, pin: '1234' },
          })
        ).ok(),
      ).toBe(true);
      const other = await second.newPage();
      if (native) {
        await installNativeTransport(page);
        await installNativeTransport(other);
      }
      await other.goto('/zadania');
      await expect(other.getByRole('link', { name: 'Moje zadania', exact: true })).toBeVisible();
      await page.goto('/zadania');
      await page.getByRole('button', { name: 'Dodaj listę', exact: true }).click();
      await page.getByLabel('Nazwa listy').fill('Remont');
      await page.getByRole('dialog').getByRole('button', { name: 'Dodaj', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Remont', exact: true })).toBeVisible();
      const listId = new URL(page.url()).pathname.split('/').at(-1)!;
      await page.getByRole('button', { name: 'Ustawienia listy' }).click();
      await page.getByLabel('Nazwa listy').fill('Wspólny remont');
      await page.getByRole('textbox', { name: 'Udostępnij domownikom' }).click();
      await page.getByRole('option', { name: 'Zosia', exact: true }).click();
      await page.getByRole('heading', { name: 'Ustawienia listy', exact: true }).click();
      await page.screenshot({ path: info.outputPath(`task-sharing-${native}.png`), fullPage: true });
      await page.getByRole('dialog').getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(other.getByRole('link', { name: 'Wspólny remont', exact: true })).toBeVisible({ timeout: 21000 });
      await other.getByRole('link', { name: 'Wspólny remont', exact: true }).click();
      await expect(other.getByRole('button', { name: 'Opuść listę' })).toBeVisible();
      await expect(other.getByRole('button', { name: 'Ustawienia listy' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Dodaj zadanie ze szczegółami' }).click();
      const form = page.getByRole('dialog');
      await form.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Wybrać prywatne płytki');
      await form.getByLabel('Termin', { exact: true }).fill('2030-10-22');
      await form.getByRole('textbox', { name: 'Osoba przypisana' }).click();
      await page.getByRole('option', { name: 'Zosia', exact: true }).click();
      await form.getByRole('button', { name: 'Dodaj przypomnienie' }).click();
      await form.getByRole('textbox', { name: 'Odbiorcy' }).click();
      await expect(page.getByRole('option', { name: 'Cała rodzina', exact: true })).toHaveCount(0);
      await page.getByRole('option', { name: 'Wszyscy na liście' }).click();
      await form.getByRole('textbox', { name: 'Kiedy przypomnieć' }).click();
      await page.getByRole('option', { name: '1 dzień przed', exact: true }).click();
      await form.getByRole('button', { name: 'Dodaj przypomnienie' }).click();
      await form.getByRole('textbox', { name: 'Odbiorcy' }).click();
      await page.getByRole('option', { name: 'Tylko ja' }).click();
      await form.getByRole('button', { name: 'Dodaj przypomnienie' }).click();
      await page.screenshot({ path: info.outputPath(`task-reminders-${native}.png`), fullPage: true });
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(form).toHaveCount(0);
      const { tasks } = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].reminders.map((reminder: { audience: string }) => reminder.audience).sort()).toEqual([
        'list_members',
        'owner',
      ]);
      const mine = await (await page.request.get(`/api/reminders/mine?taskId=${tasks[0].id}`)).json();
      expect(mine.reminders).toHaveLength(1);
      expect((await (await second.request.get(`/api/reminders/mine?taskId=${tasks[0].id}`)).json()).reminders).toEqual(
        [],
      );
      await page.getByRole('article', { name: 'Wybrać prywatne płytki' }).getByRole('link').click();
      await expect(form.getByText(/W dniu terminu · Osoba przypisana/)).toBeVisible();
      await expect(form.getByText(/1 dzień przed · Tylko ja/)).toBeVisible();
      await form.getByRole('button', { name: 'Usuń przypomnienie', exact: true }).last().click();
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(form).toHaveCount(0);
      expect((await (await page.request.get(`/api/reminders/mine?taskId=${tasks[0].id}`)).json()).reminders).toEqual(
        [],
      );

      const due = await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
        headers,
        data: { title: 'Odebrać zamówienie', dueDate: '2020-01-02' },
      });
      const { task } = await due.json();
      await page.goto('/');
      const card = page.getByRole('region', { name: 'Dziś do zrobienia' });
      await expect(card.getByRole('link', { name: 'Odebrać zamówienie' })).toHaveAttribute(
        'href',
        `/zadania/${listId}?zadanie=${task.id}`,
      );
      await expect(card).toContainText('po terminie');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`task-today-${native}.png`), fullPage: true });
      await card.getByRole('link', { name: 'Odebrać zamówienie' }).click();
      await expect(page.getByRole('textbox', { name: 'Tytuł', exact: true })).toHaveValue('Odebrać zamówienie');
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();

      await expect(other.getByRole('article', { name: 'Wybrać prywatne płytki' })).toBeVisible({ timeout: 21000 });
      await other.getByRole('article', { name: 'Wybrać prywatne płytki' }).getByRole('link').click();
      await expect(other.getByRole('textbox', { name: 'Tytuł', exact: true })).toHaveValue('Wybrać prywatne płytki');
      await page.getByRole('button', { name: 'Ustawienia listy' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cofnij udostępnienie wszystkim' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(other.getByRole('link', { name: 'Wspólny remont', exact: true, includeHidden: true })).toHaveCount(
        0,
        { timeout: 21000 },
      );
      await expect(other.getByRole('dialog')).toHaveCount(0);
      await expect(other.getByText('Wybrać prywatne płytki', { exact: true })).toHaveCount(0);

      // Re-share and exercise the member's leave action, then owner deletion.
      await page.getByRole('button', { name: 'Ustawienia listy' }).click();
      await page.getByRole('textbox', { name: 'Udostępnij domownikom' }).click();
      await page.getByRole('option', { name: 'Zosia', exact: true }).click();
      await page.getByRole('heading', { name: 'Ustawienia listy', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(other.getByRole('dialog')).toBeVisible({ timeout: 21000 });
      await other.getByRole('dialog').getByRole('button', { name: 'Anuluj', exact: true }).click();
      await expect(other.getByRole('button', { name: 'Opuść listę' })).toBeVisible({ timeout: 21000 });
      other.once('dialog', (dialog) => dialog.accept());
      await other.getByRole('button', { name: 'Opuść listę' }).click();
      await expect(other).toHaveURL(/\/zadania$/);
      await page.getByRole('button', { name: 'Ustawienia listy' }).click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Usuń listę', exact: true }).click();
      await expect(page).toHaveURL(/\/zadania$/);
    } finally {
      await second.close();
    }
  });
}
