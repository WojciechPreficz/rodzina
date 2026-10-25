import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { openNavigation } from './navigation.js';

for (const native of [false, true]) {
  test(`phone multiselect combines groups via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'phone', 'Mobile filter only');
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Filtry kontaktów',
            displayName: 'Anna',
            email: `contact-filters-${native}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const { groups } = (await (await page.request.get('/api/contacts')).json()) as {
      groups: Array<{ id: string; name: string }>;
    };
    for (const [group, name] of [
      ['Rodzina', 'Zofia'],
      ['Inne', 'Andrzej'],
    ]) {
      expect(
        (
          await page.request.post('/api/contacts', {
            headers,
            data: { name, groupId: groups.find((item) => item.name === group)!.id },
          })
        ).ok(),
      ).toBe(true);
    }
    const longName = 'Bardzo długa nazwa grupy kontaktów znajomych z sąsiedztwa';
    expect((await page.request.post('/api/contact-groups', { headers, data: { name: longName } })).ok()).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/kontakty');
    const filter = page.getByRole('textbox', { name: 'Filtr kontaktów', exact: true });
    const pick = async (name: string) => {
      await filter.fill(name);
      await page.getByRole('option', { name: new RegExp(name) }).click();
      await filter.press('Escape');
    };
    await expect(page.getByRole('heading', { name: 'Wszystkie kontakty' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Grupy kontaktów' })).toHaveCount(0);
    await expect(page.locator('.contact-row')).toHaveCount(2);
    await pick('Rodzina');
    await expect(page.locator('.contact-row')).toHaveCount(1);
    await expect(page.getByText('Zofia', { exact: true })).toBeVisible();
    await pick('Inne');
    await expect(page.locator('.contact-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Usuń grupę' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Szukaj kontaktu' }).fill('Zofia');
    await expect(page.locator('.contact-row')).toHaveCount(1);
    await expect(page.getByText('Kontakty: 2')).toBeVisible();
    await pick(longName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const pill of await page.locator('.contacts-mobile-filter .mantine-Pill-label').all())
      await expect(pill).toHaveCSS('white-space', 'nowrap');
    await page.screenshot({
      path: info.outputPath('contacts-multiselect.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await page.getByRole('textbox', { name: 'Szukaj kontaktu' }).fill('');
    await expect(page.getByRole('heading', { name: 'Wszystkie kontakty' })).toBeVisible();
    await expect(page.locator('.contact-row')).toHaveCount(2);
  });
  test(`contacts CRUD, keyboard, guards and layout via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const mobile = info.project.name === 'phone';
    const pickGroup = async (name: string) => {
      if (mobile) {
        const clear = page.getByRole('button', { name: 'Wyczyść filtry' });
        if (await clear.isVisible()) await clear.click();
        const input = page.getByRole('textbox', { name: 'Filtr kontaktów', exact: true });
        await input.fill(name);
        await page.getByRole('option', { name: new RegExp(name) }).click();
        await input.press('Escape');
      } else await page.getByRole('button', { name: new RegExp(name) }).click();
    };
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Kontakty',
            displayName: 'Anna',
            email: `contacts-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/kalendarz');
    await openNavigation(page);
    await page.getByRole('link', { name: 'Kontakty', exact: true }).click();
    await expect(page).toHaveURL(/\/kontakty$/);
    await expect(
      page.getByText(mobile ? 'Nie dodano jeszcze kontaktów.' : 'W tej grupie nie ma jeszcze kontaktów.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '＋ Dodaj grupę' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nazwa grupy', { exact: false }).fill('Sąsiedzi');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await pickGroup('Sąsiedzi');
    const group = mobile
      ? page.locator('.contacts-mobile-filter .mantine-Pill-label')
      : page.getByRole('button', { name: /Sąsiedzi/ });
    await page.getByRole('button', { name: '＋ Dodaj kontakt' }).click();
    dialog = page.getByRole('dialog');
    const name = dialog.getByLabel('Imię i nazwisko lub nazwa', { exact: false });
    await expect(name).toBeFocused();
    await name.fill('Łucja Żak');
    await dialog.getByLabel('Opis relacji').fill('Sąsiadka');
    await dialog.getByLabel('Telefon', { exact: true }).fill('+48 (600) 111-222');
    const address = 'ul. Łąkowa 3, mieszkanie 15\nŁódź, wejście od ogrodu. '.repeat(5);
    await dialog.getByLabel('Adres', { exact: true }).fill(address);
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    const contact = page.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Żak' });
    await expect(contact).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '+48 (600) 111-222' })).toHaveAttribute('href', 'tel:+48600111222');
    await expect(page.getByText('Kontakty: 1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`contacts-${native}.png`), fullPage: true, animations: 'disabled' });
    const search = page.getByRole('textbox', { name: 'Szukaj kontaktu' });
    for (const term of ['LUCJA ZAK', 'sasiadka', 'lodz', '600111222']) {
      await search.fill(term);
      await expect(contact).toBeVisible();
      await expect(group).toContainText('1');
    }
    await search.fill('brak');
    await expect(page.getByText('Brak wyników wyszukiwania.')).toBeVisible();
    await search.fill('');
    await contact.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Łucja Żak' })).toBeVisible();
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await name.fill('Łucja Nowak');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('heading', { name: 'Łucja Nowak' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Zmień nazwę grupy' }).click();
    await dialog.getByLabel('Nazwa grupy', { exact: false }).fill('Bliscy sąsiedzi');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('heading', { name: 'Bliscy sąsiedzi' })).toBeVisible();
    await page.getByRole('button', { name: 'Usuń grupę' }).click();
    await expect(dialog).toContainText('Żaden kontakt nie zostanie usunięty.');
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await pickGroup('Inne');
    await expect(page.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Nowak' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usuń grupę' })).toHaveCount(0);
    await page.getByRole('button', { name: '＋ Dodaj kontakt' }).click();
    await name.fill('Niezapisany kontakt');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(name).toHaveValue('Niezapisany kontakt');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(/\/kontakty$/);
    await expect(name).toHaveValue('Niezapisany kontakt');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await page.keyboard.press('Escape');
    await expect(name).toHaveValue('Niezapisany kontakt');
    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Nowak' }).click();
    await page.getByRole('button', { name: 'Usuń kontakt' }).click();
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('W tej grupie nie ma jeszcze kontaktów.')).toBeVisible();
    if (!native) {
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(page.getByRole('button', { name: '＋ Dodaj kontakt' })).toBeDisabled();
      await expect(page.getByText(/Brak połączenia z internetem/)).toBeVisible();
    }
  });
}
