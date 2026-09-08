"""Fetch primary sources, keeping byte snapshots and provenance."""
import concurrent.futures
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'
SOURCES = {
    'procurement_2026': 'https://www.city.sapporo.jp/kensetsu/yuki/jigyosha/nyusatsu.html',
    'snow_facilities': 'https://www.city.sapporo.jp/gesui/01yakuwari/03_genkyo07-2.html',
    'water_plants': 'https://www.city.sapporo.jp/gesui/01yakuwari/03_genkyo10.html',
    'members': 'https://sapporo-josetsu.jp/member.html',
    'toyo': 'https://toyoroad.co.jp/about/',
    'snow_energy': 'https://www.city.sapporo.jp/kankyo/energy/shokai/snowiceenergy.html',
    'krs': 'https://www.krs-sapporo.co.jp/business/',
    'satsuichi_fleet': 'https://www.satsuichi.co.jp/engineering/',
    'satsuichi_office': 'https://www.satsuichi.co.jp/about/',
    'kashima': 'https://kashimahodou.jp/',
    'new_melting': 'https://www.city.sapporo.jp/kensetsu/yuki/new/torikumi05.html',
    'sewer_plan': 'https://www.city.sapporo.jp/gesui/keieiplan/documents/honsyo_all.pdf',
}

def fetch(item):
    key, url = item
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    ext = '.pdf' if '.pdf' in url else '.html'
    path = RAW / (key + ext)
    path.write_bytes(response.content)
    if ext == '.pdf':
        body = '\n'.join(p.extract_text(extraction_mode='layout') or '' for p in PdfReader(path).pages)
    else:
        response.encoding = response.apparent_encoding
        body = BeautifulSoup(response.text, 'html.parser').get_text(' ', strip=True)
    path.with_suffix('.txt').write_text(body, encoding='utf-8')
    return dict(id=key, url=url, retrieved_at=datetime.now(timezone.utc).isoformat(),
                sha256=hashlib.sha256(response.content).hexdigest(), path=str(path.relative_to(ROOT)))

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(fetch, SOURCES.items()))
    extra = {}
    for key in ['procurement_2026', 'snow_facilities']:
        soup = BeautifulSoup((RAW / (key+'.html')).read_bytes(), 'html.parser')
        for a in soup.select('a[href]'):
            title, href = a.get_text(strip=True), a['href']
            if '.pdf' in href and (key == 'snow_facilities' or any(s in title for s in ['資料3', '資料4', '資料5'])):
                extra[key+'_'+Path(href).stem] = urljoin(SOURCES[key], href)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records += list(pool.map(fetch, extra.items()))
    (ROOT/'data/sources.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(records, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
