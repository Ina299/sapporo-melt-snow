"""OSM administrative boundary overlay; preserve source and retrieval metadata."""
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
import requests
from shapely.geometry import LineString,mapping,Point
from shapely.ops import polygonize,unary_union
ROOT=Path(__file__).resolve().parents[1]
def main():
    path=ROOT/'data/raw/sapporo_boundary.json'
    if not path.exists():
        query='[out:json][timeout:90];rel[boundary=administrative][name="札幌市"];out geom;'
        r=requests.get('https://overpass-api.de/api/interpreter',params={'data':query},headers={'User-Agent':'SapporoSnowLab/0.1 github.com/Ina299/sapporo-melt-snow'},timeout=120)
        r.raise_for_status();j=json.loads(r.content)
        if j.get('remark'):raise ValueError(j['remark'])
        path.write_bytes(r.content)
        (ROOT/'data/boundary_source.json').write_text(json.dumps(dict(url=r.url,query=query,retrieved_at=datetime.now(timezone.utc).isoformat(),sha256=hashlib.sha256(r.content).hexdigest(),license='ODbL 1.0'),indent=2),encoding='utf-8')
    j=json.loads(path.read_bytes())
    rels=[r for r in j['elements'] if r.get('tags',{}).get('name')=='札幌市']
    if len(rels)!=1:raise ValueError('Ambiguous municipality boundary')
    lines=[LineString([(p['lon'],p['lat']) for p in m['geometry']]) for m in rels[0]['members'] if m.get('role')=='outer' and m.get('geometry')]
    polys=list(polygonize(unary_union(lines)))
    if not polys:raise ValueError('Boundary not closed')
    boundary=unary_union(polys)
    companies=json.loads((ROOT/'data/processed/contractors.json').read_text(encoding='utf-8'))
    checks=[dict(id=c['id'],name=c['name'],inside_sapporo=boundary.covers(Point(c['longitude'],c['latitude']))) for c in companies]
    feature=dict(type='Feature',properties=dict(name='札幌市境（OSM）',relation_id=rels[0]['id']),geometry=mapping(boundary))
    data=dict(boundary=feature,companies=checks,scope='作業対象は市境で切り抜いていない矩形。市外道路・市外DC候補地も含む。')
    (ROOT/'data/processed/sapporo_boundary.geojson').write_text(json.dumps(feature,ensure_ascii=False),encoding='utf-8')
    (ROOT/'web/boundary-data.js').write_text('window.SAPPORO_BOUNDARY = '+json.dumps(data,ensure_ascii=False)+';',encoding='utf-8')
    print(checks)
if __name__=='__main__':main()
