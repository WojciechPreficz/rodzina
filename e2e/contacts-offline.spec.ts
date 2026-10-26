import { readOfflineSnapshot } from './offlineDatabase.js';
import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`contacts offline ${native ? 'restart via Android transport' : 'open website'} and reconnect`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Kontakty offline',
            displayName: 'Anna',
            email: `contacts-offline-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const { contact } = await (
      await page.request.post('/api/contacts', {
        headers,
        data: {
          name: 'Łucja Żak',
          phone: '+48 (600) 111-222',
          address: 'Łódź, ul. Łąkowa 3\nWejście od ogrodu. '.repeat(10),
        },
      })
    ).json();
    if (native) await installNativeTransport(page);
    await page.goto('/kontakty');
    if (info.project.name === 'desktop') await page.getByRole('button', { name: /Inne/ }).click();
    const details = page.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Żak' });
    await expect(details).toBeVisible();
    await expect(page.getByRole('button', { name: '＋ Dodaj kontakt' })).toBeEnabled();
    await expect
      .poll(() =>
        readOfflineSnapshot<{ data: { contacts: unknown[] } }>(page, 'contacts').then(
          (saved) => saved?.data.contacts.length,
        ),
      )
      .toBe(1);
    if (native) {
      // Only the API is disconnected: the harness serves local frontend assets as an APK would.
      await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
      await page.evaluate(() => {
        localStorage.setItem('test:offline', 'yes');
        window.dispatchEvent(new Event('offline'));
      });
      await page.reload();
      if (info.project.name === 'desktop') await page.getByRole('button', { name: /Inne/ }).click();
    } else await page.context().setOffline(true);
    await expect(page.getByText(/Ostatnie pobranie:/)).toBeVisible();
    await expect(page.getByRole('button', { name: '＋ Dodaj kontakt' })).toBeDisabled();
    const search = page.getByRole('textbox', { name: 'Szukaj kontaktu' });
    for (const term of ['lucja zak', 'lodz', '600111222']) {
      await search.fill(term);
      await expect(details).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('contacts-offline.png'), fullPage: true, animations: 'disabled' });
    await details.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link')).toHaveAttribute('href', 'tel:+48600111222');
    await expect(dialog.getByRole('button', { name: 'Edytuj', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(
      (await page.request.patch(`/api/contacts/${contact.id}`, { headers, data: { name: 'Łucja Nowak' } })).ok(),
    ).toBe(true);
    if (native) {
      await page.unroute('**/api/**');
      await page.evaluate(() => {
        localStorage.removeItem('test:offline');
        window.dispatchEvent(new Event('online'));
      });
    } else await page.context().setOffline(false);
    await search.fill('');
    await expect(page.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Nowak' })).toBeVisible();
    await expect(page.getByRole('button', { name: '＋ Dodaj kontakt' })).toBeEnabled();
    await expect(page.getByText(/Ostatnie pobranie:/)).toHaveCount(0);
    await expect
      .poll(() =>
        readOfflineSnapshot<{ data: { contacts: { name: string }[] } }>(page, 'contacts').then(
          (saved) => saved?.data.contacts[0]?.name,
        ),
      )
      .toBe('Łucja Nowak');
  });
}
