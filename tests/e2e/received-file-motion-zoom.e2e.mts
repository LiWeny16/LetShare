import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

const matrix = (element: Element) => {
  const transform = getComputedStyle(element).transform;
  const value = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
  return { scale: value.a, x: value.e, y: value.f };
};

test('restoration is stable and image zoom works with mouse and mobile touch', async () => {
  const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
  await vite.listen();
  const address = vite.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tests/e2e/fixtures/received-file-preview.html`;
  const browser = await chromium.launch({ headless: true });
  const openImage = async (page: Page) => {
    await page.getByTestId('received-group-row').getByRole('button', { name: /预览文件组/ }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.getByRole('button', { name: /^b\.svg \(/ }).click();
    const image = dialog.getByRole('img', { name: 'b.svg' });
    await image.waitFor();
    return { dialog, image };
  };
  try {
    const loadingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try {
      const page = await loadingContext.newPage();
      await page.goto(`${url}?slowHydration=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const loading = page.getByTestId('received-files-loading');
      await loading.waitFor({ timeout: 60000 });
      assert.match(await loading.innerText(), /正在恢复已接收文件/);
      await page.evaluate(() => {
        const colab = (window as any).__fixture.colab;
        const file = new File(['new'], 'new.txt', { type: 'text/plain' });
        colab.receivedFiles.set('Other:device::new.txt', file);
        colab.emitter.emit('file-received', { from: 'Other:device', fileName: file.name, fileSize: file.size, file });
      });
      await page.getByRole('region', { name: '本次接收' }).waitFor();
      assert.equal(await page.getByTestId('received-files-content').count(), 0);
      assert.equal(await page.getByTestId('received-file-row').count(), 0);
      await page.evaluate(() => (window as any).__fixture.resumeHydration());
      await loading.waitFor({ state: 'detached' });
      await page.getByTestId('received-group-row').waitFor({ state: 'attached' });
      assert.equal(await page.getByTestId('received-files-content').evaluate(element => getComputedStyle(element).opacity), '1');
    } finally { await loadingContext.close(); }

    const desktop = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    try {
      const page = await desktop.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const { dialog, image } = await openImage(page);
      const strip = dialog.getByTestId('preview-thumbnail-strip');
      const stripBox = (await strip.boundingBox())!;
      const items = strip.locator(':scope > div > div');
      const first = (await items.first().boundingBox())!;
      const last = (await items.last().boundingBox())!;
      assert.ok(Math.abs((first.x - stripBox.x) - (stripBox.x + stripBox.width - last.x - last.width)) < 2, 'thumbnails should be centered when they fit');

      const controls = dialog.getByTestId('preview-zoom-controls');
      assert.match(await controls.innerText(), /100%/);
      for (let i = 0; i < 4; i++) await controls.getByRole('button', { name: '放大图片' }).click();
      assert.match(await controls.innerText(), /200%/);
      await page.waitForFunction((element) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).a - 2) < 0.01, await image.elementHandle());
      const imageBox = (await image.boundingBox())!;
      const before = await image.evaluate(matrix);
      await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2 + 90, { steps: 4 });
      await page.mouse.up();
      const after = await image.evaluate(matrix);
      assert.ok(Math.abs(after.y - before.y) > 20, 'a zoomed image can be dragged');
      await controls.getByRole('button', { name: '缩小图片' }).click();
      assert.match(await controls.innerText(), /175%/);
      await dialog.getByRole('button', { name: /^a\.svg \(/ }).click();
      assert.match(await controls.innerText(), /100%/, 'switching files resets zoom');
      await controls.getByRole('button', { name: '缩小图片' }).click();
      await controls.getByRole('button', { name: '缩小图片' }).click();
      assert.match(await controls.innerText(), /50%/);
      assert.equal(await controls.getByRole('button', { name: '缩小图片' }).isDisabled(), true);
      await controls.getByRole('button', { name: '适应窗口' }).click();
      assert.match(await controls.innerText(), /100%/);
      for (let i = 0; i < 12; i++) await controls.getByRole('button', { name: '放大图片' }).click();
      assert.match(await controls.innerText(), /400%/);
      assert.equal(await controls.getByRole('button', { name: '放大图片' }).isDisabled(), true);
    } finally { await desktop.close(); }

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    try {
      const page = await mobile.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const { dialog, image } = await openImage(page);
      const controls = dialog.getByTestId('preview-zoom-controls');
      const strip = dialog.getByTestId('preview-thumbnail-strip');
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      assert.ok((await dialog.boundingBox())!.width >= 360, 'mobile preview should use the available width');
      assert.equal(await strip.evaluate(element => element.scrollWidth > element.clientWidth), true);
      const box = (await image.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const cdp = await mobile.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 30, y: center.y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 30, y: center.y, id: 1 }, { x: center.x + 30, y: center.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 60, y: center.y, id: 1 }, { x: center.x + 60, y: center.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="preview-zoom-controls"]')?.textContent?.replace('%', '')) > 150);
      assert.equal(await dialog.getByRole('img', { name: 'b.svg' }).count(), 1, 'pinch must not change the current file');
      const beforeDrag = await image.evaluate(matrix);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x, y: center.y, id: 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x, y: center.y + 80, id: 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(({ element, originalY }) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).f - originalY) > 20, { element: await image.elementHandle(), originalY: beforeDrag.y });
      assert.equal(await dialog.getByRole('img', { name: 'b.svg' }).count(), 1, 'dragging must not switch files');
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => window.innerWidth === 844 && window.innerHeight === 390);
      const landscapeStage = (await dialog.getByTestId('preview-next-zone').boundingBox())!;
      const landscapeDialog = (await dialog.boundingBox())!;
      const landscapeStrip = (await strip.boundingBox())!;
      assert.ok(landscapeStage.height >= 100, 'landscape preview should retain room for the image');
      assert.ok(landscapeStrip.y + landscapeStrip.height <= landscapeDialog.y + landscapeDialog.height + 1, 'landscape actions and thumbnails stay inside the dialog');
      assert.equal(await controls.getByRole('button', { name: '放大图片' }).isVisible(), true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => window.innerWidth === 390 && window.innerHeight === 844);
      await controls.getByRole('button', { name: '适应窗口' }).click();
      assert.match(await controls.innerText(), /100%/);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x + 45, y: center.y, id: 4 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 45, y: center.y, id: 4 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await dialog.getByRole('img', { name: 'a.svg' }).waitFor();
      await strip.getByRole('button').first().click();
      assert.equal(await dialog.getByText('暂不支持预览此文件').isVisible(), true, 'first thumbnail remains reachable');
      await strip.getByRole('button').last().click();
      assert.equal(await dialog.getByRole('img', { name: 'a.svg' }).isVisible(), true, 'last thumbnail remains reachable');
      await dialog.getByRole('button', { name: /^report\.docx \(/ }).click();
      assert.equal(await dialog.getByTestId('preview-zoom-controls').count(), 0);
    } finally { await mobile.close(); }

    const mobilePair = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await mobilePair.newPage();
      await page.goto(`${url}?twoFiles=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const { dialog } = await openImage(page);
      const strip = dialog.getByTestId('preview-thumbnail-strip');
      const stripBox = (await strip.boundingBox())!;
      const items = strip.locator(':scope > div > div');
      assert.equal(await items.count(), 2);
      const first = (await items.first().boundingBox())!;
      const last = (await items.last().boundingBox())!;
      assert.ok(Math.abs((first.x - stripBox.x) - (stripBox.x + stripBox.width - last.x - last.width)) < 2, 'two thumbnails are centered on mobile');
    } finally { await mobilePair.close(); }
  } finally {
    await browser.close();
    await vite.close();
  }
});
