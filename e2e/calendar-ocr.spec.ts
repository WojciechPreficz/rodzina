import { expect, test, type Page } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

async function poster(page: Page, blank = false) {
  const encoded = await page.evaluate((empty) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 900;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!empty) {
      context.fillStyle = 'black';
      context.font = 'bold 64px Arial';
      context.fillText('Koncert rodzinny', 90, 170);
      context.font = '48px Arial';
      context.fillText('12 listopada 2026', 90, 270);
      context.fillText('godz. 18:30', 90, 360);
      context.fillText('Miejsce: Dom Kultury', 90, 450);
    }
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, blank);
  return { name: 'plakat.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

async function complexPoster(page: Page, layout: 'grid' | 'ticket' | 'graphic' | 'registration') {
  const encoded = await page.evaluate((kind) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 56px Arial';
    if (kind === 'grid') {
      context.fillText('PAŹDZIERNIK', 700, 100);
      for (const [index, day] of [2, 6, 7, 9, 16, 21, 23, 30].entries()) {
        const x = 50 + (index % 4) * 490;
        const y = 220 + Math.floor(index / 4) * 580 + (index % 4) * 20;
        context.fillStyle = '#eee3ce';
        context.fillRect(x - 20, y - 60, 460, 480);
        context.fillStyle = '#111111';
        context.font = 'bold 38px Arial';
        context.fillText(`${day}.10.2026 R.`, x + 30, y);
        context.fillText('WARSZTATY', x + 30, y + 90);
        context.fillText(`RODZINNE ${index + 1}`, x + 30, y + 150);
        context.fillText('10 ZŁ', x + 140, y + 350);
      }
    } else if (kind === 'ticket') {
      context.font = '22px Arial';
      context.fillText('AGENCJA ARTYSTYCZNA', 150, 200);
      context.font = 'bold 58px Arial';
      context.fillText('ARKA NOEGO - KONCERT KOLĘD', 150, 400);
      context.font = '26px Arial';
      context.fillText('DATA, GODZINA I MIEJSCE', 150, 700);
      context.font = '40px Arial';
      context.fillText('10.01.2027, godz. 11:00', 150, 780);
      context.fillText('Katowice, Pałac Młodzieży, ul. Mikołowska 26', 150, 850);
      context.fillText('SEKTOR', 150, 1050);
      context.fillText('parter', 150, 1120);
      context.fillText('CENA', 1400, 1050);
      context.fillText('110,00 zł', 1400, 1120);
    } else if (kind === 'registration') {
      context.font = 'bold 58px Arial';
      context.fillText('WARSZTATY RODZINNE', 160, 250);
      context.font = '48px Arial';
      context.fillText('Wydarzenie: 12 listopada godz. 18:30', 160, 450);
      context.fillText('Zapisy do 5 listopada', 160, 600);
    } else {
      context.font = '80px Arial';
      context.fillText('V', 1700, 100);
      context.fillText('21.10.2026 R.', 250, 450);
      context.font = 'bold 110px Arial';
      context.fillText('DOGOTERAPIA', 250, 650);
      context.font = '80px Arial';
      context.fillText('10 ZŁ', 600, 1000);
    }
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, layout);
  return { name: `${layout}.png`, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

test.beforeEach(async ({ page, baseURL }, info) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'OCR',
      displayName: 'Anna',
      email: `ocr-${info.testId}-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  await page.goto('/kalendarz');
  await page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true }).click();
});

test('recognizes a real poster using local production WASM and Polish model', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  const external: string[] = [];
  const writes: string[] = [];
  const violations: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== baseURL) external.push(request.url());
    if (request.method() === 'POST') writes.push(request.url());
  });
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.getByLabel('Wybierz zdjęcie', { exact: true }).setInputFiles(await poster(page));
  await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'Koncert rodzinny', exact: true })).toBeVisible();
  const proposal = page
    .locator('.mantine-Card-root')
    .filter({ has: page.getByRole('heading', { name: 'Koncert rodzinny', exact: true }) });
  await expect(proposal.getByText('Data: 2026-11-12', { exact: true })).toBeVisible();
  await expect(proposal.getByText('Godzina: 18:30', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Propozycje: 1.');
  await expect(page.getByText('Tekst źródłowy', { exact: true })).toHaveCount(0);
  await expect(page.getByAltText('Podgląd wybranego zdjęcia')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zapisz', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(writes).toEqual([]);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ocr-preview.png'), fullPage: true });
  await approveAndSave(page);
  expect(writes).toEqual([`${baseURL}/api/events/import`]);
  expect(external).toEqual([]);
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true })).toBeVisible();
  await page.locator('.family-calendar').getByLabel('Wybierz datę').fill('2026-11-12');
  await expect(page.getByText('Koncert po korekcie', { exact: true }).first()).toBeVisible();
  const occurrences = await page.request.get('/api/occurrences?from=2026-11-01&to=2026-11-30');
  expect((await occurrences.json()).occurrences).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Koncert po korekcie' })]),
  );
  await page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj ręcznie propozycję' })).toBeEnabled();
  await expect(page.locator('.mantine-Card-root')).toHaveCount(0);
  await expect(page.getByAltText('Podgląd wybranego zdjęcia')).toHaveCount(0);
  await expect(page.getByText('Zapisane: 0. Wymagają poprawy: 0. Nieznany wynik: 0.')).toBeVisible();
});

test('replaces proposals immediately when another photo is selected', async ({ page }) => {
  const input = page.getByLabel('Wybierz zdjęcie', { exact: true });
  await input.setInputFiles(await poster(page));
  await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Zatwierdź propozycję', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Wybierz do zapisu: Koncert rodzinny' })).toBeChecked();
  await input.setInputFiles(await complexPoster(page, 'graphic'));
  await expect(page.getByRole('heading', { name: 'Koncert rodzinny', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'DOGOTERAPIA', exact: true })).toBeVisible();
  await expect(page.locator('.mantine-Card-root')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Zapisz wybrane (0/20)' })).toBeDisabled();
});

test('handles invalid files, empty OCR, cancellation and resource errors', async ({ page }) => {
  test.setTimeout(120_000);
  const input = page.getByLabel('Wybierz zdjęcie', { exact: true });
  await input.setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') });
  await expect(page.getByRole('alert').filter({ hasText: 'Wybierz zdjęcie JPEG' })).toBeVisible();
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert').filter({ hasText: 'Plik jest uszkodzony' })).toBeVisible();
  await input.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert').filter({ hasText: 'przekracza limit 20 MB' })).toBeVisible();
  await input.setInputFiles(await poster(page, true));
  await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
  await expect(page.getByText('Nie rozpoznano propozycji wydarzeń.', { exact: false })).toBeVisible();
  await page.route('**/ocr/**/worker.min.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {};' }),
  );
  await input.setInputFiles(await poster(page));
  await page.getByRole('button', { name: 'Anuluj odczyt', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Odczyt anulowany');
  await expect(page.getByAltText('Podgląd wybranego zdjęcia')).toHaveCount(0);
  await page.unroute('**/ocr/**/worker.min.js');
  await page.route('**/ocr/**/worker.min.js', (route) => route.abort());
  await input.setInputFiles(await poster(page));
  await expect(page.getByRole('alert').filter({ hasText: 'Nie udało się uruchomić odczytu' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true })).toBeVisible();
});

test('keeps a repeated fair range inclusive and displays opening hours separately', async ({ page }) => {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1600, 1000);
    context.fillStyle = 'black';
    context.font = 'bold 56px Arial';
    context.fillText('TARGI PIWOWARSKIE', 400, 200);
    context.font = '48px Arial';
    context.fillText('12-14 MARCA 2024', 450, 400);
    context.font = '32px Arial';
    context.fillText('GODZINY OTWARCIA:', 60, 700);
    context.fillText('12-14 marca 2024', 60, 770);
    context.fillText('10:00 - 17:00', 60, 840);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page
    .getByLabel('Wybierz zdjęcie', { exact: true })
    .setInputFiles({ name: 'range.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
  const cards = page.locator('.mantine-Card-root');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Data: 2024-03-12 – 2024-03-14 (włącznie)');
  await expect(cards).toContainText('Godziny otwarcia: 10:00–17:00');
});

for (const layout of ['grid', 'ticket', 'graphic', 'registration'] as const) {
  test(`recognizes ${layout} layout without turning graphics, prices or metadata into events`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.getByLabel('Wybierz zdjęcie', { exact: true }).setInputFiles(await complexPoster(page, layout));
    await expect(page.getByRole('status')).toContainText('Odczyt zakończony', { timeout: 90_000 });
    const cards = page.locator('.mantine-Card-root');
    await expect(cards).toHaveCount(layout === 'grid' ? 8 : 1);
    if (layout === 'grid') {
      for (const [index, day] of [2, 6, 7, 9, 16, 21, 23, 30].entries()) {
        await expect(cards.nth(index).getByRole('heading')).toHaveText(`WARSZTATY RODZINNE ${index + 1}`);
        await expect(cards.nth(index)).toContainText(`Data: 2026-10-${String(day).padStart(2, '0')}`);
        await expect(cards.nth(index)).toContainText('Nie rozpoznano godziny');
      }
    } else if (layout === 'ticket') {
      await expect(cards.getByRole('heading')).toHaveText('ARKA NOEGO - KONCERT KOLĘD');
      await expect(cards).toContainText('Data: 2027-01-10');
      await expect(cards).toContainText('Godzina: 11:00');
      await expect(cards).toContainText('Miejsce: Katowice, Pałac Młodzieży, ul. Mikołowska 26');
    } else if (layout === 'registration') {
      await expect(cards).toContainText('Brakuje roku.');
      await expect(cards).toContainText('Fragment zawiera termin zapisów.');
    } else {
      await expect(cards.getByRole('heading')).toHaveText('DOGOTERAPIA');
      await expect(cards).toContainText('Data: 2026-10-21');
      await expect(cards).toContainText('Nie rozpoznano godziny');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ocr-${layout}.png`), fullPage: true });
    if (layout === 'registration') await approveAndSave(page);
    else await approveRecognizedAndSave(page, layout === 'ticket' ? '11:00' : null);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

async function approveAndSave(page: Page) {
  const edit = page.getByRole('button', { name: 'Popraw i zatwierdź', exact: true }).first();
  await edit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('textbox', { name: 'Tytuł', exact: false }).fill('Koncert po korekcie');
  const date = dialog.getByLabel('Data', { exact: false }).first();
  if (!(await date.inputValue())) await date.fill('2026-11-12');
  const time = dialog.locator('input[type="time"]').first();
  if ((await time.count()) && !(await time.inputValue()))
    await dialog.getByRole('switch', { name: 'Bez godziny', exact: true }).check();
  await dialog.getByRole('button', { name: 'Zatwierdź do paczki' }).click();
  await expect(dialog).toHaveCount(0);
  const selected = page.getByRole('checkbox', { name: 'Wybierz do zapisu: Koncert po korekcie' });
  await expect(selected).not.toBeChecked();
  await selected.focus();
  await page.keyboard.press('Space');
  const request = page.waitForRequest('**/api/events/import');
  await page.getByRole('button', { name: 'Zapisz wybrane (1/20)' }).click();
  const body = (await request).postDataJSON();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].event.participantIds).toEqual([]);
  expect(body.items[0].event.reminders ?? []).toEqual([]);
  expect(Object.keys(body.items[0]).sort()).toEqual(['duplicateResolution', 'event', 'operationId']);
  await expect(page.getByText('Zapisano w kalendarzu.', { exact: true })).toBeVisible();
}

async function approveRecognizedAndSave(page: Page, expectedTime: string | null) {
  const card = page.locator('.mantine-Card-root').first();
  const title = (await card.getByRole('heading').innerText()).trim();
  if (!expectedTime) {
    await expect(card.getByRole('alert').filter({ hasText: 'Nie rozpoznano godziny' })).toHaveText(
      'Nie rozpoznano godziny',
    );
    await expect(card.getByText('Godzina: wymaga potwierdzenia', { exact: true })).toHaveCount(0);
  }
  await card.getByRole('button', { name: 'Zatwierdź propozycję', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card.getByRole('checkbox', { name: `Wybierz do zapisu: ${title}` })).toBeChecked();
  const request = page.waitForRequest('**/api/events/import');
  await page.getByRole('button', { name: 'Zapisz wybrane (1/20)' }).click();
  const data = (await request).postDataJSON().items[0].event;
  expect(data.startTime).toBe(expectedTime);
  expect(data.participantIds).toEqual([]);
  await expect(card.getByText('Zapisano w kalendarzu.', { exact: true })).toBeVisible();
}

async function manualProposal(page: Page, title: string) {
  await page.getByRole('button', { name: 'Dodaj ręcznie propozycję' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tytuł', { exact: false }).fill(title);
  await dialog.locator('input[type="date"]').fill('2026-11-12');
  await dialog.getByRole('switch', { name: 'Bez godziny', exact: true }).check();
  await dialog.getByRole('button', { name: 'Zatwierdź do paczki' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('checkbox', { name: `Wybierz do zapisu: ${title}` }).check();
}

test('preserves partial results through lost response, restart and explicit retry', async ({ page }, info) => {
  await manualProposal(page, 'Pierwsze wydarzenie');
  await manualProposal(page, 'Drugie wydarzenie');
  const sent: string[] = [];
  await page.route('**/api/events/import', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(route.request().postData()!);
    body.items[1].event.title = '';
    // The server commits the valid item, but its response is lost.
    await route.fetch({ postData: JSON.stringify(body) });
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Zapisz wybrane (2/20)' }).dblclick();
  await expect(page.getByText(/Nie udało się zakończyć zapisu/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Popraw propozycję' }).first()).toBeDisabled();
  expect(sent).toHaveLength(1);
  await page.unroute('**/api/events/import');
  await page.reload();
  await expect(page.getByAltText('Podgląd wybranego zdjęcia')).toHaveCount(0);
  await page.route('**/api/events/import', async (route) => {
    sent.push(route.request().postData()!);
    const body = route.request().postDataJSON();
    body.items[1].event.title = '';
    await route.fulfill({ response: await route.fetch({ postData: JSON.stringify(body) }) });
  });
  await page.getByRole('button', { name: 'Ponów nieznane wyniki (2)' }).click();
  await expect(page.getByText('Już zapisano wcześniej — bez duplikatu.')).toBeVisible();
  await expect(page.getByText(/Wymaga poprawy:/)).toBeVisible();
  expect(sent[1]).toBe(sent[0]);
  await page.unroute('**/api/events/import');
  await page.getByRole('button', { name: 'Popraw propozycję' }).filter({ visible: true }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tytuł', { exact: false }).fill('Poprawione drugie');
  await dialog.getByRole('button', { name: 'Zatwierdź do paczki' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Wybierz do zapisu: Poprawione drugie' }).check();
  const request = page.waitForRequest('**/api/events/import');
  await page.getByRole('button', { name: 'Zapisz wybrane (1/20)' }).click();
  expect((await request).postDataJSON().items[0].operationId).not.toBe(JSON.parse(sent[0]!).items[1].operationId);
  await expect(page.getByText('Zapisano w kalendarzu.', { exact: true })).toBeVisible();
  const response = await page.request.get('/api/occurrences?from=2026-11-01&to=2026-11-30');
  const events = (await response.json()).occurrences;
  expect(events.map((event: { title: string }) => event.title).sort()).toEqual([
    'Pierwsze wydarzenie',
    'Poprawione drugie',
  ]);
  await page.screenshot({ path: info.outputPath('ocr-import-results.png'), fullPage: true });
});

test('blocks sending when durable storage fails and warns before discarding drafts', async ({ page }) => {
  await manualProposal(page, 'Niezapisane');
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/events/import')) writes++;
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      if (this.name === 'metadata' && value.key === 'calendar-photo-import:1')
        throw new DOMException('Pełna pamięć', 'QuotaExceededError');
      return put.call(this, value, ...rest);
    };
  });
  await page.getByRole('button', { name: 'Zapisz wybrane (1/20)' }).click();
  await expect(page.getByText(/Pełna pamięć/)).toBeVisible();
  expect(writes).toBe(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Wybierz do zapisu: Niezapisane' })).toBeChecked();
  let confirmations = 0;
  page.on('dialog', async (dialog) => {
    confirmations++;
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
});

test('keeps the existing Android calendar form compatible', async ({ page }) => {
  await installNativeTransport(page);
  await page.reload();
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
  await form.getByLabel(/^Tytuł/).fill('Regresja wspólnego formularza APK');
  await form.locator('input[type="date"]').fill('2026-11-12');
  const request = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST',
  );
  await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
  expect((await request).ok()).toBe(true);
  await expect(form).toHaveCount(0);
});

test('uses native OCR offline then the shared approval and online import in Android', async ({ page }, info) => {
  await installNativeTransport(page);
  await page.addInitScript(() => {
    const bridge = (window as unknown as { Capacitor: { nativePromise: (...args: unknown[]) => Promise<unknown> } })
      .Capacitor;
    const original = bridge.nativePromise;
    bridge.nativePromise = async (...args: unknown[]) => {
      if (args[0] !== 'RodzinaOcr') return original(...args);
      if (args[1] === 'cancel') return {};
      if (localStorage.getItem('test:ocr-cancel') === 'yes') return { cancelled: true };
      return {
        document: {
          image: { width: 1400, height: 900 },
          lines: [
            { id: '1', text: 'Koncert rodzlnny', confidence: 60, box: { x: 0.1, y: 0.1, width: 0.7, height: 0.05 } },
            { id: '2', text: '12 listopada 2026 godz. 18:30', box: { x: 0.1, y: 0.2, width: 0.7, height: 0.05 } },
          ],
        },
        alternateDocument: {
          image: { width: 2800, height: 1800 },
          lines: [
            { id: '1', text: 'Koncert rodzinny', confidence: 95, box: { x: 0.1, y: 0.1, width: 0.7, height: 0.05 } },
            { id: '2', text: '12 listopada 2026 godz. 18:30', box: { x: 0.1, y: 0.2, width: 0.7, height: 0.05 } },
          ],
        },
      };
    };
  });
  await page.reload();
  // Let the reloaded app restore its session before switching connectivity.
  await expect(page.getByRole('button', { name: 'Wybierz zdjęcie', exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('test:offline', 'yes');
    localStorage.setItem('test:ocr-cancel', 'yes');
    dispatchEvent(new Event('offline'));
  });
  await page.getByRole('button', { name: 'Wybierz zdjęcie', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Wybór anulowany');
  await page.evaluate(() => localStorage.removeItem('test:ocr-cancel'));
  await page.getByRole('button', { name: 'Wybierz zdjęcie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Koncert rodzinny', exact: true })).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zapisz wybrane (0/20)' })).toBeDisabled();
  await page.evaluate(() => {
    localStorage.removeItem('test:offline');
    dispatchEvent(new Event('online'));
  });
  await approveAndSave(page);
  await page.screenshot({ path: info.outputPath('native-photo-import.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await page.locator('.family-calendar').getByLabel('Wybierz datę').fill('2026-11-12');
  await expect(page.getByText('Koncert po korekcie', { exact: true }).first()).toBeVisible();
});
