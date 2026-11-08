/* global document, window */
import { test, expect } from '@playwright/test';

test('opens terms from the landing page and supports reading, navigation and printing without JavaScript', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ viewport: info.project.use.viewport, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4178/');
    await page.getByRole('link', { name: 'Regulamin i zasady korzystania' }).click();
    await expect(page).toHaveURL(/\/regulamin\.html$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Regulamin i zasady');
    await expect(page.getByLabel('Status dokumentu')).toContainText('Projekt przed publicznym udostępnieniem');
    await page.getByRole('link', { name: 'Pomoc i reklamacje', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#reklamacje$/);
    await expect(page.getByRole('heading', { name: '9. Pomoc i reklamacje' })).toBeInViewport();
    await expect(page.locator('#reklamacje a')).toHaveAttribute('href', 'mailto:kontakt@preficze.pl');
    for (const href of await page
      .locator('.legal-toc a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
      await expect(page.locator(href)).toHaveCount(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('http://127.0.0.1:4178/regulamin.html');
    await page.screenshot({ path: info.outputPath('terms.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation')).toBeHidden();
    await expect(page.locator('#operator')).toBeVisible();
    await expect(page.getByLabel('Status dokumentu')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('link', { name: 'Wróć na stronę główną' }).click();
    await expect(page).toHaveURL(/\/index\.html$/);
  } finally {
    await context.close();
  }
});
