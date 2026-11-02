import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { createServer } from 'vite';

test('file group preview preserves selection and safely downloads and deletes selected files', async () => {
  const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
  await vite.listen();
  const address = vite.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, theme] of [[1100, 'light'], [390, 'dark'], [320, 'light']] as const) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, acceptDownloads: true });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${address.port}/tests/e2e/fixtures/received-file-preview.html?theme=${theme}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const row = page.getByTestId('received-group-row');
        await row.waitFor({ timeout: 60000 });
        await row.getByRole('button', { name: /预览文件组/ }).click();
        const dialog = page.getByRole('dialog').last();
        await dialog.waitFor();
        await dialog.getByText('暂不支持预览此文件').waitFor();
        await page.evaluate(() => {
          const c = (window as any).__fixture.colab;
          c.emitter.emit('file-received', { from: 'Alice:device', fileName: 'bundle.zip', fileSize: 12, file: new File(['archive'], 'bundle.zip'), fileKey: 'bundle-key' });
          c.emitter.emit('file-received', { from: 'Other:device', fileName: 'other.txt', fileSize: 5, file: new File(['other'], 'other.txt'), fileKey: 'other-key' });
        });
        assert.equal(await page.getByTestId('received-file-row').count(), 0);
        assert.equal(await dialog.getByTestId('preview-download-selected').isDisabled(), true);
        assert.equal(await dialog.getByTestId('preview-delete-selected').isDisabled(), true);
        const stageHeight = (await dialog.getByTestId('preview-next-zone').boundingBox())!.height;

        const a = dialog.getByRole('checkbox', { name: '选择文件: a.svg' });
        const b = dialog.getByRole('checkbox', { name: '选择文件: b.svg' });
        const same = dialog.getByRole('checkbox', { name: '选择文件: same.svg' });
        await a.check();
        await b.check();
        await same.nth(0).check();
        assert.equal(await same.nth(1).isChecked(), false);
        await same.nth(1).check();
        assert.equal(await dialog.getByText('已选择 4 项').isVisible(), true);
        assert.equal(Math.round((await dialog.getByTestId('preview-next-zone').boundingBox())!.height), Math.round(stageHeight));

        await dialog.getByRole('button', { name: /^b\.svg \(/ }).click();
        const image = dialog.getByRole('img', { name: 'b.svg' });
        await image.waitFor();
        assert.match(await dialog.getByTestId('preview-file-metadata').innerText(), /\d+ B/);
        assert.equal(await dialog.locator('img[alt]:not([alt=""])').count(), 1);
        const imageBox = (await image.boundingBox())!;
        const left = (await dialog.getByTestId('preview-previous-zone').boundingBox())!;
        const right = (await dialog.getByTestId('preview-next-zone').boundingBox())!;
        await image.click();
        assert.equal(await dialog.getByRole('img', { name: 'b.svg' }).count(), 1);
        await dialog.getByTestId('preview-next-zone').click({ position: {
          x: Math.min(right.width - 2, Math.max(2, imageBox.x + imageBox.width - right.x + 8)), y: Math.round(right.height / 2),
        } });
        await dialog.getByRole('img', { name: 'a.svg' }).waitFor();
        await dialog.getByTestId('preview-previous-zone').click({ position: {
          x: Math.max(2, Math.min(left.width - 2, imageBox.x - left.x - 8)), y: Math.round(left.height / 2),
        } });
        await dialog.getByRole('img', { name: 'b.svg' }).waitFor();
        assert.equal(await a.isChecked(), true);
        assert.equal(await b.isChecked(), true);

        await dialog.getByRole('button', { name: /^notes\.txt \(/ }).click();
        await dialog.getByText('readable notes').waitFor();
        assert.equal(await a.isChecked(), true);
        await dialog.getByRole('button', { name: /^report\.docx \(/ }).click();
        await dialog.getByText('暂不支持预览此文件').waitFor();
        await dialog.getByRole('button', { name: /^b\.svg \(/ }).click();
        await dialog.getByRole('img', { name: 'b.svg' }).waitFor();

        await dialog.getByTestId('preview-download-selected').click();
        const save = dialog.getByTestId('preview-save-download');
        await save.waitFor();
        const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
        const path = await download.path();
        assert.ok(path);
        const zip = await JSZip.loadAsync(await readFile(path));
        assert.deepEqual(Object.keys(zip.files).sort(), ['a.svg', 'b.svg', 'same (2).svg', 'same.svg']);

        await b.uncheck();
        await same.nth(1).uncheck();
        page.once('dialog', prompt => void prompt.dismiss());
        await dialog.getByTestId('preview-delete-selected').click();
        assert.equal(await a.isChecked(), true);
        assert.equal(await page.evaluate(() => (window as any).__fixture.blobs.hasFile('key-0')), true);

        await page.evaluate(() => {
          const f = (window as any).__fixture;
          f.originalDelete = f.integration.deleteMessage.bind(f.integration);
          f.integration.deleteMessage = (user: string, id: string) => id === f.ids['two/same.svg']
            ? Promise.resolve({ success: false, error: 'test failure' }) : f.originalDelete(user, id);
        });
        page.once('dialog', prompt => void prompt.accept());
        await dialog.getByTestId('preview-delete-selected').click();
        await a.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => (window as any).__fixture.blobs.hasFile('key-0')), false);
        assert.equal(await page.locator('a[download^="letshare_"]').count(), 0);
        assert.equal(await same.count(), 2);
        assert.equal(await same.nth(0).isChecked(), true);
        await page.evaluate(() => { const f = (window as any).__fixture; f.integration.deleteMessage = f.originalDelete; });
        page.once('dialog', prompt => void prompt.accept());
        await dialog.getByTestId('preview-delete-selected').click();
        await page.waitForFunction(() => document.querySelectorAll('[aria-label="选择文件: same.svg"]').length === 1);
        assert.equal(await page.evaluate(() => (window as any).__fixture.blobs.hasFile('key-1')), true);
        assert.equal(await page.evaluate(async () => Number(await (window as any).__fixture.blobs.hasFile('key-5')) + Number(await (window as any).__fixture.blobs.hasFile('key-6'))), 1);
        assert.equal(await dialog.getByRole('img', { name: 'b.svg' }).count(), 1);

        await dialog.getByTestId('preview-select-all').getByRole('checkbox').check();
        page.once('dialog', prompt => void prompt.accept());
        await dialog.getByTestId('preview-delete-selected').click();
        await dialog.waitFor({ state: 'hidden' });
        await row.waitFor({ state: 'detached' });
        const notices = page.getByRole('region', { name: '本次接收' });
        const bundleNotice = notices.getByText('bundle.zip', { exact: true }).locator('../..');
        const otherNotice = notices.getByText('other.txt', { exact: true }).locator('../..');
        assert.equal(await bundleNotice.getByRole('button', { name: '下载' }).isDisabled(), true);
        assert.equal(await otherNotice.getByRole('button', { name: '下载' }).isEnabled(), true);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
    const chatContext = await browser.newContext();
    try {
      const page = await chatContext.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/tests/e2e/fixtures/received-file-preview.html?chat=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('button', { name: 'Text fixture' }).click();
      const dialog = page.getByRole('dialog').last();
      await dialog.getByText('chat preview text').waitFor();
      await dialog.locator('button:has(svg[data-testid="CloseIcon"])').click();
      assert.equal(await dialog.getByText('chat preview text').count(), 1);
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Word fixture' }).click();
      await page.getByRole('dialog').last().getByText('暂不支持预览此文件').waitFor();
    } finally {
      await chatContext.close();
    }
  } finally {
    await browser.close();
    await vite.close();
  }
});
