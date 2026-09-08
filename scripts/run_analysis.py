import json
import sys
from pathlib import Path
import networkx as nx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.routing import build_graph,postman,split_fleet,validate_routes,metrics
from src.thermal import melt_capacity

OUT=ROOT/'data/processed'
def write(name,obj):
    (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')

def main():
    payload=json.loads((ROOT/'data/raw/roads_osm.json').read_text(encoding='utf-8'))
    meta=json.loads((ROOT/'data/roads_source.json').read_text(encoding='utf-8'))
    g,audit=build_graph(payload,meta['bbox'])
    if not g.number_of_edges(): raise ValueError('No roads found')
    components=sorted(nx.strongly_connected_components(g),key=lambda c:len(c),reverse=True)
    main_graph=g.subgraph(components[0]).copy()
    excluded=[dict(u=u,v=v,**a) for u,v,a in g.edges(data=True) if u not in main_graph or v not in main_graph]
    write('excluded_arcs.json',excluded)
    audit.update(strong_components=len(components),processed_arcs=main_graph.number_of_edges(),
                 excluded_connectivity_arcs=len(excluded),scope='八軒・新川の矩形内から抽出した車道の最大強連結成分',
                 all_requested_arcs_covered=not excluded,
                 limitations=['市公式除雪路線との照合未実施','両方向道路は各方向1回の作業を仮定',
                   '右左折禁止・車幅・勾配・旋回半径・交通・優先期限は未反映','実業者の車庫と稼働台数は未接続',
                   '境界をまたぐ道路と対象外道路種別は除外数に表示'])
    # Synthetic staging points explicitly separated from company locations.
    west=min(main_graph,key=lambda n:main_graph.nodes[n]['lon'])
    east=max(main_graph,key=lambda n:main_graph.nodes[n]['lon'])
    tour=postman(main_graph,source=west)
    scenarios=[]; features=[]
    for count in [1,2,4,8]:
        depots=[dict(id='仮設待機点A',node=west,count=(count+1)//2)]
        if count>1: depots.append(dict(id='仮設待機点B',node=east,count=count//2))
        routes=split_fleet(main_graph,tour,depots)
        check=validate_routes(main_graph,routes)
        if not check['valid']: raise AssertionError(check)
        for r in routes:
            features.append(dict(type='Feature',properties=dict(scenario=count,vehicle=r['vehicle_id'],depot=r['depot_id'],
                hours=r['hours'],distance_km=r['distance_km']),geometry=dict(type='LineString',
                coordinates=[[main_graph.nodes[r['steps'][0]['u']]['lon'],main_graph.nodes[r['steps'][0]['u']]['lat']]]+
                [[main_graph.nodes[s['v']]['lon'],main_graph.nodes[s['v']]['lat']] for s in r['steps']])))
        scenarios.append(dict(vehicles=count,depots=depots,routes=routes,validation=check,
             total_km=sum(r['distance_km'] for r in routes),deadhead_km=sum(r['deadhead_km'] for r in routes),
             total_hours=sum(r['hours'] for r in routes),makespan_hours=max(r['hours'] for r in routes),
             total_cost_yen=sum(r['cost_yen'] for r in routes),feasible_shift=all(r['within_shift'] for r in routes)))
    road_features=[dict(type='Feature',properties=dict(task_id=k,way_id=a['way_id'],name=a['name'],highway=a['highway'],
          length_m=a['length_m'],included=u in main_graph and v in main_graph),geometry=dict(type='LineString',
          coordinates=[[g.nodes[u]['lon'],g.nodes[u]['lat']],[g.nodes[v]['lon'],g.nodes[v]['lat']]]))
          for u,v,k,a in g.edges(keys=True,data=True)]
    write('roads.geojson',dict(type='FeatureCollection',features=road_features))
    write('routes.geojson',dict(type='FeatureCollection',features=features))
    result=dict(audit=audit,source=meta,parameters=dict(service_kph=8,deadhead_kph=20,hourly_yen=12000,shift_hours=6,
            depot_status='道路端の仮設待機点。実車庫ではない',fleet_status='1/2/4/8台の仮定。公開保有数からの配備ではない'),
            single_postman=metrics(tour),scenarios=scenarios,
            depots=[dict(id='仮設待機点A',**main_graph.nodes[west]),dict(id='仮設待機点B',**main_graph.nodes[east])],
            thermal=[melt_capacity(it_mw=m) for m in [0.5,1,5,10]])
    write('analysis.json',result)
    bundle=dict(analysis=result,roads=dict(type='FeatureCollection',features=road_features),
                routes=dict(type='FeatureCollection',features=features))
    # Full ordered route steps are retained in analysis.json; slim web bundle.
    for s in bundle['analysis']['scenarios']:
        for r in s['routes']: r.pop('steps')
    for name in ['contractors','candidates','district_fleet','contractor_directory']:
        bundle[name]=json.loads((OUT/(name+'.json')).read_text(encoding='utf-8'))
    bundle['sources']=json.loads((ROOT/'data/sources.json').read_text(encoding='utf-8'))
    dc=OUT/'dc_feasibility.json'
    if dc.exists(): bundle['dc']=json.loads(dc.read_text(encoding='utf-8'))
    weather=OUT/'weather_summary.json'
    if weather.exists(): bundle['weather']=json.loads(weather.read_text(encoding='utf-8'))
    (ROOT/'web/data.js').write_text('window.SAPPORO_DATA = '+json.dumps(bundle,ensure_ascii=False)+';',encoding='utf-8')
    print(json.dumps(dict(audit=audit,single=result['single_postman'],scenarios=[{k:s[k] for k in ['vehicles','total_km','makespan_hours','total_cost_yen','feasible_shift']} for s in scenarios]),ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
    from build_dashboard import main as build_dashboard
    build_dashboard()
