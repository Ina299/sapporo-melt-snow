"""Bundle observed daily snowfall, without inventing local capacities or routes."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    rows = json.loads((ROOT/'data/processed/weather_daily.json').read_text(encoding='utf-8'))
    meta = json.loads((ROOT/'data/processed/weather_summary.json').read_text(encoding='utf-8'))
    stations = {}
    for row in rows:
        if row['kind'] == 'snowfall':
            stations.setdefault(row['station'], []).append(dict(date=row['date'], cm=row['value_cm']))
    data = dict(period=meta['period'], weather_notes=meta['notes'], stations=stations,
        source_url=meta['source_url'], source_file='data/processed/weather_daily.json',
        scope='選択観測点の実降雪×仮定した道路面積。市全域や行政区全体の排雪量ではない。',
        sources=[
            dict(title='札幌市：新雪除雪の説明', url='https://www.city.sapporo.jp/kensetsu/yuki/josetsu_info.html'),
            dict(title='札幌市：雪対策施設', url='https://www.city.sapporo.jp/kensetsu/yuki/yukishisetsu/index.html'),
            dict(title='札幌市：雪堆積場の受入条件', url='https://www.city.sapporo.jp/kensetsu/yuki/taisekijou/index.html'),
        ])
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    (ROOT/'data/processed/snow_management.json').write_text(text, encoding='utf-8')
    (ROOT/'web/snow-data.js').write_text('window.SNOW_DATA = '+text+';', encoding='utf-8')
    print(f'Bundled {len(stations)} stations; daily snowfall only')

if __name__ == '__main__':
    main()
