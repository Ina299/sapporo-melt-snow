"""Cache GSI address search results. Coordinates remain unverified address points."""
import json
import time
from datetime import datetime, timezone
import requests
from build_inventory import ROOT, OUT, save

URL='https://msearch.gsi.go.jp/address-search/AddressSearch'

def main():
    path=ROOT/'data/raw/geocoding.json'
    cache=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    for name in ['contractors','candidates']:
        rows=json.loads((OUT/(name+'.json')).read_text(encoding='utf-8'))
        for row in rows:
            address=row['address']
            if address not in cache:
                r=requests.get(URL,params={'q':address},timeout=25)
                r.raise_for_status()
                cache[address]=dict(results=json.loads(r.content),query=address,source_url=r.url,retrieved_at=datetime.now(timezone.utc).isoformat())
                path.write_text(json.dumps(cache,ensure_ascii=False,indent=2),encoding='utf-8')
                time.sleep(0.5)
            hits=cache[address]['results']
            # Do not silently choose among ambiguous addresses.
            if len(hits)==1:
                row['longitude'],row['latitude']=hits[0]['geometry']['coordinates']
                row['geocoded_title']=hits[0]['properties'].get('title')
                row['location_status']='国土地理院住所検索の単一候補／代表点・入口未確認'
            else:
                row['geocoded_title']=None
                row['location_status']=f'住所検索{len(hits)}候補／座標未確定'
            row['geocode_source_url']=cache[address]['source_url']
            print(row['id'],len(hits),row['latitude'],row['longitude'],row['geocoded_title'])
        save(name,rows)

if __name__=='__main__': main()
