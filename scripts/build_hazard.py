"""Hazard reading for DC candidate districts from the GSI 重ねるハザードマップ public tiles.

For each candidate the tiles (zoom 15) covering a 1.5 km circle around the representative
point are fetched once (cached under data/raw/hazard/) and the pixels are classified by the
published legend colours: river flood depth for the largest assumed rainfall (洪水浸水想定
区域・想定最大規模), sediment disaster warning zones (土石流・急傾斜地), and tsunami depth.
The result is the share of the circle's area in each class, plus the class at the point.

The circle is a district, not a parcel; the shares say how much of the surroundings is
mapped as flood-prone, not that a specific site is or is not. Inland flooding (内水) tiles
are not published for Sapporo on this service, so the city's own 内水 hazard map remains a
manual check. Tiles are only downloaded when missing, so the reading is reproducible.
"""
import csv,io,json,math,sys,time
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path
import requests
from PIL import Image

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/processed';RAW=ROOT/'data/raw/hazard';RAW.mkdir(parents=True,exist_ok=True)
BASE='https://disaportaldata.gsi.go.jp/raster/{layer}/{z}/{x}/{y}.png'
Z=15;RADIUS_M=1500
LAYERS={
 'flood_max':dict(id='01_flood_l2_shinsuishin_data',title='洪水浸水想定区域（想定最大規模）',
   legend={(247,245,169):'0.5m未満',(255,216,192):'0.5〜3m',(255,183,183):'3〜5m',(255,145,145):'5〜10m',(242,133,201):'10〜20m',(220,122,220):'20m以上'},
   order=['0.5m未満','0.5〜3m','3〜5m','5〜10m','10〜20m','20m以上']),
 'flood_plan':dict(id='01_flood_l1_shinsuishin_newlegend_data',title='洪水浸水想定区域（計画規模）',
   legend={(247,245,169):'0.5m未満',(255,216,192):'0.5〜3m',(255,183,183):'3〜5m',(255,145,145):'5〜10m',(242,133,201):'10〜20m',(220,122,220):'20m以上'},
   order=['0.5m未満','0.5〜3m','3〜5m','5〜10m','10〜20m','20m以上']),
 'debris_flow':dict(id='05_dosekiryukeikaikuiki',title='土砂災害警戒区域（土石流）',legend=None),
 'steep_slope':dict(id='05_kyukeishakeikaikuiki',title='土砂災害警戒区域（急傾斜地の崩壊）',legend=None),
 'landslide':dict(id='05_jisuberikeikaikuiki',title='土砂災害警戒区域（地滑り）',legend=None),
 'tsunami':dict(id='04_tsunami_newlegend_data',title='津波浸水想定',legend=None),
}
SOURCE='https://disaportal.gsi.go.jp/'

def tile_xy(lat,lon,z):
    n=2**z;x=(lon+180)/360*n;y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    return x,y
def pixel_latlon(px,py,z):
    n=2**z;lon=px/256/n*360-180;lat=math.degrees(math.atan(math.sinh(math.pi*(1-2*py/256/n))));return lat,lon

def fetch(layer,x,y,z):
    path=RAW/f'{layer}_{z}_{x}_{y}.png'
    if path.exists():return path.read_bytes()
    for attempt in range(3):
        r=requests.get(BASE.format(layer=layer,z=z,x=x,y=y),timeout=30,headers={'User-Agent':'SapporoSnowLab/0.1 github.com/Ina299/sapporo-melt-snow'})
        if r.status_code==200:path.write_bytes(r.content);return r.content
        if r.status_code==404:path.write_bytes(b'');return b''  # no data in this tile
        time.sleep(2)
    raise RuntimeError(f'tile fetch failed {layer} {z}/{x}/{y} {r.status_code}')

def classify(c,key):
    """Fetch every tile covering the circle for one layer and count classified pixels inside it."""
    L=LAYERS[key];lat,lon=c['lat'],c['lon']
    dlat=RADIUS_M/110570;dlon=RADIUS_M/(111320*math.cos(math.radians(lat)))
    x0,y0=tile_xy(lat+dlat,lon-dlon,Z);x1,y1=tile_xy(lat-dlat,lon+dlon,Z)
    counts=Counter();inside=0;point=None;tiles=0
    px0,py0=tile_xy(lat,lon,Z);ppx,ppy=int(px0*256),int(py0*256)
    for tx in range(int(x0),int(x1)+1):
        for ty in range(int(y0),int(y1)+1):
            data=fetch(L['id'],tx,ty,Z);tiles+=1
            img=Image.open(io.BytesIO(data)).convert('RGBA') if data else None
            pix=img.load() if img else None
            for i in range(256):
                for j in range(256):
                    plat,plon=pixel_latlon(tx*256+i+.5,ty*256+j+.5,Z)
                    d=math.hypot((plat-lat)*110570,(plon-lon)*111320*math.cos(math.radians(lat)))
                    if d>RADIUS_M:continue
                    inside+=1
                    cls=None
                    if pix:
                        r,g,b,a=pix[i,j]
                        if a>0:cls=L['legend'].get((r,g,b),'その他の凡例色') if L['legend'] else '区域内'
                    if cls:counts[cls]+=1
                    if tx*256+i==ppx and ty*256+j==ppy:point=cls
    shares={k:round(v/inside,4) for k,v in counts.items()}
    return dict(layer=L['id'],title=L['title'],tiles=tiles,area_share_mapped=round(sum(counts.values())/inside,4),shares=shares,at_point=point)

def main():
    cands=[dict(id=r['id'],name=r['name'],lat=float(r['latitude']),lon=float(r['longitude'])) for r in csv.DictReader(open(OUT/'dc_candidates.csv',encoding='utf-8-sig'))]
    results=[]
    for c in cands:
        rec=dict(id=c['id'],name=c['name'],radius_m=RADIUS_M,zoom=Z,layers={})
        for key in LAYERS:
            rec['layers'][key]=classify(c,key)
            print(c['id'],key,rec['layers'][key]['area_share_mapped'],rec['layers'][key]['shares'],'point',rec['layers'][key]['at_point'],flush=True)
        fm=rec['layers']['flood_max']['shares'];order=LAYERS['flood_max']['order']
        rec['summary']=dict(flood_max_share=rec['layers']['flood_max']['area_share_mapped'],
                            flood_max_ge_3m_share=round(sum(v for k,v in fm.items() if k in order[2:]),4),
                            flood_max_at_point=rec['layers']['flood_max']['at_point'],
                            sediment_share=round(sum(rec['layers'][k]['area_share_mapped'] for k in ['debris_flow','steep_slope','landslide']),4),
                            tsunami_share=rec['layers']['tsunami']['area_share_mapped'])
        results.append(rec)
    data=dict(as_of=datetime.now(timezone.utc).date().isoformat(),source=SOURCE,tile_url=BASE,zoom=Z,radius_m=RADIUS_M,
              layers={k:dict(id=v['id'],title=v['title']) for k,v in LAYERS.items()},
              legend_flood={f'#{r:02X}{g:02X}{b:02X}':lbl for (r,g,b),lbl in LAYERS['flood_max']['legend'].items()},
              notes=['国土地理院「重ねるハザードマップ」の公開タイル（PNG）を凡例色で分類した参考値。原典は各河川管理者・都道府県の指定図で、タイルの解像度と色の丸めに依存する。',
                     '半径1.5kmの地区の面積割合であり、個別区画の浸水深ではない。区画候補が出たら原典図で確認する。',
                     '内水（下水・雨水）の浸水想定タイルは札幌市域で未提供のため、札幌市の内水ハザードマップは手作業で照合する。',
                     '面積割合は候補地の点数化に使わず、事業継続条件を満たせない区画を除外する判断材料とする。'],
              candidates=results)
    (OUT/'dc_hazard.json').write_text(json.dumps(data,ensure_ascii=False,indent=1),encoding='utf-8')
    (ROOT/'data/hazard_source.json').write_text(json.dumps(dict(source=SOURCE,tile_url=BASE,layers={k:v['id'] for k,v in LAYERS.items()},retrieved_at=datetime.now(timezone.utc).isoformat(),license='国土地理院コンテンツ利用規約（出典明記）'),ensure_ascii=False,indent=2),encoding='utf-8')
    print('written',len(results))

if __name__=='__main__':main()
