import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { invitationConfirmationLink } from './invitation.js';

for (const native of [false, true]) {
  test(`confirms an invitation from ${native ? 'Android transport' : 'WWW'} in a browser`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    const email = `invited-${native}-${info.project.name}@example.com`;
    const password = 'password123';
    const origin = { Origin: baseURL! };
    const admin = await browser.newContext({ baseURL: baseURL! });
    let inviteToken: string;
    try {
      const account = await admin.request.post('/api/test/families', {
        headers: origin,
        data: { familyName: 'Rodzina testowa', displayName: 'Anna', email: `admin-${email}`, password },
      });
      expect(account.status()).toBe(201);
      const invitation = await admin.request.post('/api/invitations', { headers: origin, data: { role: 'member' } });
      expect(invitation.status()).toBe(200);
      inviteToken = (await invitation.json()).token;
    } finally {
      await admin.close();
    }

    if (native) await installNativeTransport(page);
    await page.goto(`/zaproszenie/${inviteToken}`);
    await page.getByLabel('E-mail').fill(email);
    await expect(page.getByLabel('Hasło')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Wyślij link potwierdzający' }).click();
    await expect(page.getByRole('status')).toContainText('Jeśli otrzymasz link potwierdzający');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);

    const link = await invitationConfirmationLink(page.request, email);
    const context = await browser.newContext({
      baseURL: baseURL!,
      viewport: page.viewportSize(),
      serviceWorkers: 'block',
    });
    try {
      const confirmation = await context.newPage();
      const response = await confirmation.goto(link.pathname + link.hash);
      expect(response?.headers()['cache-control']).toBe('no-store');
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');
      await confirmation.getByLabel('Twoje imię').fill('Piotr');
      await confirmation.getByLabel('Hasło').fill(password);
      expect(await confirmation.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await confirmation.getByRole('button', { name: 'Dołącz do rodziny' }).click();
      await expect(confirmation.locator('.mantine-AppShell-main')).toBeVisible();
      expect(new URL(confirmation.url()).hash).toBe('');
      expect((await (await confirmation.request.get('/api/auth/me')).json()).user.email).toBe(email);
    } finally {
      await context.close();
    }
    if (native) {
      await page.goto('/login');
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Hasło', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
      await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
    }
  });
}
