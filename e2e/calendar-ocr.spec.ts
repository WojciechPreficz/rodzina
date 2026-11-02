import { expect, test, type Page } from '@playwright/test';

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

async function complexPoster(page: Page, layout: 'grid' | 'ticket' | 'graphic') {
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
  await expect(page.getByText('Tekst źródłowy', { exact: true }).first()).toBeVisible();
  await expect(page.getByAltText('Podgląd wybranego zdjęcia')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zapisz', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(writes).toEqual([]);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ocr-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Wróć do kalendarza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true })).toBeVisible();
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

for (const layout of ['grid', 'ticket', 'graphic'] as const) {
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
        await expect(cards.nth(index)).toContainText('Godzina: wymaga potwierdzenia');
      }
    } else if (layout === 'ticket') {
      await expect(cards.getByRole('heading')).toHaveText('ARKA NOEGO - KONCERT KOLĘD');
      await expect(cards).toContainText('Data: 2027-01-10');
      await expect(cards).toContainText('Godzina: 11:00');
      await expect(cards).toContainText('Miejsce: Katowice, Pałac Młodzieży, ul. Mikołowska 26');
    } else {
      await expect(cards.getByRole('heading')).toHaveText('DOGOTERAPIA');
      await expect(cards).toContainText('Data: 2026-10-21');
      await expect(cards).toContainText('Godzina: wymaga potwierdzenia');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ocr-${layout}.png`), fullPage: true });
  });
}
