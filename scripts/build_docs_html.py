"""Render docs/*.md to docs/*.html for static hosting (GitHub Pages serves Markdown as plain text).

Links to sibling .md files are rewritten to .html; every other relative link is kept, so the
HTML pages can live next to the Markdown sources and reuse the same ../data and ../web paths.
"""
import re
import sys
from pathlib import Path
import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
STYLE = '''
:root{--ink:#1d2a2c;--muted:#5d6f6b;--green:#207f69;--line:#dfe6e0;--bg:#f6f8f4}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.9 "Noto Sans JP","Yu Gothic",Meiryo,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 24px 64px;background:#fff;min-height:100vh}
h1{font-size:24px;line-height:1.5;margin:0 0 20px}h2{font-size:18px;margin:36px 0 12px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:15px;margin:24px 0 8px}
a{color:var(--green)}p,li{font-size:13px}code{background:#f0f4ee;padding:1px 5px;border-radius:3px;font-size:12px}
pre{background:#f0f4ee;padding:12px 14px;border-radius:6px;overflow:auto;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{background:#f7f9f5;color:var(--muted);font-weight:500;white-space:nowrap}
img{max-width:100%;border:1px solid var(--line);border-radius:6px}
nav.docnav{font-size:12px;color:var(--muted);margin-bottom:18px}nav.docnav a{margin-right:14px}
'''

def convert(md_path: Path) -> Path:
    text = md_path.read_text(encoding='utf-8')
    # sibling markdown links -> html (keep anchors), e.g. (direct_routing.md) or (design.md#foo)
    text = re.sub(r'\]\(((?!https?://)[^)\s]*?)\.md(#[^)]*)?\)', lambda m: f']({m.group(1)}.html{m.group(2) or ""})', text)
    html = markdown.markdown(text, extensions=['tables', 'fenced_code', 'toc'], output_format='html5')
    title = re.search(r'^#\s+(.+)$', md_path.read_text(encoding='utf-8'), re.M)
    title = title.group(1).strip() if title else md_path.stem
    nav = '<nav class="docnav"><a href="../web/">画面へ戻る</a><a href="design.html">設計・調査結果</a><a href="dc_feasibility.html">DC候補地</a><a href="direct_routing.html">配車</a><a href="snow_management.html">雪収支</a><a href="../README.md">README</a></nav>'
    page = f'<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>{STYLE}</style></head>\n<body><main>{nav}{html}</main></body></html>\n'
    out = md_path.with_suffix('.html')
    out.write_text(page, encoding='utf-8')
    return out

def main():
    outs = [convert(p) for p in sorted(DOCS.glob('*.md'))]
    print('rendered', len(outs), 'docs:', ', '.join(o.name for o in outs))

if __name__ == '__main__':
    sys.exit(main())
