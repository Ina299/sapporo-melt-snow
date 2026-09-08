"""Compute expanded directed postman tours; preserve the small fleet comparison."""
import json,sys,time
from pathlib import Path
import networkx as nx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from src.routing import build_graph,postman,metrics,validate_routes

def main():
    meta=json.loads((ROOT/'data/city_roads_source.json').read_text(encoding='utf-8'))
    payload=json.loads((ROOT/'data/raw/city_roads_osm.json').read_text(encoding='utf-8'))
    g,audit=build_graph(payload,meta['bbox']);print('Graph',len(g),g.number_of_edges(),flush=True)
    components=sorted(nx.strongly_connected_components(g),key=len,reverse=True)
    membership={n:i for i,c in enumerate(components) for n in c}
    routes=[];covered=set();features=[]
    for i,c in enumerate(components):
        sub=g.subgraph(c)
        if not sub.number_of_edges():continue
        print('Solve component',i,len(c),sub.number_of_edges(),flush=True)
        tour=postman(sub)
        validation=validate_routes(sub,[dict(steps=tour)])
        if not validation['valid']:raise AssertionError(validation)
        covered.update(s['task_id'] for s in tour if s['service'])
        routes.append(dict(component=i,**metrics(tour),validation=validation,steps=tour))
    # Group adjacent OSM shape segments by way and processing status for efficient display.
    groups={}
    for u,v,k,a in g.edges(keys=True,data=True):
        key=(a['way_id'],k in covered)
        group=groups.setdefault(key,dict(name=a['name'],coordinates=[],segments=set()))
        if a['segment_id'] in group['segments']:continue
        group['segments'].add(a['segment_id'])
        group['coordinates'].append([[g.nodes[u]['lon'],g.nodes[u]['lat']],[g.nodes[v]['lon'],g.nodes[v]['lat']]])
    for (way,included),group in groups.items():
        features.append(dict(type='Feature',properties=dict(way_id=way,name=group['name'],included=included),geometry=dict(type='MultiLineString',coordinates=group['coordinates'])))
    excluded=[dict(task_id=k,u=u,v=v,way_id=a['way_id']) for u,v,k,a in g.edges(keys=True,data=True) if k not in covered]
    audit.update(processed_arcs=len(covered),excluded_connectivity_arcs=len(excluded),strong_components=len(components),computed_components=len(routes),all_requested_arcs_covered=not excluded)
    summary=dict(audit=audit,source=meta,total_service_km=sum(r['service_km'] for r in routes),total_deadhead_km=sum(r['deadhead_km'] for r in routes),total_hours=sum(r['hours'] for r in routes),
                 scope=meta['scope'],method='各強連結成分の有向郵便配達人閉路。実車庫・実配車・旋回制限未反映。成分間を一方向につなぐ区間は未計算。')
    out=ROOT/'data/processed'
    for name,obj in [('city_analysis',summary),('city_routes',routes),('city_excluded_arcs',excluded)]:
        (out/(name+'.json')).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    roads=dict(type='FeatureCollection',features=features)
    (out/'city_roads.geojson').write_text(json.dumps(roads,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (ROOT/'web/city-data.js').write_text('window.SAPPORO_CITY = '+json.dumps(dict(summary=summary,roads=roads),ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
    print(json.dumps(audit),flush=True)

if __name__=='__main__':main()
