"""Company-origin pilot coverage scenarios, using the expanded road graph for access.

Each company independently serves the same pilot tasks. These are alternative
scenarios, not actual assigned districts or dispatchable fleet assertions.
"""
import bisect,json,sys
from pathlib import Path
import networkx as nx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from src.routing import build_graph,postman,travel_graph,distance,metrics,validate_routes

def main():
    out=ROOT/'data/processed'
    payload=json.loads((ROOT/'data/raw/city_roads_osm.json').read_text(encoding='utf-8'))
    meta=json.loads((ROOT/'data/city_roads_source.json').read_text(encoding='utf-8'))
    g,_=build_graph(payload,meta['bbox'])
    pilot,_=build_graph(json.loads((ROOT/'data/raw/roads_osm.json').read_text(encoding='utf-8')),
                        json.loads((ROOT/'data/roads_source.json').read_text(encoding='utf-8'))['bbox'])
    pilot=pilot.subgraph(max(nx.strongly_connected_components(pilot),key=len)).copy()
    # Preserve the previously verified pilot snapshot; use current wide network for access.
    g.add_nodes_from(pilot.nodes(data=True))
    for u,v,k,a in pilot.edges(keys=True,data=True):g.add_edge(u,v,key=k,**a)
    main_nodes=max(nx.strongly_connected_components(g),key=len)
    if not set(pilot).issubset(main_nodes):raise ValueError('Pilot not connected to wide network')
    g=g.subgraph(main_nodes).copy();d=travel_graph(g)
    base=postman(pilot)
    companies=json.loads((out/'contractors.json').read_text(encoding='utf-8'))
    limits={'toyo':(10,'グレーダ3＋ショベルローダ7'), 'kashima':(13,'グレーダ3＋タイヤショベル10'),
            'satsuichi':(4,'タイヤショベル4'), 'krs':(3,'タイヤショベル2m³：1＋1.5m³：2')}
    results=[]
    for c in companies:
        loc=dict(lat=c['latitude'],lon=c['longitude'])
        depot=min(g,key=lambda n:distance(loc,g.nodes[n]))
        # One shortest-path tree per direction, reused for every fleet count.
        forward,fp=nx.single_source_dijkstra(d,depot,weight='weight')
        backward,bp=nx.single_source_dijkstra(d.reverse(copy=False),depot,weight='weight')
        start=min(range(len(base)),key=lambda i:forward[base[i]['u']]+backward[base[i]['u']])
        tour=base[start:]+base[:start]
        cumulative=[0]
        for s in tour:cumulative.append(cumulative[-1]+(s['service_s'] if s['service'] else s['cost']/1000))
        def steps(path):
            return [dict(u=u,v=v,task_id=None,service=False,original_key=d[u][v]['key'],length_m=g[u][v][d[u][v]['key']]['length_m'],service_s=0,cost=d[u][v]['weight']) for u,v in zip(path,path[1:])]
        scenarios=[];limit,basis=limits[c['id']]
        for count in range(1,limit+1):
            cuts=[0]+[min(len(tour)-(count-i),max(i,bisect.bisect_left(cumulative,cumulative[-1]*i/count))) for i in range(1,count)]+[len(tour)]
            routes=[];features=[]
            for vehicle,(lo,hi) in enumerate(zip(cuts,cuts[1:]),1):
                chunk=tour[lo:hi]
                ordered=steps(fp[chunk[0]['u']])+chunk+steps(list(reversed(bp[chunk[-1]['v']])))
                route=dict(vehicle_id=vehicle,steps=ordered,**metrics(ordered))
                routes.append(route)
                # Continuous runs keep dashed travel visually separate from service.
                runs=[]
                for s in ordered:
                    if not runs or runs[-1][0]!=s['service']:runs.append((s['service'],[[g.nodes[s['u']]['lon'],g.nodes[s['u']]['lat']]]))
                    runs[-1][1].append([g.nodes[s['v']]['lon'],g.nodes[s['v']]['lat']])
                for service,coords in runs:
                    features.append(dict(type='Feature',properties=dict(vehicle=vehicle,service=service),geometry=dict(type='LineString',coordinates=coords)))
            check=validate_routes(pilot,routes)
            # Travel legally uses city roads outside the pilot, so validate legality against g.
            required={k for u,v,k in pilot.edges(keys=True)}
            covered={s['task_id'] for r in routes for s in r['steps'] if s['service']}
            legal=all(g.has_edge(s['u'],s['v'],s['original_key']) for r in routes for s in r['steps'])
            continuous=all(r['steps'][0]['u']==depot==r['steps'][-1]['v'] and all(a['v']==b['u'] for a,b in zip(r['steps'],r['steps'][1:])) for r in routes)
            if not (required<=covered and legal and continuous):raise AssertionError('Route coverage/continuity/legality failed')
            validation=dict(valid=True,required=len(required),covered=len(required&covered),legal_arcs=legal,closed_at_depot=continuous)
            for r in routes:r.pop('steps')
            scenarios.append(dict(vehicles=count,routes=routes,validation=validation,geometry=dict(type='FeatureCollection',features=features)))
        results.append(dict(id=c['id'],name=c['name'],fleet_limit=limit,fleet_basis=basis,
                            depot_node=depot,depot=dict(g.nodes[depot]),snap_distance_m=distance(loc,g.nodes[depot]),scenarios=scenarios))
        print(c['id'],limit,'scenarios',round(distance(loc,g.nodes[depot])), 'm snap',flush=True)
    data=dict(companies=results,scope='各社が独立に八軒実証1,236方向区間を担当する比較仮定。実契約地区・共同配車ではない。',
              method='郵便配達人閉路を出発点に応じ回転し、作業時間で連続分割。往復回送は広域有向道路の最短時間経路。複数台は近似で全体最適性の保証なし。',
              fleet_note='公表グレーダ・主要ショベル数による比較上限。大型ロータリ・ダンプ・小型ショベルは混算しない。除雪装備・実稼働台数・道路適合性は未確認。',
              origin_note='所在地代表点を最寄りの往復到達可能な道路ノードへ接続。構内・搬入口から接続点までの走行は距離・時間に含まない。')
    (out/'contractor_routes.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (ROOT/'web/contractor-data.js').write_text('window.CONTRACTOR_ROUTES = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
if __name__=='__main__':main()
