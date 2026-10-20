import { expect, test } from '@playwright/test';

test('navigates calendar periods with touch while preserving taps and vertical scrolling', async ({
  page,
  baseURL,
}, testInfo) => {
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Gesty',
      displayName: 'Anna',
      email: `swipe-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/kalendarz');
  const calendar = page.locator('.family-calendar');
  const input = calendar.getByTestId('date-picker-input');
  await expect(input).toBeVisible();
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const gesture = async (dx: number, dy = 0) => {
    const surface = calendar.locator('.sx__month-agenda-wrapper, .sx__time-grid-day').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (!box) throw new Error('Calendar surface missing');
    const x = box.x + box.width / 2;
    const y = Math.max(box.y, 0) + 50;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6 }],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const initial = await input.inputValue();
  if (testInfo.project.name === 'desktop') {
    await gesture(-100);
    await expect(input).toHaveValue(initial);
  } else {
    for (const view of ['Miesiąc', 'Tydzień', 'Dzień']) {
      await calendar.getByRole('button', { name: 'Wybierz widok', exact: true }).click();
      await calendar.getByRole('button', { name: `Wybierz widok ${view}`, exact: true }).click();
      const before = await input.inputValue();
      await gesture(-100);
      await expect(input).not.toHaveValue(before);
      await gesture(100);
      await expect(input).toHaveValue(before);
      await gesture(0, -80);
      await expect(input).toHaveValue(before);
      await gesture(-15);
      await expect(input).toHaveValue(before);
      await page.screenshot({ path: testInfo.outputPath(`calendar-${view}.png`) });
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('calendar-swipe.png') });
  await client.detach();
});
