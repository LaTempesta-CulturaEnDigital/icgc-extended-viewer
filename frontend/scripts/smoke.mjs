// Optional live smoke test against a running deployment and its actual external services.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const url = process.env.SMOKE_VIEWER_URL ?? 'http://localhost:8000/viewer/?collection=fonscec&id=1021';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let tiles = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.ok() && /\/iiif\/2\/.*\/(?:default|native)\.(?:jpg|png)/.test(response.url())) tiles++;
  });
  await page.goto(url);
  await page.locator('#status').filter({ hasText: 'Mapa carregat' }).waitFor({ timeout: 45000 });
  await expect(page.locator('#detections')).toBeChecked();
  await expect(page.locator('#paragraphs')).not.toBeChecked();
  await page.waitForFunction(() => document.querySelector('#empty-state').hidden);
  await expect.poll(() => tiles, { timeout: 30000 }).toBeGreaterThan(0);
  await page.locator('#detections').check();
  await page.locator('#paragraphs').check();
  if (await page.locator('#region-list button').count()) await page.locator('#region-list button').first().click();
  // Panel resizing requests new tiles; capture only after those finite image requests settle.
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await expect(page.locator('#retry-image')).toBeHidden();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/live-map.png', fullPage: true });
  if (!tiles) throw new Error('No real IIIF image tile was successfully loaded');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ url, title: await page.title(), imageTiles: tiles,
    detectionBoxes: await page.locator('.detection-box').count(),
    paragraphRegions: await page.locator('.paragraph-box').count(),
    textVersions: await page.locator('.transcription-text').count(), screenshot: 'test-results/live-map.png' }, null, 2));
} finally {
  await browser.close();
}
