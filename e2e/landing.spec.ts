import { expect, test } from '@playwright/test';

test('visitors reach the public landing and can enter registration and login', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?source=landing#hello');
  await expect(page).toHaveURL(/\/strona\/\?source=landing#hello$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mniej pamiętania.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('landing.png'), fullPage: true });
  await page.getByRole('tab', { name: /Obowiązki/ }).click();
  await page.getByRole('checkbox', { name: /Podlać kwiaty/ }).check();
  await expect(page.locator('#task-progress')).toHaveText('1 / 3');
  await page.getByRole('button', { name: /Dodaj składniki/ }).click();
  await expect(page.locator('#ingredient-list li')).toHaveCount(7);
  const registration = page.locator('.hero-actions [data-app-path="/register"]');
  await expect(registration).toHaveAttribute('href', /\/register$/);
  await registration.click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('button', { name: 'Utwórz rodzinę', exact: true })).toBeVisible();
  await page.goto('/strona');
  await expect(page).toHaveURL(/\/strona\/$/);
  await page.getByText('Czy cała rodzina może korzystać z aplikacji?', { exact: false }).click();
  await page.getByRole('link', { name: 'Logowanie dziecka' }).click();
  await expect(page).toHaveURL(/\/login-child$/);
  await expect(page.getByRole('button', { name: 'Pokaż profile', exact: true })).toBeVisible();
  await page.goto('/strona/');
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('signed-in visitors keep their calendar and can still view the public landing', async ({ page, baseURL }) => {
  const registration = await page.request.post('/api/test/families', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Rodzina strony',
      displayName: 'Anna',
      email: `landing-${crypto.randomUUID()}@example.com`,
      password: 'Password123!',
    },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/`);
  await page.goto('/strona/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mniej pamiętania.');
  await page.locator('.hero-actions [data-app-path="/register"]').click();
  await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/`);
});

test.describe('privacy policy', () => {
  test.use({ javaScriptEnabled: false });

  test('opens from the landing and terms, with keyboard navigation and a print layout', async ({ page }, info) => {
    const privacyUrl = /\/strona\/polityka-prywatnosci\.html$/;
    await page.goto('/strona/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Polityka prywatności' }).click();
    await expect(page).toHaveURL(privacyUrl);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Polityka prywatności.');
    await expect(page.getByLabel('Status dokumentu')).toContainText('Projekt do zatwierdzenia przez właściciela');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('privacy.png'), fullPage: true });

    const contents = page.getByRole('navigation', { name: 'Spis treści polityki prywatności' });
    for (const href of await contents
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))) {
      await expect(page.locator(href)).toHaveCount(1);
    }
    await contents.getByRole('link', { name: 'Dane osób z kontaktów' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#kontakty$/);
    await expect(page.getByRole('heading', { name: '4. Dane osób z kontaktów' })).toBeInViewport();

    await page.emulateMedia({ media: 'print' });
    await expect(contents).toBeHidden();
    await expect(page.getByRole('contentinfo')).toBeHidden();
    await expect(page.getByLabel('Status dokumentu')).toBeVisible();
    await expect(page.getByRole('heading', { name: '9. Twoje prawa i skarga' })).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    await page.getByRole('contentinfo').getByRole('link', { name: 'Regulamin i zasady korzystania' }).click();
    await expect(page).toHaveURL(/\/strona\/regulamin\.html$/);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Polityka prywatności' }).click();
    await expect(page).toHaveURL(privacyUrl);
  });
});

test('Android keeps its existing welcome screen and login', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: [{ name: 'RodzinaApi', methods: [{ name: 'request', rtype: 'promise' }] }],
        nativePromise: async () => ({
          status: 401,
          body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Brak aktywnej sesji.' } }),
        }),
      },
    });
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/witaj$/);
  await expect(page.getByRole('heading', { name: 'Witamy w Rodzinie' })).toBeVisible();
  await expect(page.locator('.hero')).toHaveCount(0);
  await page.getByRole('link', { name: 'Zaloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
