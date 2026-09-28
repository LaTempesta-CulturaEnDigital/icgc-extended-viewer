import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (path: string) => JSON.parse(readFileSync(new URL('../../../fixtures/' + path, import.meta.url), 'utf8'));

async function imageService(page: Page) {
  await page.route('https://cdm21055.contentdm.oclc.org/iiif/2/**', async route => {
    const url = new URL(route.request().url());
    const identifier = url.pathname.split('/')[3];
    const [collection, id] = identifier.split(':');
    const manifest = fixture(`manifests/${collection}_${id}.json`);
    const canvas = manifest.sequences[0].canvases[0];
    // Intentionally differ from the original canvas dimensions, on each axis.
    const width = Math.round(canvas.width / 4), height = Math.round(canvas.height / 3);
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname.endsWith('/info.json')) {
      await route.fulfill({ json: { '@context': 'http://iiif.io/api/image/2/context.json',
        '@id': `https://cdm21055.contentdm.oclc.org/iiif/2/${identifier}`, protocol: 'http://iiif.io/api/image',
        width, height, profile: ['http://iiif.io/api/image/2/level0.json'], sizes: [{ width, height }] }, headers });
    } else {
      const data = fixture(`annotations/${collection}/${id}/detections.json`);
      const regions = data.resources.map((item: any) => {
        const [x,y,w,h] = item.on.split('xywh=')[1].split(',').map(Number);
        return `<rect x="${x*width/canvas.width}" y="${y*height/canvas.height}" width="${w*width/canvas.width}" height="${h*height/canvas.height}" fill="#d3c9ad" stroke="#786e4b" stroke-width="2"/>`;
      }).join('');
      await route.fulfill({ contentType: 'image/svg+xml', headers, body:
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eee4c9"/><path d="M0 ${height/2}H${width} M${width/2} 0V${height}" stroke="#d2c6a2"/>${regions}</svg>` });
    }
  });
}

test.beforeEach(async ({ page }) => { await imageService(page); });

for (const prefix of ['', '/maps']) {
  test(`real annotations, combined detections and readable text at ${prefix || '/'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${prefix}/viewer/?collection=catalunya&id=1037`);
    await expect(page.locator('#status')).toContainText('Mapa carregat');
    await expect(page.locator('#detections')).toBeChecked();
    await expect(page.locator('#paragraphs')).not.toBeChecked();
    await expect(page.locator('#labels')).toHaveCount(0);
    await expect(page.locator('.paragraph-box')).toHaveCount(0);
    await expect(page.locator('.detection-box')).toHaveCount(3);
    await expect(page.locator('.detection-label')).toHaveCount(3);
    await page.locator('#detections').uncheck();
    await expect(page.locator('.detection-box,.detection-label')).toHaveCount(0);
    await page.locator('#detections').check();
    await page.locator('#paragraphs').check();
    await expect(page.locator('.paragraph-box')).toHaveCount(1);
    await page.locator('.paragraph-box').click();
    await expect(page.locator('.transcription-text')).toHaveCount(2);
    await expect(page.locator('.transcription-text').first()).toContainText('Carta Esferica');
    await expect(page.locator('.annotation-details')).toHaveCount(2);
    await expect(page.locator('.annotation-details').first()).not.toHaveAttribute('open');
    await expect(page.locator('.annotation-details dl').first()).not.toBeVisible();
    await page.locator('.annotation-details summary').first().click();
    await expect(page.locator('.annotation-details dl').first()).toContainText('Model');
    const sourceText = fixture('annotations/catalunya/1037/transcriptions.json').resources[0].resource.chars;
    expect(await page.locator('.transcription-text').first().textContent()).toBe(sourceText);
    await expect(page.locator('.transcription-text').first()).toHaveCSS('white-space', 'pre-wrap');
    await page.keyboard.press('Escape');
    await expect(page.locator('#paragraphs')).not.toBeChecked();
    await page.locator('#paragraphs').check();
    await page.locator('#region-list button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#transcription')).toBeFocused();
    await page.screenshot({ path: `test-results/viewer-${prefix ? 'prefix' : 'root'}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('alignment follows different image dimensions, zoom, pan and resize', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=308');
  await expect(page.locator('#status')).toContainText('Mapa carregat');
  await page.locator('#detections').check();
  const overlay = page.locator('.detection-box');
  const bounds = await page.locator('#viewer').boundingBox();
  const canvasWidth = 6493, canvasHeight = 8649;
  const imageWidth = Math.round(canvasWidth/4), imageHeight = Math.round(canvasHeight/3);
  const fittedWidth = Math.min(bounds!.width, bounds!.height * imageWidth / imageHeight);
  const fittedHeight = fittedWidth * imageHeight/imageWidth;
  const expectedX = bounds!.x + (bounds!.width-fittedWidth)/2 + 747/canvasWidth*fittedWidth;
  const expectedY = bounds!.y + (bounds!.height-fittedHeight)/2 + 7983/canvasHeight*fittedHeight;
  await expect.poll(async () => Math.abs((await overlay.boundingBox())!.x-expectedX)).toBeLessThan(3);
  expect(Math.abs((await overlay.boundingBox())!.y-expectedY)).toBeLessThan(3);
  const before = (await overlay.boundingBox())!;
  await page.locator('#zoom-in').click();
  await expect.poll(async () => Math.abs((await overlay.boundingBox())!.width / before.width - 1.5)).toBeLessThan(0.03);
  const zoomed = (await overlay.boundingBox())!;
  await page.mouse.move(bounds!.x+bounds!.width/2, bounds!.y+bounds!.height/2);
  await page.mouse.down(); await page.mouse.move(bounds!.x+bounds!.width/2+40, bounds!.y+bounds!.height/2+20, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Math.abs((await overlay.boundingBox())!.x-zoomed.x)).toBeGreaterThan(25);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.locator('#home').click();
  const resized = (await page.locator('#viewer').boundingBox())!;
  const resizedWidth = Math.min(resized.width, resized.height * imageWidth / imageHeight);
  const resizedHeight = resizedWidth * imageHeight / imageWidth;
  await expect.poll(async () => Math.abs((await overlay.boundingBox())!.x -
    (resized.x + (resized.width - resizedWidth) / 2 + 747 / canvasWidth * resizedWidth))).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await overlay.boundingBox())!.y -
    (resized.y + (resized.height - resizedHeight) / 2 + 7983 / canvasHeight * resizedHeight))).toBeLessThan(3);
});

test('empty and missing annotations preserve the map and usable controls', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=1019');
  await expect(page.locator('#status')).toContainText('No hi ha anotacions');
  await expect(page.locator('#retry-annotations')).toBeHidden();
  await expect(page.locator('#detection-count')).toHaveText('0');
  await page.locator('#paragraphs').check();
  await expect(page.locator('#transcription')).toContainText('No hi ha paràgrafs');
  await page.route('**/static/iiif/annotations/fonscec/1021/*.json', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/viewer/?collection=fonscec&id=1021');
  await expect(page.locator('#status')).toContainText('no disponibles');
  await expect(page.locator('#status')).not.toContainText('No hi ha anotacions');
  await expect(page.locator('#detection-count')).toHaveText('—');
  await expect(page.locator('#empty-state')).toBeHidden();
  await page.locator('#detections').check();
  await expect(page.locator('#detections')).toBeChecked();
  await expect(page.locator('#retry-annotations')).toBeVisible();
  await page.unroute('**/static/iiif/annotations/fonscec/1021/*.json');
  await page.locator('#retry-annotations').click();
  await expect(page.locator('#retry-annotations')).toBeHidden();
  await expect(page.locator('.detection-box')).toHaveCount(3);
  await expect(page.locator('.detection-label')).not.toContainText(['Altres objectes']);
  await expect(page.locator('#detections')).toBeChecked();
});

for (const size of [{ width: 1280, height: 800 }, { width: 1100, height: 360 }, { width: 430, height: 650 }, { width: 320, height: 480 }]) {
  test(`iframe fills ${size.width}×${size.height} without outer scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: size.width + 40, height: size.height + 40 });
    await page.goto('/embed');
    await page.locator('iframe').evaluate((iframe, size) => {
      iframe.style.width = `${size.width}px`; iframe.style.height = `${size.height}px`;
    }, size);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#status')).toContainText('Mapa carregat');
    await expect(frame.locator('header, footer')).toHaveCount(0);
    await expect(frame.locator('#map-title')).toBeHidden();
    const fullMap = (await frame.locator('#viewer').boundingBox())!;
    expect(fullMap.height).toBeGreaterThan(size.height * .65);
    await frame.locator('#paragraphs').check();
    await frame.locator('#region-list button').click();
    await expect(frame.locator('.transcription-text').first()).toBeInViewport();
    const map = (await frame.locator('#viewer').boundingBox())!;
    const panel = (await frame.locator('#text-panel').boundingBox())!;
    if (size.width >= 800) {
      expect(panel.width).toBe(320);
      expect(Math.abs(panel.y - map.y)).toBeLessThan(1);
      expect(Math.abs(panel.height - map.height)).toBeLessThan(1);
    } else {
      expect(panel.width).toBe(size.width);
      expect(Math.abs(panel.y - (map.y + map.height))).toBeLessThan(1);
      expect(Math.abs(panel.height - map.height)).toBeLessThan(1);
    }
    expect(map.height).toBeGreaterThan(150);
    await frame.locator('#detections').check();
    await frame.locator('#categories').click();
    await expect(frame.getByRole('checkbox', { name: 'Muntanya', exact: true })).toBeChecked();
    const filter = (await frame.locator('#category-filter').boundingBox())!;
    const host = (await page.locator('iframe').boundingBox())!;
    expect(filter.x).toBeGreaterThanOrEqual(host.x);
    expect(filter.x + filter.width).toBeLessThanOrEqual(host.x + size.width);
    expect(filter.y + filter.height).toBeLessThanOrEqual(host.y + size.height);
    await frame.locator('#categories-none').click();
    await expect(frame.locator('.detection-box,.detection-label')).toHaveCount(0);
    await frame.locator('#category-list input').focus();
    await page.keyboard.press('Space');
    await expect(frame.locator('.detection-box')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(frame.locator('#category-filter')).toBeHidden();
    await expect(frame.locator('#categories')).toBeFocused();
    await expect(frame.locator('#paragraphs')).toBeChecked();
    const scroll = await frame.locator('body').evaluate(() => ({
      document: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
      body: [document.body.scrollWidth - innerWidth, document.body.scrollHeight - innerHeight],
    }));
    expect(scroll).toEqual({ document: [0, 0], body: [0, 0] });
    await page.screenshot({ path: `test-results/viewer-iframe-${size.width}x${size.height}.png`, fullPage: true });
    await frame.locator('#information').click();
    await expect(frame.locator('#information-dialog')).toBeVisible();
    const dialog = (await frame.locator('#information-dialog').boundingBox())!;
    const iframe = (await page.locator('iframe').boundingBox())!;
    expect(dialog.y).toBeGreaterThanOrEqual(iframe.y);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(iframe.y + size.height);
    await frame.locator('#source').focus();
    await expect(frame.locator('#source')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(frame.locator('#information')).toBeFocused();
    await expect(frame.locator('#paragraphs')).toBeChecked();
  });
}

test('information preserves metadata, traps focus and closes without changing layers', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=1021');
  await expect(page.locator('#information')).toBeEnabled();
  await page.locator('#paragraphs').check();
  await page.locator('#information').click();
  const dialog = page.getByRole('dialog', { name: 'Informació del mapa' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#record')).toHaveText('FONSCEC / 1021');
  await expect(page.locator('#map-title')).toHaveText(fixture('manifests/fonscec_1021.json').label);
  await expect(page.locator('#metadata-list dt')).toHaveCount(fixture('manifests/fonscec_1021.json').metadata.length);
  await expect(page.locator('#attribution')).not.toBeEmpty();
  await expect(page.locator('#source')).toHaveAttribute('href', 'http://127.0.0.1:8100/iiif/info/fonscec/1021/manifest.json');
  await expect(page.locator('#close-information')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#source')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#close-information')).toBeFocused();
  await page.locator('#close-information').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#information')).toBeFocused();
  await expect(page.locator('#paragraphs')).toBeChecked();
});

test('unknown map and image failures show recoverable errors', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=999999');
  await expect(page.locator('#empty-detail')).toContainText('No s’ha trobat');
  await expect(page.locator('#retry')).toBeVisible();
  await page.route('**/iiif/2/**/info.json', route => route.fulfill({ status: 503, body: '' }));
  await page.goto('/viewer/?collection=fonscec&id=308');
  await expect(page.locator('#empty-title')).toContainText('No s’ha pogut obrir');
  await expect(page.locator('#empty-detail')).toContainText('imatge IIIF');
  await expect(page.locator('#retry')).toBeVisible();
});

test('tile errors have a visible retry beside the status message', async ({ page }) => {
  await page.route('https://cdm21055.contentdm.oclc.org/iiif/2/**', route =>
    route.request().url().endsWith('/info.json') ? route.fallback() : route.fulfill({ status: 503, body: '' }));
  await page.goto('/viewer/?collection=fonscec&id=308');
  await expect(page.locator('#status')).toContainText('algunes parts de la imatge');
  await expect(page.locator('#retry-image')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeHidden();
});

test('slow annotations show a loading state while the image remains usable', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/static/iiif/annotations/fonscec/1021/*.json', async route => {
    await pending; await route.fallback();
  });
  try {
    await page.goto('/viewer/?collection=fonscec&id=1021');
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Carregant les anotacions');
    await page.locator('#paragraphs').check();
    await expect(page.locator('#transcription')).toHaveText('Carregant els paràgrafs…');
    await expect(page.locator('#retry-annotations')).toBeHidden();
    release();
    await expect(page.locator('#paragraph-count')).toHaveText('1');
    await expect(page.locator('.paragraph-box')).toHaveCount(1);
    await expect(page.locator('#status')).toContainText('Activa les capes');
  } finally { release(); }
});

test('category filters hide mountains, isolate compass roses and preserve selections', async ({ page }) => {
  await page.route('**/static/iiif/annotations/fonscec/1021/detections.json', route => {
    const data = fixture('annotations/fonscec/1021/detections.json');
    const mountain = data.resources.find((item: any) => item.resource.source_label === 'other_objects');
    mountain.resource.source_label = 'mountain'; mountain.resource.label = 'muntanya';
    return route.fulfill({ json: data });
  });
  await page.goto('/viewer/?collection=fonscec&id=1021');
  await expect(page.locator('#detection-count')).toHaveText('4');
  await expect(page.locator('#categories')).toBeEnabled();
  await page.locator('#detections').uncheck();
  await expect(page.locator('#categories')).toBeDisabled();
  await page.locator('#detections').check();
  await expect(page.locator('.detection-box')).toHaveCount(4);
  await page.locator('#categories').click();
  await expect(page.locator('#category-list input')).toHaveCount(4);
  await expect(page.locator('#category-list')).not.toContainText('Altres objectes');
  await page.getByRole('checkbox', { name: 'Muntanya', exact: true }).uncheck();
  await expect(page.locator('.detection-box')).toHaveCount(3);
  await expect(page.locator('#category-count')).toHaveText('3/4');
  await expect(page.locator('#detection-count')).toHaveText('3/4');
  await page.getByRole('button', { name: 'Mostra només: rosa dels vents', exact: true }).click();
  await expect(page.locator('.detection-box')).toHaveCount(1);
  await expect(page.locator('.detection-label')).toHaveText('rosa dels vents');
  await expect(page.locator('#category-count')).toHaveText('1/4');
  await page.locator('#detections').uncheck();
  await expect(page.locator('#category-filter')).toBeHidden();
  await page.locator('#detections').check();
  await expect(page.locator('.detection-box')).toHaveCount(1);
  await page.locator('#categories').click();
  await page.locator('#categories-all').click();
  await expect(page.locator('.detection-box')).toHaveCount(4);
  await page.locator('#categories-none').click();
  await expect(page.locator('.detection-box,.detection-label')).toHaveCount(0);
  await expect(page.locator('#detection-count')).toHaveText('0/4');
  await page.reload();
  await expect(page.locator('#detections')).toBeChecked();
  await expect(page.locator('#category-count')).toHaveText('4/4');
});

test('hover highlights a detection while dragging across it still pans the map', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=308');
  await page.locator('#detections').check();
  const box = page.locator('.detection-box');
  await expect(box).toHaveCount(1);
  const normal = await box.evaluate(node => getComputedStyle(node).backgroundColor);
  await box.hover();
  await expect.poll(() => box.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(normal);
  const before = (await box.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 45, before.y + before.height / 2 - 25, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await box.boundingBox())!.x - before.x)).toBeGreaterThan(20);
  await page.mouse.move(5, 5);
  await expect.poll(() => box.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(normal);
});

test('a viewer retained for back/forward navigation stays usable', async ({ page }) => {
  await page.goto('/viewer/?collection=fonscec&id=308');
  await expect(page.locator('#detection-count')).toHaveText('1');
  await page.locator('#detections').check();
  const box = page.locator('.detection-box');
  const before = (await box.boundingBox())!;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.locator('#zoom-in').click();
  await expect.poll(async () => Math.abs((await box.boundingBox())!.width / before.width - 1.5)).toBeLessThan(.03);
});
