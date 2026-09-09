"""Snow-supply side of DC siting: 1 km mesh of road snowfall and tonne-km per candidate set.

Every in-city drivable road (the dispatch work set, one length per way, no per-direction
double counting) gets an assumed plowed width by OSM highway class. Season snowfall and the
95th-percentile daily snowfall of the nearest of the 13 city observation points turn the road
area into tonnes of fresh snow. Cells are assigned to the nearest DC candidate (straight-line
distance times a detour factor) and every subset of 1..4 candidates is compared by tonne-km.

The haul fraction (how much of the road snow is actually trucked away rather than stored at
the roadside) scales every total equally, so the ranking of candidate sets does not depend
on it; the absolute tonnes and the MW implied by the peak day do, and are reported for the
assumed fraction only.
"""
import csv,itertools,json,math,time
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
import requests,sys
from shapely.geometry import shape,Point,Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/processed';WEB=ROOT/'web'
GSI='https://msearch.gsi.go.jp/address-search/AddressSearch'
OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter']
LAND_RADIUS_M=1500
RESIDENTIAL={'residential','retail','commercial'};INDUSTRIAL={'industrial','railway','depot','port','logistics'}
RES_BUILDINGS={'house','apartments','residential','detached','terrace','dormitory','semidetached_house'};IND_BUILDINGS={'industrial','warehouse','factory','manufacture','depot'}
# Observation point -> address used as its representative point (ward offices where the
# station name is only a ward). These are look-up addresses, not the sensor locations.
STATION_ADDRESS={'中央区':'札幌市中央区南3条西11丁目','北区(太平)':'札幌市北区太平','北区(あいの里)':'札幌市北区あいの里',
 '東区':'札幌市東区北11条東7丁目','白石区':'札幌市白石区南郷通1丁目南','厚別区':'札幌市厚別区厚別中央1条5丁目',
 '豊平区':'札幌市豊平区平岸6条10丁目','清田区':'札幌市清田区平岡1条1丁目','南区(南31条西8丁目)':'札幌市南区南31条西8丁目',
 '南区(定山渓)':'札幌市南区定山渓温泉東','西区(西野)':'札幌市西区西野','西区(平和)':'札幌市西区平和','手稲区':'札幌市手稲区前田1条11丁目'}
ASSUMPTIONS=dict(
    plowed_width_m={'primary':12,'primary_link':12,'secondary':11,'secondary_link':11,'tertiary':9,'tertiary_link':9,'unclassified':6,'residential':6,'living_street':5},
    fresh_snow_density_kg_m3=100,haul_fraction=0.5,detour_factor=1.3,cell_km=1.0,
    melt_t_per_day_per_mw=3531/20,season_days=161,land_radius_m=LAND_RADIUS_M,  # docs/dc_feasibility.md: 20 MW IT -> 3,531 t/day at 90% load, 80% recovery
    notes=['道路面積は市内の作業対象車道（未舗装・私道等を除く）の延長×道路種別ごとの仮定幅。往復方向を二重計上しない。',
           '降雪は最寄り観測点（13地点、2025年度）の季節合計と日量95パーセンタイル。観測点の座標は地名・区役所住所の代表点。',
           '排雪率は道路上の降雪のうちトラックで運び出す割合の仮定。候補地の順位には影響せず、トン数とMW換算だけに影響する。',
           '距離は直線×迂回係数で、道路距離・橋・冬季渋滞を含まない。候補地の代表点は売地区画ではない。',
           'ハザードの因子は国土地理院「重ねるハザードマップ」公開タイルを凡例色で読んだ半径1.5kmの面積割合（scripts/build_hazard.py）。内水は未提供。区画の浸水深ではない。',
           '用地の因子は候補地代表点から半径1.5kmのOSM土地利用（landuse）の面積比、3ha以上の工業系区画の数、建物種別の数（building タグ）、住宅街路（highway=residential）の密度。札幌のOSMは landuse がほとんど付いていないため、住宅地かどうかは建物種別と住宅街路の密度で読む。用途地域（法的な立地可否）・売地の有無・所有者は含まない。'])

def hav(a,b):
    lat1,lon1,lat2,lon2=map(math.radians,[a[0],a[1],b[0],b[1]])
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371.0088*2*math.asin(min(1,math.sqrt(h)))

def geocode_stations():
    path=ROOT/'data/raw/geocoding.json';cache=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    out={}
    for st,addr in STATION_ADDRESS.items():
        if addr not in cache:
            r=requests.get(GSI,params={'q':addr},timeout=25);r.raise_for_status()
            cache[addr]=dict(results=json.loads(r.content),query=addr,source_url=r.url,retrieved_at=datetime.now(timezone.utc).isoformat())
            path.write_text(json.dumps(cache,ensure_ascii=False,indent=2),encoding='utf-8');time.sleep(0.5)
        hits=cache[addr]['results']
        if not hits:raise ValueError(f'No geocode hit for {addr}')
        lon,lat=hits[0]['geometry']['coordinates']
        out[st]=dict(address=addr,lat=lat,lon=lon,title=hits[0]['properties'].get('title'),hits=len(hits),source_url=cache[addr]['source_url'])
    return out

def fetch_landuse(c,kind='landuse'):
    path=ROOT/f"data/raw/dc/{kind}_{c['id']}.json"
    if not path.exists():
        if kind=='landuse':q=f'[out:json][timeout:90];(way["landuse"](around:{LAND_RADIUS_M},{c["lat"]},{c["lon"]});relation["landuse"](around:{LAND_RADIUS_M},{c["lat"]},{c["lon"]}););out geom;'
        else:q=f'[out:json][timeout:120];(way["building"](around:{LAND_RADIUS_M},{c["lat"]},{c["lon"]});relation["building"](around:{LAND_RADIUS_M},{c["lat"]},{c["lon"]}););out tags;'
        for ep in OVERPASS:
            r=requests.get(ep,params={'data':q},headers={'User-Agent':'SapporoSnowLab/0.1 github.com/Ina299/sapporo-melt-snow'},timeout=180)
            print('overpass',ep,r.status_code,file=sys.stderr)
            if r.status_code==200 and not json.loads(r.content).get('remark'):
                path.write_bytes(r.content);break
            time.sleep(5)
        else:raise RuntimeError('Overpass failed for '+c['id'])
    return json.loads(path.read_bytes())

def building_metrics(c):
    j=fetch_landuse(c,'buildings');counts=defaultdict(int)
    for e in j['elements']:
        b=e.get('tags',{}).get('building')
        if not b:continue
        counts['residential' if b in RES_BUILDINGS else 'industrial' if b in IND_BUILDINGS else 'unspecified' if b=='yes' else 'other']+=1
    tot=sum(counts.values());typed=tot-counts['unspecified']
    return dict(buildings=tot,residential=counts['residential'],industrial=counts['industrial'],other=counts['other'],unspecified=counts['unspecified'],
                residential_share_of_typed=round(counts['residential']/typed,3) if typed else None,industrial_share_of_typed=round(counts['industrial']/typed,3) if typed else None)

def land_metrics(c):
    j=fetch_landuse(c);kx=111320*math.cos(math.radians(c['lat']));ky=110570
    proj=lambda lon,lat:((lon-c['lon'])*kx,(lat-c['lat'])*ky)
    circle=Point(0,0).buffer(LAND_RADIUS_M);polys=defaultdict(list);big=[]
    for e in j['elements']:
        lu=e.get('tags',{}).get('landuse')
        if not lu:continue
        geoms=[]
        if e['type']=='way' and e.get('geometry') and len(e['geometry'])>=4:geoms=[e['geometry']]
        elif e['type']=='relation':geoms=[m['geometry'] for m in e.get('members',[]) if m.get('role')=='outer' and m.get('geometry') and len(m['geometry'])>=4]
        for g_ in geoms:
            try:pg=Polygon([proj(p['lon'],p['lat']) for p in g_]).buffer(0)
            except Exception:continue
            pg=pg.intersection(circle)
            if pg.is_empty:continue
            polys[lu].append(pg)
            if lu in INDUSTRIAL and pg.area>=30000:big.append(dict(landuse=lu,area_ha=round(pg.area/1e4,1),osm=f"{e['type']}/{e['id']}",name=e.get('tags',{}).get('name')))
    area={lu:unary_union(v).area for lu,v in polys.items()};tot=circle.area
    share=lambda keys:round(sum(area.get(k,0) for k in keys)/tot,3)
    other=[lu for lu in area if lu not in RESIDENTIAL|INDUSTRIAL]
    return dict(residential_share=share(RESIDENTIAL),industrial_share=share(INDUSTRIAL),other_tagged_share=share(other),untagged_share=round(1-sum(area.values())/tot,3),
                industrial_parcels_ge_3ha=len(big),largest_industrial_ha=max([b['area_ha'] for b in big],default=0),parcels=sorted(big,key=lambda b:-b['area_ha'])[:8],
                top_landuse=sorted(((lu,round(a/tot,3)) for lu,a in area.items()),key=lambda x:-x[1])[:6])

def main():
    load=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
    boundary=load('data/processed/sapporo_boundary.geojson')
    poly=shape(boundary['geometry'] if boundary.get('type')=='Feature' else boundary['features'][0]['geometry']);city=prep(poly)
    stations=geocode_stations()
    summary={s['station']:s for s in load('data/processed/weather_summary.json')['stations']}
    for st in stations:stations[st].update(season_cm=summary[st]['snowfall_sum_cm'],p95_cm=summary[st]['p95_cm'])
    raw=load('data/raw/city_roads_osm.json');tags={e['id']:e.get('tags',{}) for e in raw['elements'] if e['type']=='way'};del raw
    roads=load('data/processed/city_roads.geojson')
    lat0=43.06;kx=111.32*math.cos(math.radians(lat0));ky=110.57;cell=ASSUMPTIONS['cell_km']
    minx,miny,maxx,maxy=poly.bounds
    key=lambda lon,lat:(int((lon-minx)*kx/cell),int((lat-miny)*ky/cell))
    cells=defaultdict(lambda:dict(area_m2=0.0,length_km=0.0,ways=0))
    width=ASSUMPTIONS['plowed_width_m']
    segs=[]  # (mid lon, mid lat, km, highway) for the land factor below
    for f in roads['features']:
        p=f['properties']
        if not p.get('included'):continue
        hw=tags.get(p['way_id'],{}).get('highway')
        w=width.get(hw)
        if w is None:continue
        for seg in f['geometry']['coordinates']:
            for (x1,y1),(x2,y2) in zip(seg,seg[1:]):
                mx,my=(x1+x2)/2,(y1+y2)/2
                if not city.contains(Point(mx,my)):continue
                L=hav((y1,x1),(y2,x2));segs.append((mx,my,L,hw))
                c=cells[key(mx,my)];c['area_m2']+=L*1000*w;c['length_km']+=L
    # cell centres, nearest station, tonnes
    rows=[]
    for (i,j),c in cells.items():
        lon=minx+(i+0.5)*cell/kx;lat=miny+(j+0.5)*cell/ky
        st=min(stations,key=lambda s:hav((lat,lon),(stations[s]['lat'],stations[s]['lon'])))
        dens=ASSUMPTIONS['fresh_snow_density_kg_m3'];hf=ASSUMPTIONS['haul_fraction']
        season_t=c['area_m2']*stations[st]['season_cm']/100*dens/1000*hf
        peak_t=c['area_m2']*stations[st]['p95_cm']/100*dens/1000*hf
        rows.append(dict(i=i,j=j,lat=round(lat,5),lon=round(lon,5),road_km=round(c['length_km'],2),road_area_ha=round(c['area_m2']/1e4,2),station=st,season_t=round(season_t),peak_day_t=round(peak_t)))
    cands=[dict(id=r['id'],name=r['name'],lat=float(r['latitude']),lon=float(r['longitude'])) for r in csv.DictReader(open(OUT/'dc_candidates.csv',encoding='utf-8-sig'))]
    dist={(r['i'],r['j']):{c['id']:hav((r['lat'],r['lon']),(c['lat'],c['lon']))*ASSUMPTIONS['detour_factor'] for c in cands} for r in rows}
    total_season=sum(r['season_t'] for r in rows);total_peak=sum(r['peak_day_t'] for r in rows)
    def evaluate(ids):
        load_s=defaultdict(float);load_p=defaultdict(float);tkm=0.0;wdist=0.0
        for r in rows:
            d=dist[(r['i'],r['j'])];best=min(ids,key=lambda k:d[k])
            load_s[best]+=r['season_t'];load_p[best]+=r['peak_day_t'];tkm+=r['season_t']*d[best]
        sites=[dict(id=k,season_t=round(load_s[k]),peak_day_t=round(load_p[k]),share=round(load_s[k]/total_season,3),
                    mw_for_peak_day=round(load_p[k]/ASSUMPTIONS['melt_t_per_day_per_mw'],1)) for k in ids]
        return dict(sites=sites,tonne_km=round(tkm),mean_km=round(tkm/total_season,2))
    single=[]
    for c in cands:
        e=evaluate([c['id']]);d=[dist[(r['i'],r['j'])][c['id']] for r in rows]
        within=lambda km:round(sum(r['season_t'] for r,x in zip(rows,d) if x<=km)/total_season,3)
        single.append(dict(id=c['id'],name=c['name'],mean_km=e['mean_km'],tonne_km=e['tonne_km'],share_within_5km=within(5),share_within_10km=within(10)))
    single.sort(key=lambda x:x['mean_km'])
    best_sets={}
    for k in range(1,5):
        evals=[dict(ids=list(ids),**evaluate(list(ids))) for ids in itertools.combinations([c['id'] for c in cands],k)]
        evals.sort(key=lambda e:e['tonne_km'])
        best_sets[str(k)]=evals[:5]
    grid={e['id']:e for e in load('data/processed/dc_grid_ix.json')['evaluations']}
    hz_path=OUT/'dc_hazard.json';hazard={r['id']:r for r in (json.loads(hz_path.read_text(encoding='utf-8'))['candidates'] if hz_path.exists() else [])}
    verdict={r['id']:r['verdict'] for r in csv.DictReader(open(OUT/'dc_candidates.csv',encoding='utf-8-sig'))}
    best2=best_sets['2'][0]['ids']
    factors=[]
    for c in cands:
        sg=next(x for x in single if x['id']==c['id']);ge=grid[c['id']];land=land_metrics(c);land['buildings']=building_metrics(c)
        near=[(L,hw) for mx,my,L,hw in segs if hav((my,mx),(c['lat'],c['lon']))<=LAND_RADIUS_M/1000]
        area_km2=math.pi*(LAND_RADIUS_M/1000)**2
        land['road_km_within']=round(sum(L for L,_ in near),1);land['residential_street_km_per_km2']=round(sum(L for L,hw in near if hw=='residential')/area_km2,2);land['residential_street_share']=round(sum(L for L,hw in near if hw=='residential')/max(1e-9,sum(L for L,_ in near)),3)
        added=evaluate(sorted(set(best2)|{c['id']}))['tonne_km']
        hix=next((x['distance_km'] for x in ge['ix'] if x['id']=='hix'),None)
        factors.append(dict(id=c['id'],name=c['name'],verdict=verdict[c['id']],
            snow=dict(mean_km=sg['mean_km'],share_within_10km=sg['share_within_10km'],tonne_km_saved_vs_best2=round(best_sets['2'][0]['tonne_km']-added) if c['id'] not in best2 else None),
            grid=dict(substation_187kv=ge['nearest_substation_187kv']['name'],substation_187kv_km=ge['nearest_substation_187kv']['distance_km'],substation_187kv_rank=ge['nearest_substation_187kv']['capacity_label'],
                      line_187kv=ge['nearest_lines'].get('187',{}).get('name'),line_187kv_km=ge['nearest_lines'].get('187',{}).get('distance_km'),line_187kv_rank=ge['nearest_lines'].get('187',{}).get('capacity_label'),
                      substations_66kv_within_3km=len(ge['substations_within_3km'])),
            ix=dict(hix_km=hix,industrial_park=ge['nearest_industrial_park']['name'],industrial_park_km=ge['nearest_industrial_park']['distance_km']),
            land=land,hazard=(lambda h:dict(flood_max_share=h['summary']['flood_max_share'],flood_max_ge_3m_share=h['summary']['flood_max_ge_3m_share'],flood_max_at_point=h['summary']['flood_max_at_point'],flood_max_classes=h['layers']['flood_max']['shares'],sediment_share=h['summary']['sediment_share'],tsunami_share=h['summary']['tsunami_share']))(hazard[c['id']]) if c['id'] in hazard else None))
    # marginal value of each candidate: best k=3 set with and without it
    data=dict(as_of=datetime.now(timezone.utc).date().isoformat(),assumptions=ASSUMPTIONS,stations=stations,candidates=cands,
              totals=dict(cells=len(rows),road_km=round(sum(r['road_km'] for r in rows)),road_area_ha=round(sum(r['road_area_ha'] for r in rows)),
                          season_t=round(total_season),peak_day_t=round(total_peak),peak_day_mw=round(total_peak/ASSUMPTIONS['melt_t_per_day_per_mw'],1),
                          avg_day_t=round(total_season/ASSUMPTIONS['season_days']),share_of_avg_day_per_20mw=round(3531/(total_season/ASSUMPTIONS['season_days']),3)),
              single_site=single,best_sets=best_sets,factors=factors,cells=rows,
              scope='路上降雪の供給側だけの比較。用地・受電・IX・ハザード・既存施設の受入余力は別途。候補地の代表点は売地区画ではない。')
    (OUT/'dc_siting.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    with open(OUT/'dc_siting_cells.csv','w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys()));w.writeheader();w.writerows(rows)
    web=dict(data,cells=[[r['lat'],r['lon'],r['season_t'],r['peak_day_t'],r['road_km']] for r in rows])
    (WEB/'dc-siting-data.js').write_text('window.DC_SITING = '+json.dumps(web,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
    print('cells',len(rows),'road km',data['totals']['road_km'],'season t',data['totals']['season_t'],'peak day t',data['totals']['peak_day_t'],'MW',data['totals']['peak_day_mw'])
    for s in single:print(f"  {s['id']:<20} mean {s['mean_km']:5.2f} km  <=5km {s['share_within_5km']:.0%}  <=10km {s['share_within_10km']:.0%}")
    for k,v in best_sets.items():print(' best',k,v[0]['ids'],v[0]['mean_km'],'km',[(x['id'],x['share'],x['mw_for_peak_day']) for x in v[0]['sites']])
    for f in factors:print(' land',f['id'],'bld',f['land']['buildings']['buildings'],'resB',f['land']['buildings']['residential_share_of_typed'],'indB',f['land']['buildings']['industrial_share_of_typed'],'resStreet km/km2',f['land']['residential_street_km_per_km2'],'ind',f['land']['industrial_share'],'parcels>=3ha',f['land']['industrial_parcels_ge_3ha'],'largest',f['land']['largest_industrial_ha'],'ha | 187kV',f['grid']['line_187kv_km'],'km',f['grid']['line_187kv_rank'],'| H-IX',f['ix']['hix_km'],'km | saved vs best2',f['snow']['tonne_km_saved_vs_best2'])

if __name__=='__main__':main()
