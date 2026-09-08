"""Uniform grid (substation / transmission line) and IX evaluation for every DC candidate.

Sources (all public, saved with SHA-256):
- HEPCO Network demand-side capacity map layers: substations (SWSS), transmission lines (NDI),
  industrial parks (MLIT L05 national land numerical information as republished by HEPCO)
- H-IX data center location page (public address)
- OpenStreetMap power=substation objects via Overpass (ODbL)
Distances are straight-line from the candidate's representative point. They are not cable routes,
not connection offers, and the capacity codes are the map's public categories, not a quotation.
"""
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
import requests
from shapely.geometry import shape, Point, LineString, MultiLineString

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/grid_ix'
UA = {'User-Agent': 'sapporo-melt-snow research (public data evaluation)'}
BBOX = (42.90, 141.10, 43.30, 141.65)  # south, west, north, east: Sapporo and near suburbs
SOURCES = {
    'hepco_substations': 'https://hello.hepco.co.jp/wp-content/uploads/geojson/SWSS_260407.geojson',
    'hepco_lines': 'https://hello.hepco.co.jp/wp-content/uploads/geojson/NDI_ALL_Hokkaido_260611b.geojson',
    'hepco_industrial_parks': 'https://hello.hepco.co.jp/wp-content/uploads/geojson/qgis_kogyo_danchi1.geojson',
    'hix_location': 'https://www.h-ix.jp/location/',
}
OVERPASS = 'https://overpass-api.de/api/interpreter'
OSM_QUERY = ('[out:json][timeout:120];(node["power"="substation"]({b});way["power"="substation"]({b});'
             'relation["power"="substation"]({b}););out center;').format(b=','.join(map(str, BBOX)))
# Public IX facts. JPNAP Sapporo POP is inside NTT East Hokkaido No.2 DC whose address is not published.
IX_POINTS = [
    dict(id='hix', name='H-IXデータセンター（北海道インターネット・エクスチェンジ）', address='札幌市中央区大通東3丁目4', query='札幌市中央区大通東3丁目4',
         source_url=SOURCES['hix_location'], note='ほくでん情報テクノロジー運営。住所は公式サイトで公開。ポート空き・料金・接続条件は未照会。'),
    dict(id='jpnap_sapporo', name='JPNAP札幌（NTT東日本 北海道第2データセンター内）', address=None, query=None,
         source_url='https://www.jpnap.net/ix/pop', note='POP所在ビルの住所は非公開。距離は算出しない。100G/10G/1G掲載、400Gは要照会。'),
]
RANK_TEXT = ["要照会", "要照会", "要照会", "5～9MW", "10～29MW", "30～49MW", "50～99MW", "100～299MW", "300～499MW", "500～ MW", "1000～ MW"]

def rank_of(ord_cur, crg_ctrl=None):
    """Port of getRankOfMv from HEPCO's public map script (main_gis_config.js)."""
    if ord_cur is None or crg_ctrl in (1, True): return 1
    if ord_cur == 0: return 0
    v = float(ord_cur)
    for limit, rank in [(4, 2), (10, 3), (30, 4), (50, 5), (100, 6), (300, 7), (500, 8)]:
        if v <= limit: return rank
    return 9 if v < 1000 else 10

def capacity_label(ord_cur, crg_ctrl=None):
    return RANK_TEXT[rank_of(ord_cur, crg_ctrl)]

def km(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))

def local_xy(lon, lat, lat0=43.06):
    return ((lon - 141.35) * 111.32 * math.cos(math.radians(lat0)), (lat - lat0) * 110.57)

def in_bbox(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]

def fetch(name, url, suffix):
    RAW.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, headers=UA, timeout=120)
    r.raise_for_status()
    path = RAW / f'{name}{suffix}'
    path.write_bytes(r.content)
    return dict(id=name, url=url, path=path.relative_to(ROOT).as_posix(), retrieved_at=datetime.now(timezone.utc).isoformat(),
                sha256=hashlib.sha256(r.content).hexdigest()), r.content

def fetch_osm():
    r = None
    for endpoint in [OVERPASS, 'https://overpass.kumi.systems/api/interpreter', OVERPASS]:
        r = requests.post(endpoint, data={'data': OSM_QUERY}, headers=UA, timeout=180)
        if r.status_code == 200: break
        print('overpass', endpoint, r.status_code, file=sys.stderr)
    r.raise_for_status()
    path = RAW / 'osm_substations.json'
    path.write_bytes(r.content)
    (RAW / 'osm_substations_query.txt').write_text(OSM_QUERY, encoding='utf-8')
    return dict(id='osm_substations', url=OVERPASS, query=OSM_QUERY, path=path.relative_to(ROOT).as_posix(),
                retrieved_at=datetime.now(timezone.utc).isoformat(), sha256=hashlib.sha256(r.content).hexdigest(),
                license='ODbL 1.0 © OpenStreetMap contributors'), r.json()

def geocode(query):
    cache_path = ROOT / 'data/raw/dc/geocoding.json'
    cache = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    if query not in cache:
        r = requests.get('https://msearch.gsi.go.jp/address-search/AddressSearch', params={'q': query}, timeout=30)
        r.raise_for_status()
        cache[query] = dict(query=query, results=r.json(), source_url=r.url, retrieved_at=datetime.now(timezone.utc).isoformat())
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
    hits = cache[query]['results']
    if len(hits) != 1: raise ValueError(f'{query}: {len(hits)} geocoding results')
    lon, lat = hits[0]['geometry']['coordinates']
    return lat, lon, cache[query]['source_url']

def main():
    manifest = []
    m, raw_ss = fetch('hepco_substations', SOURCES['hepco_substations'], '.geojson'); manifest.append(m)
    m, raw_lines = fetch('hepco_lines', SOURCES['hepco_lines'], '.geojson'); manifest.append(m)
    m, raw_parks = fetch('hepco_industrial_parks', SOURCES['hepco_industrial_parks'], '.geojson'); manifest.append(m)
    m, _ = fetch('hix_location', SOURCES['hix_location'], '.html'); manifest.append(m)
    m, osm = fetch_osm(); manifest.append(m)

    substations = []
    for f in json.loads(raw_ss)['features']:
        p = f['properties']
        if p.get('lat') is None or p.get('lon') is None or not in_bbox(p['lat'], p['lon']): continue
        substations.append(dict(name=p['変電所名'], primary_kv=p['一次側'], secondary_kv=p['二次側'], type=p['Type'],
                                capacity_code=p['空容量'], capacity_label=capacity_label(p['空容量']) if p['空容量'] else '要照会',
                                lat=p['lat'], lon=p['lon'], source='hepco_substations'))
    lines = []
    for f in json.loads(raw_lines)['features']:
        p = f['properties']; g = shape(f['geometry'])
        minx, miny, maxx, maxy = g.bounds
        if maxy < BBOX[0] or miny > BBOX[2] or maxx < BBOX[1] or minx > BBOX[3]: continue
        if p.get('Voltage') is None or float(p['Voltage']) < 66 or g.is_empty: continue
        lines.append(dict(name=p['Name'], voltage_kv=float(p['Voltage']), ord_cur=p.get('N_OrdCur'), crg_ctrl=p.get('N_crgCtrl'),
                          capacity_label=capacity_label(p.get('N_OrdCur'), p.get('N_crgCtrl')), geometry=f['geometry'], _shape=g))
    parks = []
    for f in json.loads(raw_parks)['features']:
        p = f['properties']; g = shape(f['geometry']); c = g.centroid
        if not in_bbox(c.y, c.x): continue
        parks.append(dict(name=p['L05_002'], municipality=p['L05_004'], area_ha=p.get('L05_010'), sold_ha=p.get('L05_011'),
                          year=p.get('L05_009'), note=p.get('L05_006'), lat=c.y, lon=c.x, geometry=f['geometry'], _shape=g))
    osm_ss = []
    for e in osm['elements']:
        t = e.get('tags', {}); c = e.get('center', {'lat': e.get('lat'), 'lon': e.get('lon')})
        if c.get('lat') is None: continue
        osm_ss.append(dict(osm_id=f"{e['type']}/{e['id']}", name=t.get('name'), voltage=t.get('voltage'), operator=t.get('operator'),
                           substation=t.get('substation'), lat=c['lat'], lon=c['lon']))
    ix_points = []
    for ix in IX_POINTS:
        row = dict(ix)
        if ix['query']:
            lat, lon, src = geocode(ix['query']); row.update(lat=lat, lon=lon, geocode_source_url=src)
        else:
            row.update(lat=None, lon=None)
        ix_points.append(row)

    def eval_point(lat, lon):
        pt = (lon, lat); px, py = local_xy(lon, lat)
        def nearest(rows, pred=lambda r: True):
            cands = [(km(pt, (r['lon'], r['lat'])), r) for r in rows if pred(r)]
            return min(cands, key=lambda x: x[0]) if cands else None
        out = {}
        for key, pred in [('nearest_substation_187kv', lambda r: r['primary_kv'] and float(r['primary_kv']) >= 187 and r['type'] == 'SS'),
                          ('nearest_substation_66kv', lambda r: r['primary_kv'] and float(r['primary_kv']) == 66 and r['type'] == 'SS')]:
            n = nearest(substations, pred)
            out[key] = dict(name=n[1]['name'], distance_km=round(n[0], 2), primary_kv=n[1]['primary_kv'], secondary_kv=n[1]['secondary_kv'],
                            capacity_label=n[1]['capacity_label'], capacity_code=n[1]['capacity_code']) if n else None
        out['substations_within_3km'] = sorted([dict(name=r['name'], distance_km=round(km(pt, (r['lon'], r['lat'])), 2), primary_kv=r['primary_kv'],
                                                     secondary_kv=r['secondary_kv'], capacity_label=r['capacity_label'])
                                                for r in substations if r['type'] == 'SS' and km(pt, (r['lon'], r['lat'])) <= 3], key=lambda r: r['distance_km'])
        out['nearest_lines'] = {}
        for cls, pred in [('66', lambda v: v == 66), ('187', lambda v: 100 <= v < 275), ('275', lambda v: v >= 275)]:
            best = None
            for ln in lines:
                if not pred(ln['voltage_kv']): continue
                # local planar distance (km) from candidate to the line geometry
                geom = ln['_shape']
                parts = [part for part in (geom.geoms if isinstance(geom, MultiLineString) else [geom]) if len(part.coords) >= 2]
                if not parts: continue
                d = min(LineString([local_xy(x, y) for x, y, *_ in part.coords]).distance(Point(px, py)) for part in parts)
                if best is None or d < best[0]: best = (d, ln)
            out['nearest_lines'][cls] = dict(name=best[1]['name'], distance_km=round(best[0], 2), capacity_label=best[1]['capacity_label'], ord_cur=best[1]['ord_cur']) if best else None
        n = nearest(osm_ss, lambda r: r['name'])
        out['nearest_osm_substation'] = dict(name=n[1]['name'], voltage=n[1]['voltage'], distance_km=round(n[0], 2), osm_id=n[1]['osm_id']) if n else None
        out['ix'] = [dict(id=ix['id'], name=ix['name'], distance_km=round(km(pt, (ix['lon'], ix['lat'])), 2) if ix['lat'] is not None else None, note=ix['note']) for ix in ix_points]
        bestp = None
        for pk in parks:
            d = pk['_shape'].distance(Point(lon, lat))  # degrees; refine with centroid km if inside
            dk = 0.0 if pk['_shape'].contains(Point(lon, lat)) else km(pt, (pk['lon'], pk['lat']))
            if bestp is None or dk < bestp[0]: bestp = (dk, pk)
        out['nearest_industrial_park'] = dict(name=bestp[1]['name'], municipality=bestp[1]['municipality'], distance_km=round(bestp[0], 2),
                                              area_ha=bestp[1]['area_ha'], sold_ha=bestp[1]['sold_ha'], year=bestp[1]['year']) if bestp else None
        return out

    dc_path = ROOT / 'data/processed/dc_feasibility.json'
    dc = json.loads(dc_path.read_text(encoding='utf-8'))
    evaluations = []
    for c in dc['candidates']:
        ev = eval_point(c['latitude'], c['longitude'])
        c['grid_ix'] = ev
        evaluations.append(dict(id=c['id'], name=c['name'], **ev))
    dc['grid_ix_method'] = ('直線距離による一律評価。変電所・送電線はほくでんネットワーク公開マップの2026年版レイヤー、IXは公開住所、工業団地は国土数値情報L05。'
                            '容量表示は公開マップの区分（要照会＝公開値なし）で、接続可否・供給枠・工事費・引込み経路ではない。'
                            '公開マップ上の変電所は全て要照会表示のため、変電所の区分はデータ内コードの参考値。')
    dc_path.write_text(json.dumps(dc, ensure_ascii=False, indent=2), encoding='utf-8')

    out = dict(as_of=datetime.now(timezone.utc).date().isoformat(), bbox=BBOX, method=dc['grid_ix_method'],
               substations=substations, osm_substations=osm_ss, ix_points=ix_points,
               lines=[{k: v for k, v in ln.items() if k != '_shape'} for ln in lines],
               industrial_parks=[{k: v for k, v in pk.items() if k != '_shape'} for pk in parks],
               evaluations=evaluations,
               notes=['距離は代表点からの直線距離。ケーブル経路・道路占用・河川横断は未評価。',
                      '10MW超の需要は需要側接続の事前相談対象。相談は未送信。',
                      '66kV配電用変電所からの受電可否は個別照会が必要。二次側6.6kVのみの変電所から特高受電はできない。',
                      'JPNAP札幌のPOP所在ビル住所は非公開のため距離を算出していない。'])
    (ROOT / 'data/processed/dc_grid_ix.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    web = dict(substations=substations, ix_points=[ix for ix in ix_points if ix['lat'] is not None],
               lines=[dict(name=ln['name'], voltage_kv=ln['voltage_kv'], capacity_label=ln['capacity_label'], geometry=ln['geometry']) for ln in lines],
               industrial_parks=[dict(name=pk['name'], municipality=pk['municipality'], area_ha=pk['area_ha'], sold_ha=pk['sold_ha'], geometry=pk['geometry']) for pk in parks],
               method=dc['grid_ix_method'], as_of=out['as_of'])
    (ROOT / 'web/grid-data.js').write_text('window.SAPPORO_GRID = ' + json.dumps(web, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')
    (ROOT / 'data/grid_ix_sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'substations {len(substations)}, lines {len(lines)}, parks {len(parks)}, osm substations {len(osm_ss)}, candidates {len(evaluations)}')
    for e in evaluations:
        print(f"  {e['name'][:22]:22s} 187kV SS {e['nearest_substation_187kv']['name']} {e['nearest_substation_187kv']['distance_km']}km | 66kV SS {e['nearest_substation_66kv']['name']} {e['nearest_substation_66kv']['distance_km']}km | H-IX {e['ix'][0]['distance_km']}km | 団地 {e['nearest_industrial_park']['name']} {e['nearest_industrial_park']['distance_km']}km")

if __name__ == '__main__':
    main()
