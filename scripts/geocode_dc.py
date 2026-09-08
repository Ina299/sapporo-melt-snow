"""Map investigation districts using cached GSI representative address points."""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
QUERIES = {
    'central1': '石狩市新港中央1丁目',
    'zenibako4': '小樽市銭函4丁目',
    'south2': '石狩市新港南2丁目',
    'shinkawa': '札幌市北区新川西1条1丁目',
    'yonesato': '札幌市白石区東米里',
}

def locate(candidates):
    path = ROOT/'data/raw/dc/geocoding.json'
    cache = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    for row in candidates:
        query = QUERIES[row['id']]
        if query not in cache:
            r = requests.get('https://msearch.gsi.go.jp/address-search/AddressSearch', params={'q': query}, timeout=30)
            r.raise_for_status()
            cache[query] = dict(query=query, results=json.loads(r.content), source_url=r.url,
                                retrieved_at=datetime.now(timezone.utc).isoformat())
            path.write_text(json.dumps(cache,ensure_ascii=False,indent=2),encoding='utf-8')
        entry = cache[query]
        hits = entry['results']
        row.update(latitude=None, longitude=None, map_address=query,
                   geocode_source_url=entry['source_url'],
                   location_status='調査地区の代表点。売地区画・敷地境界・入口を示すものではありません。')
        if len(hits) == 1:
            row['longitude'], row['latitude'] = hits[0]['geometry']['coordinates']
            row['geocoded_title'] = hits[0]['properties']['title']
        else:
            raise ValueError(f'{query}: {len(hits)} geocoding results; manual review required')
    return candidates

if __name__ == '__main__':
    path = ROOT/'data/processed/dc_feasibility.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    locate(data['candidates'])
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    with (ROOT/'data/processed/dc_candidates.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer = csv.DictWriter(f,fieldnames=data['candidates'][0].keys())
        writer.writeheader(); writer.writerows(data['candidates'])
    print('Geocoded', len(data['candidates']), 'investigation district points')
