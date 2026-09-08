"""Encode web geometry as node-index lists over one shared coordinate table.

Roads and routes reuse the same road vertices, so instead of repeating coordinates in
web/city-data.js and the two dispatch bundles, every line is stored as a list of indices
into web/nodes-data.js (integer lon/lat offsets, 1e-6 degrees). The processed JSON files in
data/processed keep plain GeoJSON coordinates; only the browser bundles are encoded, and
web/app.js decodes them back to GeoJSON on load.
"""
import json
from pathlib import Path
from shapely.geometry import shape, Point
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/processed'
WEB = ROOT / 'web'
LON0, LAT0, SCALE = 140.9, 42.7, 1_000_000

class NodeTable:
    def __init__(self):
        self.index = {}
        self.xy = []
    def idx(self, lon, lat):
        key = (round(lon * SCALE), round(lat * SCALE))
        i = self.index.get(key)
        if i is None:
            i = len(self.xy) // 2
            self.index[key] = i
            self.xy.extend((key[0] - round(LON0 * SCALE), key[1] - round(LAT0 * SCALE)))
        return i
    def line(self, coords):
        return [self.idx(x, y) for x, y in coords]

def encode_feature(nodes, f):
    """[service_flag, idx, idx, ...] for a LineString feature of a trip/route part."""
    return [1 if f['properties'].get('service') else 0] + nodes.line(f['geometry']['coordinates'])

def encode_dispatch(nodes, data):
    for c in data['companies']:
        for t in c['trips']:
            t['features'] = [encode_feature(nodes, f) for f in t['features']]
            t['incoming_features'] = [encode_feature(nodes, f) for f in t.get('incoming_features', [])]
        for s in c['scenarios']:
            for r in s['routes']:
                r['head_features'] = [encode_feature(nodes, f) for f in r.get('head_features', [])]
                r['tail_features'] = [encode_feature(nodes, f) for f in r.get('tail_features', [])]
                r['incoming_features'] = [[encode_feature(nodes, f) for f in inc] for inc in r.get('incoming_features', [])]
                for sh in r.get('shifts', []):
                    sh['head_features'] = [encode_feature(nodes, f) for f in sh.get('head_features', [])]
                    sh['tail_features'] = [encode_feature(nodes, f) for f in sh.get('tail_features', [])]
            if s.get('trips'):
                for t in s['trips']:
                    t['features'] = [encode_feature(nodes, f) for f in t['features']]
                    t['incoming_features'] = [encode_feature(nodes, f) for f in t.get('incoming_features', [])]
    ug = data['unassigned_geometry']
    reasons = {f['properties'].get('reason') for f in ug['features']}
    data['unassigned_geometry'] = dict(reason=next(iter(reasons)) if len(reasons) == 1 else None,
                                       features=[[f['properties'].get('task_id'), f['properties'].get('reason') if len(reasons) != 1 else None] + nodes.line(f['geometry']['coordinates'])
                                                 for f in ug['features']])
    data['geometry'] = 'nodes'
    return data

def encode_roads(nodes, roads, city_poly):
    out = []
    for f in roads['features']:
        p = f['properties']
        flat = []
        for seg in f['geometry']['coordinates']:  # MultiLineString of 2-point segments
            flat.extend(nodes.line(seg))
        seg0 = f['geometry']['coordinates'][0]
        mid = Point((seg0[0][0] + seg0[-1][0]) / 2, (seg0[0][1] + seg0[-1][1]) / 2)
        out.append([p['way_id'], p.get('name'), 1 if p.get('included') else 0, 1 if city_poly.contains(mid) else 0, flat])
    return out

def dump_js(path, var, obj):
    path.write_text(f'window.{var} = ' + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')

def main():
    nodes = NodeTable()
    load = lambda p: json.loads((OUT / p).read_text(encoding='utf-8'))
    city = load('city_analysis.json'); roads = load('city_roads.geojson')
    boundary = load('sapporo_boundary.geojson')
    city_poly = prep(shape(boundary['geometry'] if boundary.get('type') == 'Feature' else boundary['features'][0]['geometry']))
    dump_js(WEB / 'city-data.js', 'SAPPORO_CITY', dict(summary=city, geometry='nodes', roads_enc=encode_roads(nodes, roads, city_poly)))
    for prefix, var, name in [('dispatch', 'CONTRACTOR_ROUTES', 'dispatch-data.js'), ('joint_dispatch', 'JOINT_ROUTES', 'joint-dispatch-data.js')]:
        dump_js(WEB / name, var, encode_dispatch(nodes, load(prefix + '.json')))
    dump_js(WEB / 'nodes-data.js', 'SAPPORO_NODES', dict(lon0=LON0, lat0=LAT0, scale=SCALE, xy=nodes.xy))
    sizes = {n: round((WEB / n).stat().st_size / 1e6, 1) for n in ['nodes-data.js', 'city-data.js', 'dispatch-data.js', 'joint-dispatch-data.js']}
    print('nodes', len(nodes.xy) // 2, 'sizes MB', sizes)

if __name__ == '__main__':
    main()
