"""Fetch a broad Sapporo rectangle in cached latitude bands (OSM, not official routes)."""
import argparse,hashlib,json,time
from pathlib import Path
from datetime import datetime,timezone
import requests
ROOT=Path(__file__).resolve().parents[1]
BBOX=[42.75,140.95,43.26,141.55]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--transit',action='store_true');args=parser.parse_args()
    prefix='transit' if args.transit else 'city'
    pattern='trunk|trunk_link|service' if args.transit else 'primary|secondary|tertiary|unclassified|residential|living_street|primary_link|secondary_link|tertiary_link'
    raw=ROOT/('data/raw/'+prefix);raw.mkdir(exist_ok=True)
    nodes={};ways={};sources=[]
    for i,(south,north) in enumerate(zip([42.75,42.9,43.0,43.08,43.16],[42.9,43.0,43.08,43.16,43.26])):
        query=f'[out:json][timeout:180];way[highway~"^({pattern})$"]({south},140.95,{north},141.55);out geom;'
        p=raw/f'band{i}.json';meta=raw/f'band{i}_source.json'
        if not p.exists():
            r=requests.get('https://overpass-api.de/api/interpreter',params={'data':query},headers={'User-Agent':'SapporoSnowLab/0.1 (research github.com/Ina299/sapporo-melt-snow)'},timeout=210)
            r.raise_for_status();j=json.loads(r.content)
            if j.get('remark'):raise ValueError(j['remark'])
            p.write_bytes(r.content)
            meta.write_text(json.dumps(dict(url=r.url,query=query,retrieved_at=datetime.now(timezone.utc).isoformat(),sha256=hashlib.sha256(r.content).hexdigest()),indent=2),encoding='utf-8')
        j=json.loads(p.read_bytes());sources.append(json.loads(meta.read_text(encoding='utf-8')))
        for w in j['elements']:
            if w['type']!='way':continue
            for nid,coord in zip(w['nodes'],w['geometry']):
                if coord:nodes[nid]=dict(type='node',id=nid,**coord)
            ways[w['id']]={k:v for k,v in w.items() if k not in ['geometry','bounds']}
        print('Band',i,'ways',len(ways),flush=True)
    (ROOT/f'data/raw/{prefix}_roads_osm.json').write_text(json.dumps(dict(elements=list(nodes.values())+list(ways.values()))),encoding='utf-8')
    (ROOT/f'data/{prefix}_roads_source.json').write_text(json.dumps(dict(bbox=BBOX,sources=sources,license='ODbL 1.0',attribution='© OpenStreetMap contributors',scope='札幌市域を広く覆う矩形と北部近郊。行政界による切抜き・市公式除雪路線照合は未実施。右左折制限relationは未取得。'),ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
