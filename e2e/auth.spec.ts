import { expect, test } from '@playwright/test';
import { openNavigation } from './navigation.js';

test('registers, joins through an invitation, logs in a child and resets a password', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const suffix = testInfo.project.name;
  const second = await browser.newContext({
    baseURL: baseURL!,
    viewport: testInfo.project.use.viewport ?? { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  const childContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: testInfo.project.use.viewport ?? { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Załóż rodzinę' }).click();
    await expect(page.getByLabel('Nazwa rodziny', { exact: true })).toHaveAttribute('placeholder', 'Nasz dom');
    await page.screenshot({ path: testInfo.outputPath('registration.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('Nazwa rodziny', { exact: true }).fill(`Rodzina ${suffix}`);
    await page.getByLabel('Twoje imię', { exact: true }).fill('Anna');
    await page.getByLabel('E-mail', { exact: true }).fill(`anna-${suffix}@example.com`);
    await page.getByLabel('Hasło', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Utwórz rodzinę' }).click();
    await expect(page.locator('.mantine-AppShell-header')).toBeVisible();
    await page.reload();
    await expect(page.locator('.mantine-AppShell-header')).toBeVisible();
    await page.goto('/wiecej/rodzina');
    await page.getByRole('button', { name: 'Utwórz zaproszenie' }).click();
    const invitationLink = await page.getByLabel('Link', { exact: true }).inputValue();
    const memberPage = await second.newPage();
    await memberPage.goto(invitationLink);
    await expect(memberPage.getByText(`Rodzina ${suffix}`, { exact: true })).toBeVisible();
    await memberPage.screenshot({ path: testInfo.outputPath('invitation.png'), fullPage: true });
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await memberPage.getByRole('textbox', { name: /Twoje imię/ }).fill('Piotr');
    await memberPage.getByRole('textbox', { name: /E-mail/ }).fill(`piotr-${suffix}@example.com`);
    await memberPage.getByLabel(/^Hasło/).fill('password123');
    await memberPage.getByRole('button', { name: 'Dołącz do rodziny' }).click();
    await expect(memberPage.locator('.mantine-AppShell-header')).toBeVisible();
    for (const current of [page, memberPage]) {
      await current.goto('/wiecej/rodzina');
      await expect(current.getByRole('main').getByText(/^Anna(?: \(Ty\))?$/)).toBeVisible();
      await expect(current.getByRole('main').getByText(/^Piotr(?: \(Ty\))?$/)).toBeVisible();
      expect(await current.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.getByRole('button', { name: 'Dodaj dziecko', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /^Imię/ }).fill('Zosia');
    await dialog.getByLabel(/^PIN/).fill('1234');
    await dialog.getByRole('button', { name: 'Dodaj dziecko' }).click();
    await expect(dialog).not.toBeVisible();
    const me = await page.request.get('/api/auth/me');
    const joinCode = (await me.json()).family.joinCode;
    const childPage = await childContext.newPage();
    await childPage.goto('/login-child?next=%2Fzakupy');
    await childPage.getByRole('textbox', { name: /Kod rodziny/ }).fill(joinCode);
    await childPage.getByRole('button', { name: 'Pokaż profile' }).click();
    await childPage.getByRole('button', { name: 'Zosia' }).click();
    await childPage.screenshot({ path: testInfo.outputPath('child-pin.png'), fullPage: true });
    expect(await childPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const digit of '1234') await childPage.getByRole('button', { name: `Cyfra ${digit}`, exact: true }).click();
    await childPage.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(childPage).toHaveURL(/\/zakupy$/);
    await childPage.reload();
    await expect(childPage.locator('.mantine-AppShell-header')).toBeVisible();
    await childPage.goto('/wiecej/rodzina');
    await expect(childPage.getByRole('button', { name: 'Edytuj: Zosia' })).toBeVisible();
    await expect(childPage.getByRole('button', { name: 'Dodaj dziecko' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Edytuj: Piotr' }).click();
    await page.getByRole('button', { name: 'Wygeneruj link resetu hasła' }).click();
    const resetLink = await page.getByRole('dialog').getByLabel('Link', { exact: true }).inputValue();
    await memberPage.goto('/wiecej');
    await openNavigation(memberPage);
    await memberPage.getByRole('button', { name: 'Wyloguj się' }).click();
    await expect(memberPage.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
    await memberPage.goto(resetLink);
    await memberPage.screenshot({ path: testInfo.outputPath('password-reset.png'), fullPage: true });
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await memberPage.getByLabel(/^Nowe hasło/).fill('newPassword123');
    await memberPage.getByLabel(/^Powtórz hasło/).fill('newPassword123');
    await memberPage.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(memberPage.getByRole('status')).toContainText('Hasło zostało zmienione');
    await memberPage.getByRole('link', { name: 'Zaloguj się' }).click();
    await memberPage.getByLabel('E-mail', { exact: true }).fill(`piotr-${suffix}@example.com`);
    await memberPage.getByLabel('Hasło', { exact: true }).fill('newPassword123');
    await memberPage.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(memberPage.locator('.mantine-AppShell-header')).toBeVisible();
  } finally {
    await second.close();
    await childContext.close();
  }
});
