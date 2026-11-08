import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

test('creates a series from a new task and preserves the draft on conflict and offline', async ({
  page,
  baseURL,
}, info) => {
  const headers = { Origin: baseURL! };
  expect(
    (
      await page.request.post('/api/test/families', {
        headers,
        data: {
          familyName: 'Nowa seria',
          displayName: 'Ania',
          email: `new-series-${info.project.name}@example.com`,
          password: 'password123',
        },
      })
    ).ok(),
  ).toBe(true);
  const { lists } = await (await page.request.get('/api/tasks/lists')).json();
  const listId = lists[0].id;
  await page.goto(`/zadania/${listId}`);
  await page.getByRole('button', { name: 'Dodaj zadanie ze szczegółami', exact: true }).click();
  let form = page.getByRole('dialog', { name: 'Dodaj zadanie ze szczegółami', exact: true });
  await form.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Nowa seria');
  await form.getByRole('textbox', { name: 'Powtarzanie' }).click();
  await page.getByRole('option', { name: 'Po wykonaniu lub pominięciu', exact: true }).click();
  await form.getByLabel('Początek serii', { exact: true }).fill('2026-01-01');
  await form.getByRole('button', { name: 'Utwórz serię' }).click();
  await expect(form).toHaveCount(0);
  const snapshot = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
  expect(snapshot.tasks).toHaveLength(1);
  const seriesId = snapshot.tasks[0].recurrence.seriesId;
  await page.getByRole('link', { name: 'Nowa seria', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Edytuj zadanie', exact: true });
  await expect(form.getByRole('button', { name: 'Zapisz to i kolejne' })).toBeEnabled();
  await form.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Lokalny szkic');
  const current = await (await page.request.get(`/api/tasks/series/${seriesId}`)).json();
  expect(
    (
      await page.request.patch(`/api/tasks/series/${seriesId}?operationId=${crypto.randomUUID()}`, {
        headers,
        data: {
          rule: current.series.rule,
          template: { ...current.series.template, title: 'Z innego urządzenia' },
          expectedVersion: current.series.version,
          expectedOccurrenceVersion: current.occurrenceVersion,
        },
      })
    ).ok(),
  ).toBe(true);
  await form.getByRole('button', { name: 'Zapisz to i kolejne' }).click();
  await expect(form.getByText(/Seria lub wystąpienie zostały zmienione/)).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Tytuł', exact: true })).toHaveValue('Lokalny szkic');
  await page.context().setOffline(true);
  await expect(form.getByRole('textbox', { name: 'Powtarzanie' })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Pomiń wystąpienie' })).toBeDisabled();
  await expect(form.getByText(/Konfiguracja, pomijanie, zatrzymanie i historia wymagają połączenia/)).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Tytuł', exact: true })).toHaveValue('Lokalny szkic');
});

for (const native of [false, true])
  for (const mode of ['Według kalendarza', 'Po wykonaniu lub pominięciu']) {
    test(`recurrence UI, edit scopes and checklist template: ${mode}, ${native ? 'Android' : 'WWW'}`, async ({
      page,
      baseURL,
    }, info) => {
      test.setTimeout(90_000);
      const headers = { Origin: baseURL! };
      expect(
        (
          await page.request.post('/api/test/families', {
            headers,
            data: {
              familyName: 'Serie',
              displayName: 'Ania',
              email: `series-ui-${native}-${mode.startsWith('Według')}-${info.project.name}@example.com`,
              password: 'password123',
            },
          })
        ).ok(),
      ).toBe(true);
      const { lists } = await (await page.request.get('/api/tasks/lists')).json();
      const listId = lists[0].id;
      const { task } = await (
        await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
          headers,
          data: { title: 'Porządki serii', dueDate: '2020-01-01' },
        })
      ).json();
      const { items } = await (
        await page.request.post(`/api/tasks/${task.id}/checklist?operationId=${crypto.randomUUID()}`, {
          headers,
          data: { id: crypto.randomUUID(), title: 'Okna' },
        })
      ).json();
      if (native) await installNativeTransport(page);
      await page.goto(`/zadania/${listId}?zadanie=${task.id}`);
      const form = page.getByRole('dialog', { name: 'Edytuj zadanie' });
      const repeat = form.getByRole('region', { name: 'Powtarzaj', exact: true });
      await repeat.getByRole('textbox', { name: 'Powtarzanie' }).click();
      await page.getByRole('option', { name: mode, exact: true }).click();
      await repeat.getByLabel('Co ile', { exact: true }).fill('2');
      await repeat.getByLabel('Godzina serii (Warszawa)').fill('15:00');
      if (mode === 'Według kalendarza') await repeat.getByLabel('Wt', { exact: true }).click();
      await expect(repeat.getByRole('status')).toContainText('Termin wystąpienia:');
      await expect(repeat.getByRole('status')).toContainText('Następne po zamknięciu teraz:');
      await page.screenshot({
        path: info.outputPath(`rule-${native}-${mode.startsWith('Według')}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await repeat.getByRole('button', { name: 'Utwórz serię' }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('article', { name: 'Porządki serii' }).getByText(/Seria/)).toBeVisible();
      const snapshot = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
      const seriesId = snapshot.tasks[0].recurrence.seriesId;
      await page.getByRole('link', { name: 'Porządki serii', exact: true }).click();
      await expect(repeat.getByRole('button', { name: 'Zapisz to i kolejne' })).toBeEnabled();
      await form.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Tylko teraz');
      await form.getByRole('button', { name: 'Zapisz tylko to zadanie' }).click();
      await expect(form).toHaveCount(0);
      expect((await (await page.request.get(`/api/tasks/series/${seriesId}`)).json()).series.template.title).toBe(
        'Porządki serii',
      );
      await page.getByRole('link', { name: 'Tylko teraz', exact: true }).click();
      const checklist = form.getByRole('region', { name: 'Podzadania' });
      await checklist.getByRole('textbox', { name: 'Nowe podzadanie' }).fill('Drzwi');
      await checklist.getByRole('textbox', { name: 'Nowe podzadanie' }).press('Enter');
      await expect(checklist.getByRole('textbox', { name: 'Nowe podzadanie' })).toHaveValue('');
      await expect(checklist.getByRole('checkbox', { name: 'Drzwi', exact: true })).toBeEnabled();
      await form.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Wspólny wzorzec');
      await repeat.getByLabel('Użyj bieżącej checklisty jako wzorca kolejnych zadań').check();
      await repeat.getByRole('button', { name: 'Zapisz to i kolejne' }).click();
      await expect(form).toHaveCount(0);
      await page.getByRole('link', { name: 'Wspólny wzorzec', exact: true }).click();
      for (const title of ['Okna', 'Drzwi']) {
        const checkbox = checklist.getByRole('checkbox', { name: title, exact: true });
        await checkbox.click();
        await expect(checkbox).toBeChecked();
      }
      await expect(form.getByRole('button', { name: 'Ukończ zadanie', exact: true })).toBeEnabled();
      await form.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
      await expect(repeat.getByRole('button', { name: 'Historia serii' })).toBeEnabled();
      await repeat.getByRole('button', { name: 'Historia serii' }).click();
      await expect(repeat.getByText(/Wykonano:/)).toBeVisible();
      await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
      await expect(form).toHaveCount(0);
      const saved = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
      expect(saved.tasks).toHaveLength(2);
      const next = saved.tasks.find((entry: { isDone: boolean }) => !entry.isDone);
      expect(next.checklist.map((entry: { title: string }) => entry.title)).toEqual(['Okna', 'Drzwi']);
      expect(
        next.checklist.every((entry: { isDone: boolean; id: string }) => !entry.isDone && entry.id !== items[0].id),
      ).toBe(true);
      await expect(page.getByRole('article', { name: 'Wspólny wzorzec' }).getByText('Podzadania: 0 z 2')).toBeVisible();
      await page.getByRole('link', { name: 'Wspólny wzorzec', exact: true }).click();
      page.once('dialog', (dialog) => dialog.accept());
      await repeat.getByRole('button', { name: 'Pomiń wystąpienie' }).click();
      await expect(form).toHaveCount(0);
      await page.getByRole('link', { name: 'Wspólny wzorzec', exact: true }).click();
      await repeat.getByRole('button', { name: 'Historia serii' }).click();
      await expect(repeat.getByText(/Pominięto:/)).toBeVisible();
      page.once('dialog', (dialog) => dialog.accept());
      await repeat.getByRole('button', { name: 'Zatrzymaj serię' }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('article', { name: 'Wspólny wzorzec' }).getByText(/Seria/)).toHaveCount(0);
    });
  }
