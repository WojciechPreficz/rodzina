import { expect, type Page } from '@playwright/test';

export async function confirmRegistrationFromInbox(page: Page, email: string) {
  await expect(page.getByRole('status')).toContainText('Jeśli możesz założyć konto pod adresem', { timeout: 10000 });
  const response = await page.request.get(`/api/test/registration-mail?email=${encodeURIComponent(email)}`);
  const mail = await response.json();
  const link = new URL(mail.link);
  await page.goto(link.pathname + link.hash);
  await page.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' }).click();
  await expect(page.getByRole('status')).toContainText('zostały utworzone');
  await page.getByRole('link', { name: 'Zaloguj się', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Hasło', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
}
