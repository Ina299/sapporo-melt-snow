"""OSM road snapshot. Default: Hachiken/Shinkawa pilot, not all Sapporo."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bbox', default='43.085,141.30,43.095,141.315', help='south,west,north,east')
    args = parser.parse_args()
    bbox = [float(n) for n in args.bbox.split(',')]
    if len(bbox) != 4 or not (-90 < bbox[0] < bbox[2] < 90 and -180 < bbox[1] < bbox[3] < 180):
        raise ValueError('Invalid bounding box')
    query = '[out:json][timeout:120];way["highway"]('+','.join(map(str,bbox))+');out body;>;out skel qt;'
    errors = []
    for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            r = requests.post(endpoint, data={'data':query}, timeout=150)
            r.raise_for_status()
            payload = r.json()
            if payload.get('remark') or not payload.get('elements'):
                raise ValueError(payload.get('remark','Empty OSM result'))
            (ROOT/'data/raw/roads_osm.json').write_bytes(r.content)
            meta = dict(source=endpoint, query=query, bbox=bbox, retrieved_at=datetime.now(timezone.utc).isoformat(),
                        sha256=hashlib.sha256(r.content).hexdigest(), osm_timestamp=payload.get('osm3s',{}).get('timestamp_osm_base'),
                        attribution='© OpenStreetMap contributors', license='ODbL 1.0',
                        scope='八軒・新川周辺の矩形抽出。市全域・市公式除雪路線ではない。')
            (ROOT/'data/roads_source.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
            print(len(payload['elements']), 'OSM elements downloaded')
            return
        except (requests.RequestException, ValueError) as exc:
            errors.append(str(exc))
    endpoint = 'https://api.openstreetmap.org/api/0.6/map'
    response = requests.get(endpoint, params={'bbox':','.join(map(str,[bbox[1],bbox[0],bbox[3],bbox[2]]))}, timeout=90)
    response.raise_for_status()
    (ROOT/'data/raw/roads_osm.xml').write_bytes(response.content)
    convert_xml(bbox, response.content, endpoint)

def convert_xml(bbox, content, endpoint='https://api.openstreetmap.org/api/0.6/map'):
    xml = ET.fromstring(content)
    elements = []
    for e in xml:
        if e.tag not in {'node','way','relation'}:
            continue
        obj = dict(type=e.tag, id=int(e.attrib['id']), tags={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')})
        if e.tag == 'node':
            obj.update(lat=float(e.attrib['lat']),lon=float(e.attrib['lon']))
        if e.tag == 'way':
            obj['nodes'] = [int(n.attrib['ref']) for n in e.findall('nd')]
        if e.tag == 'relation':
            obj['members'] = [m.attrib for m in e.findall('member')]
        elements.append(obj)
    (ROOT/'data/raw/roads_osm.json').write_text(json.dumps({'elements':elements}),encoding='utf-8')
    meta = dict(source=endpoint, bbox=bbox, retrieved_at=datetime.now(timezone.utc).isoformat(),
                sha256=hashlib.sha256(content).hexdigest(), snapshot_file='data/raw/roads_osm.xml',
                attribution='© OpenStreetMap contributors',license='ODbL 1.0',
                scope='八軒・新川周辺の矩形抽出。市全域・市公式除雪路線ではない。')
    (ROOT/'data/roads_source.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    print(len(elements), 'OSM elements converted')

if __name__ == '__main__':
    main()
