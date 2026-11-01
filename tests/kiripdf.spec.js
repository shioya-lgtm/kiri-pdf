// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');

const fixture = name => path.join(__dirname, 'fixtures', name);

async function loadFiles(page, names) {
  await page.setInputFiles('#fileInput', names.map(fixture));
  await expect(page.locator('.paper-card').first()).toBeVisible();
}

async function fileIdByName(page, name) {
  return page.evaluate(n => state.files.find(f => f.name === n).id, name);
}

async function downloadBytes(download) {
  return fs.readFileSync(await download.path());
}

// 出力設定画面を開き、configure で設定してから出力する
async function exportSelected(page, configure = async () => {}) {
  await page.click('#exportSelectedBtn');
  await expect(page.locator('#exportModal')).toBeVisible();
  await configure();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('text=設定を適用して出力')
  ]);
  return { name: download.suggestedFilename(), bytes: await downloadBytes(download) };
}

// 出力PDFをアプリ内の PDF.js で開き、ページごとのテキストを返す
async function readPdf(page, bytes, password) {
  return page.evaluate(async ({ b64, password }) => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    try {
      const doc = await pdfjsLib.getDocument({ data, password, isEvalSupported: false }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const content = await p.getTextContent();
        pages.push({
          text: content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim(),
          items: content.items.map(item => ({ str: item.str, transform: item.transform }))
        });
      }
      return { ok: true, pages };
    } catch (err) {
      return { ok: false, error: err.name };
    }
  }, { b64: bytes.toString('base64'), password });
}

async function pageSizes(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(p => {
    const { width, height } = p.getSize();
    return { width: Math.round(width), height: Math.round(height), rotation: p.getRotation().angle };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('同梱ファイルだけで動作し、外部への通信は遮断される', async ({ page, context }) => {
  const external = [];
  context.on('request', req => {
    if (!/^(http:\/\/localhost|data:|blob:)/.test(req.url())) external.push(req.url());
  });
  await page.reload();
  await loadFiles(page, ['report.pdf', 'jp_nonembedded.pdf', 'photo_exif6.jpg']);
  await page.waitForTimeout(1000);

  const fetchResult = await page.evaluate(() =>
    fetch('https://example.com/').then(() => 'allowed', () => 'blocked'));
  expect(fetchResult).toBe('blocked');
  expect(external).toEqual([]);
});

test('選択した順（範囲選択）と白紙ページの位置どおりに出力される', async ({ page }) => {
  await loadFiles(page, ['report.pdf', 'slides.pdf']);
  await page.evaluate(id => setActiveFile(id), await fileIdByName(page, 'slides.pdf'));
  await page.fill('#pageRangeInput', '3, 1-2');
  await page.press('#pageRangeInput', 'Enter');

  const out = await exportSelected(page, async () => {
    await expect(page.locator('#exportFileName')).toHaveValue('slides_extracted');
    await page.click('text=＋ 白紙ページを追加');
    await page.evaluate(() => moveExportItem(state.selectionOrder.length - 1, 1));
  });

  expect(out.name).toBe('slides_extracted.pdf');
  const pdf = await readPdf(page, out.bytes);
  expect(pdf.pages.map(p => p.text)).toEqual([
    'Meeting Slides Page 3', '', 'Meeting Slides Page 1', 'Meeting Slides Page 2'
  ]);
  // 白紙は直前のページと同じ大きさ
  expect((await pageSizes(out.bytes))[1]).toMatchObject({ width: 960, height: 540 });
});

test('パスワードで暗号化され、通知にパスワードが表示されない', async ({ page }) => {
  await loadFiles(page, ['report.pdf']);
  await page.evaluate(() => selectCurrentScope(true));

  const out = await exportSelected(page, async () => {
    await page.check('#enablePassword');
    await page.fill('#pdfPassword', 'Test-Pass-123');
  });

  await expect(PDFDocument.load(out.bytes)).rejects.toThrow(/encrypted/i);
  expect(await readPdf(page, out.bytes, 'wrong')).toMatchObject({ ok: false, error: 'PasswordException' });
  const opened = await readPdf(page, out.bytes, 'Test-Pass-123');
  expect(opened.ok).toBe(true);
  expect(opened.pages).toHaveLength(6);
  await expect(page.locator('#toastMsg')).not.toContainText('Test-Pass-123');
});

test('回転情報付きのページは、用紙統一しても元の向きのまま出力される', async ({ page }) => {
  await loadFiles(page, ['rotated.pdf']);
  await page.evaluate(() => selectCurrentScope(true));

  const out = await exportSelected(page, async () => {
    await page.check('#enablePageResize');
  });

  expect(await pageSizes(out.bytes)).toEqual([{ width: 595, height: 842, rotation: 0 }]);
  // 元PDFは /Rotate 90 で文字が縦（上から下）に表示される。出力でも同じ向きであること
  const item = (await readPdf(page, out.bytes)).pages[0].items.find(i => i.str.includes('TOP OF LANDSCAPE'));
  expect(item).toBeTruthy();
  expect(item.transform[1]).toBeLessThan(0);
  expect(Math.abs(item.transform[0])).toBeLessThan(0.001);
});

test('ページの回転が出力に反映される', async ({ page }) => {
  await loadFiles(page, ['report.pdf']);
  const id = await fileIdByName(page, 'report.pdf');
  await page.evaluate(id => {
    rotatePage(id, 0);
    togglePageSelection(id, 0);
    togglePageSelection(id, 1);
  }, id);

  const out = await exportSelected(page);
  expect((await pageSizes(out.bytes)).map(p => p.rotation)).toEqual([90, 0]);
});

test('編集制限付きPDFは表示のみで、出力しようとすると理由を表示する', async ({ page }) => {
  await loadFiles(page, ['owner_only.pdf']);
  await expect(page.locator('#fileTabsContainer [title^="編集制限"]')).toHaveCount(1);

  await page.evaluate(() => selectCurrentScope(true));
  await page.click('#exportSelectedBtn');
  await expect(page.locator('#exportModal')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('編集制限付きのため出力できません');
});

test('全ページ分割（ZIP）と全PDF結合', async ({ page }) => {
  await loadFiles(page, ['report.pdf', 'slides.pdf']);

  const [zipDownload] = await Promise.all([page.waitForEvent('download'), page.click('text=全分割')]);
  expect(zipDownload.suggestedFilename()).toMatch(/^KiriPDF_split_\d{8}\.zip$/);
  const zip = await JSZip.loadAsync(await downloadBytes(zipDownload));
  expect(Object.keys(zip.files).filter(n => n.endsWith('.pdf'))).toHaveLength(9);

  const [mergeDownload] = await Promise.all([page.waitForEvent('download'), page.click('#mergeAllFilesBtn')]);
  expect(mergeDownload.suggestedFilename()).toMatch(/^report_merged_\d{8}\.pdf$/);
  expect(await pageSizes(await downloadBytes(mergeDownload))).toHaveLength(9);
});

test('画像はA4のPDFに変換され、写真の向き情報も反映される', async ({ page }) => {
  await loadFiles(page, ['photo_exif6.jpg', 'screen.png']);
  const files = await page.evaluate(() => state.files.map(f => ({ name: f.name, pages: f.pageCount })));
  expect(files).toHaveLength(1);
  expect(files[0].name).toMatch(/^画像_\d{8}\.pdf$/);
  expect(files[0].pages).toBe(2);

  await page.evaluate(() => selectCurrentScope(true));
  const out = await exportSelected(page);
  // 横長の画素 + EXIF 回転指定の写真は縦長A4、横長のPNGは横長A4
  expect(await pageSizes(out.bytes)).toEqual([
    { width: 595, height: 842, rotation: 0 },
    { width: 842, height: 595, rotation: 0 }
  ]);
});

test('フォント未埋め込みの日本語PDFの文字を読み取れる（CMap同梱）', async ({ page }) => {
  await loadFiles(page, ['jp_nonembedded.pdf']);
  const text = await page.evaluate(async () => {
    const pdfPage = await state.files[0].pdfDocProxy.getPage(1);
    return (await pdfPage.getTextContent()).items.map(i => i.str).join('');
  });
  expect(text).toBe('日本語テスト 校外秘');
});

test('全クリアで画面と選択状態がリセットされる', async ({ page }) => {
  await loadFiles(page, ['report.pdf', 'slides.pdf']);
  await page.evaluate(() => selectCurrentScope(true));
  await page.click('#clearAllBtn');
  await expect(page.locator('.paper-card')).toHaveCount(0);
  await expect(page.locator('#fileTabsContainer > *')).toHaveCount(0);
  await expect(page.locator('#selectedCountBadge')).toHaveText('0');
  await expect(page.locator('#emptyDropzone')).toBeVisible();
});

test('一度開けば、オフラインでも起動して使える', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await loadFiles(page, ['report.pdf']);
  await expect(page.locator('.paper-card .thumb-img').first()).toBeVisible();
});
