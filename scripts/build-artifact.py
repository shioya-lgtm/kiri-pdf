"""index.html から claude.ai アーティファクト用のページを生成する。

出力先: artifact/（git 管理外）
  artifact/index.html          ページ本体（doctype/html/head/body なし）
  artifact/vendor/pdf-lib.min.js  U+FFFD を \\uFFFD にエスケープしたコピー

アーティファクト版の違い:
  - Service Worker・インストール導線・manifest を外す
  - ダウンロードは downloads capability 経由（閲覧者の確認後に保存）
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifact'

src = (ROOT / 'index.html').read_text(encoding='utf-8')


def cut(s, start, end):
    i = s.index(start)
    j = s.index(end, i) + len(end)
    return s[i:j]


head = cut(src, '<head>', '</head>')[len('<head>'):-len('</head>')]
body_open = re.search(r'<body[^>]*class="([^"]*)"[^>]*>', src)
body = src[body_open.end():src.index('</body>')]

for pat in [r'\s*<meta charset[^>]*>', r'\s*<meta name="viewport"[^>]*>', r'\s*<!-- PWA -->',
            r'\s*<link rel="manifest"[^>]*>', r'\s*<meta name="theme-color"[^>]*>',
            r'\s*<link rel="icon"[^>]*>', r'\s*<link rel="apple-touch-icon"[^>]*>',
            r'\s*<meta name="apple-mobile-web-app[^>]*>']:
    head, n = re.subn(pat, '', head)
    assert n, pat
head, n = re.subn(r'<title>.*?</title>', '<title>KiriPDF</title>', head)
assert n == 1
head = head.replace('    :root {', '    html, body { height: 100%; }\n    body { background: #f8fafc; }\n    #kiriApp { height: 100%; }\n\n    :root {', 1)

start = body.index('    // PWA: オフライン用キャッシュ')
end = body.index('    // インストール済みアプリで')
body = body[:start] + body[end:]

override = '''
  <script>
    // artifact 版: ダウンロードは downloads capability 経由（閲覧者の確認後に保存）
    let artifactDownloadsPromise = null;

    async function downloadBlob(blob, filename) {
      if (!artifactDownloadsPromise) {
        artifactDownloadsPromise = window.claude?.use ? window.claude.use('downloads') : Promise.resolve(null);
      }
      const downloads = await artifactDownloadsPromise;
      if (!downloads) {
        showToast('この表示ではファイルを保存できません', true);
        return;
      }
      try {
        await downloads.save({ filename, data: blob });
      } catch (err) {
        const code = err && err.code;
        if (code === 'declined') showToast('保存をキャンセルしました', true);
        else if (code === 'rate_limited') showToast('保存の確認画面が開いています。閉じてから再度お試しください', true);
        else showToast(`保存できませんでした（${code || 'unknown'}）`, true);
      }
    }
  </script>
'''

page = head.strip() + '\n\n<div id="kiriApp" class="' + body_open.group(1) + '">\n' + body.rstrip() + '\n</div>\n' + override

(OUT / 'vendor').mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(page, encoding='utf-8')

pdf_lib = (ROOT / 'vendor' / 'pdf-lib.min.js').read_text(encoding='utf-8')
(OUT / 'vendor' / 'pdf-lib.min.js').write_text(pdf_lib.replace('�', '\\uFFFD'), encoding='utf-8')

print(f'wrote {OUT / "index.html"} ({len(page)} chars)')
