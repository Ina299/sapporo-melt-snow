"""Joint wide-area assignment and company fleet scheduling.

Reusable depot-to-depot jobs retain full legal ordered steps. The web shares job
geometry across fleet-count scenarios, avoiding thirty copies of the road map.
"""
import argparse,gzip,json,sys
from collections import Counter
from pathlib import Path
import networkx as nx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from src.routing import build_graph,travel_graph,distance,metrics,DRIVABLE

LIMITS={'toyo':(10,'グレーダ3＋ショベルローダ7'),'kashima':(13,'グレーダ3＋タイヤショベル10'),
        'satsuichi':(4,'タイヤショベル4'),'krs':(3,'2m³ショベル1＋1.5m³ショベル2')}

def schedule(jobs,count):
    """Longest-job-first scheduling on identical vehicles with depot returns."""
    bins=[dict(vehicle_id=i+1,trip_ids=[],hours=0,service_km=0,deadhead_km=0,distance_km=0) for i in range(count)]
    for job in sorted(jobs,key=lambda j:(-j['hours'],j['id'])):
        target=min(bins,key=lambda r:(r['hours'],r['vehicle_id']))
        target['trip_ids'].append(job['id'])
        for k in ['hours','service_km','deadhead_km','distance_km']:target[k]+=job[k]
    return bins

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--joint',action='store_true');args=parser.parse_args()
    prefix='joint_dispatch' if args.joint else 'dispatch'
    out=ROOT/'data/processed'
    load=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
    meta=load('data/city_roads_source.json')
    work,audit=build_graph(load('data/raw/city_roads_osm.json'),meta['bbox'])
    extra=load('data/raw/transit_roads_osm.json')
    extra['elements']=[e for e in extra['elements'] if e.get('tags',{}).get('motorroad')!='yes']
    DRIVABLE.update({'trunk','trunk_link','service'})
    transit,transit_audit=build_graph(extra,meta['bbox'])
    transit.add_nodes_from(work.nodes(data=True))
    for u,v,k,a in work.edges(keys=True,data=True):transit.add_edge(u,v,key=k,**a)
    del extra
    d=travel_graph(transit)
    components=sorted(nx.strongly_connected_components(d),key=len,reverse=True)
    # Snap each address to a road, without moving it to an arbitrary remote component.
    companies=load('data/processed/contractors.json');trees={}
    for c in companies:
        loc=dict(lat=c['latitude'],lon=c['longitude'])
        depot=min(d,key=lambda n:distance(loc,d.nodes[n]))
        c.update(depot_node=depot,depot=dict(d.nodes[depot]),snap_distance_m=distance(loc,d.nodes[depot]),
                 fleet_limit=LIMITS[c['id']][0],fleet_basis=LIMITS[c['id']][1],trips=[])
        pred,forward=nx.dijkstra_predecessor_and_distance(d,depot,weight='weight')
        parents={n:ps[0] for n,ps in pred.items() if ps}
        pred,backward=nx.dijkstra_predecessor_and_distance(d.reverse(copy=False),depot,weight='weight')
        backparents={n:ps[0] for n,ps in pred.items() if ps}
        trees[c['id']]=(forward,backward,parents,backparents)
        print('Depot',c['id'],round(c['snap_distance_m']),'m',len(forward),'reachable nodes',flush=True)
    tours=load('data/processed/city_routes.json')
    jobs=[];current=[];elapsed=0
    for tour in tours:
        current=[];elapsed=0
        for step in tour['steps']:
            current.append(step);elapsed+=step['service_s'] if step['service'] else step['cost']/1000
            if elapsed>=7200:
                jobs.append(current);current=[];elapsed=0
        if current:jobs.append(current)
    del tours
    original_excluded=load('data/processed/city_excluded_arcs.json')
    for e in original_excluded:
        a=work[e['u']][e['v']][e['task_id']]
        jobs.append([dict(u=e['u'],v=e['v'],task_id=e['task_id'],original_key=e['task_id'],service=True,
                          length_m=a['length_m'],service_s=a['service_s'],cost=a['cost'])])
    workload={c['id']:0 for c in companies};unassigned=[];covered=Counter();full=[]
    vehicle_loads={c['id']:[0]*c['fleet_limit'] for c in companies}
    vehicle_jobs={c['id']:[[] for _ in range(c['fleet_limit'])] for c in companies}
    def access_steps(node,parents,reverse=False):
        path=[node]
        while path[-1] in parents:path.append(parents[path[-1]])
        if not reverse:path.reverse()
        return [dict(u=u,v=v,task_id=None,original_key=d[u][v]['key'],service=False,
                     length_m=transit[u][v][d[u][v]['key']]['length_m'],service_s=0,cost=d[u][v]['weight']) for u,v in zip(path,path[1:])]
    # Large jobs first; balance normalized company load and penalize deadhead.
    for chunk in sorted(jobs,key=lambda steps:-sum(s['service_s'] for s in steps)):
        eligible=[];m=metrics(chunk)
        for c in companies:
            f,b,_,_=trees[c['id']]
            if chunk[0]['u'] in f and chunk[-1]['v'] in b:
                access=(f[chunk[0]['u']]+b[chunk[-1]['v']])/3600000
                finish=(min(vehicle_loads[c['id']])+m['hours']+access) if args.joint else (workload[c['id']]+m['hours']+access)/c['fleet_limit']
                eligible.append((finish+.2*access,c['id'],access))
        if not eligible:
            unassigned.extend(s for s in chunk if s['service']);continue
        _,cid,access=min(eligible)
        c=next(c for c in companies if c['id']==cid);f,b,parents,backparents=trees[cid]
        ordered=access_steps(chunk[0]['u'],parents)+chunk+access_steps(chunk[-1]['v'],backparents,True)
        if not ordered or ordered[0]['u']!=c['depot_node'] or ordered[-1]['v']!=c['depot_node']:raise AssertionError('Not closed at depot')
        for i,s in enumerate(ordered):
            if not transit.has_edge(s['u'],s['v'],s['original_key']):raise AssertionError('Illegal arc')
            if i and ordered[i-1]['v']!=s['u']:raise AssertionError('Discontinuity')
            if s['service']:covered[s['task_id']]+=1
        tripid=len(full);tm=metrics(ordered);workload[cid]+=tm['hours']
        vehicle=min(range(c['fleet_limit']),key=lambda i:vehicle_loads[cid][i])
        vehicle_loads[cid][vehicle]+=tm['hours'];vehicle_jobs[cid][vehicle].append(tripid)
        task_count=sum(s['service'] for s in ordered)
        features=[]
        for s in ordered:
            if not features or features[-1]['properties']['service']!=s['service']:
                features.append(dict(type='Feature',properties=dict(trip=tripid,service=s['service']),geometry=dict(type='LineString',coordinates=[[round(transit.nodes[s['u']]['lon'],6),round(transit.nodes[s['u']]['lat'],6)]])))
            features[-1]['geometry']['coordinates'].append([round(transit.nodes[s['v']]['lon'],6),round(transit.nodes[s['v']]['lat'],6)])
        c['trips'].append(dict(id=tripid,task_count=task_count,**tm,features=features))
        full.append(dict(id=tripid,company=cid,steps=ordered,**tm))
    required={k for u,v,k in work.edges(keys=True)}
    missing=required-set(covered)
    if set(covered)-required or any(v!=1 for v in covered.values()):raise AssertionError('Duplicate/foreign service tasks')
    if missing!={s['task_id'] for s in unassigned}:raise AssertionError('Coverage audit mismatch')
    results=[]
    for c in companies:
        scenarios=[]
        for count in ([c['fleet_limit']] if args.joint else range(1,c['fleet_limit']+1)):
            if args.joint:
                byid={t['id']:t for t in c['trips']}
                routes=[dict(vehicle_id=i+1,trip_ids=ids,**{k:sum(byid[t][k] for t in ids) for k in ['hours','service_km','deadhead_km','distance_km']}) for i,ids in enumerate(vehicle_jobs[c['id']])]
            else:routes=schedule(c['trips'],count)
            used=[t for r in routes for t in r['trip_ids']]
            if len(set(used))!=len(used) or set(used)!={t['id'] for t in c['trips']}:raise AssertionError('Schedule lost/duplicated jobs')
            scenarios.append(dict(vehicles=count,routes=routes,validation=dict(valid=True,covered=sum(t['task_count'] for t in c['trips']),closed_at_depot=True)))
        results.append({k:c[k] for k in ['id','name','fleet_limit','fleet_basis','depot_node','depot','snap_distance_m','trips']}|dict(scenarios=scenarios))
    missing_geometry=dict(type='FeatureCollection',features=[dict(type='Feature',properties=dict(task_id=s['task_id'],reason='4社の出発道路ノードから往復到達できない'),geometry=dict(type='LineString',coordinates=[[transit.nodes[n]['lon'],transit.nodes[n]['lat']] for n in [s['u'],s['v']]])) for s in unassigned])
    summary=dict(required_arcs=len(required),assigned_arcs=len(covered),unassigned_arcs=len(missing),duplicate_service_arcs=0,
                 fleet=sum(c['fleet_limit'] for c in companies),total_hours=sum(workload.values()),
                 baseline_makespan_hours=max(max(r['hours'] for r in c['scenarios'][-1]['routes']) for c in results),
                 unassigned_reason='追加した回送道路を含めても、公開4社の出発道路ノードから往復可能な経路を確認できない区間。',
                 all_tasks_assigned=not missing,valid_assigned_routes=True,trip_count=len(full))
    data=dict(companies=results,summary=summary,unassigned_geometry=missing_geometry,
              scope='広域431,116方向区間を4社で重複なく分担。実契約地区ではなく所在地・公表台数を使う仮定配車。',
              method='広域閉路を約2時間の作業単位に分割し、台数当たり負荷と往復回送を考慮して4社へ割当。各社内は長時間作業順に最も空いた車両へ配分。全体最適性の保証なし。',
              fleet_note='公表主要機種による仮定上限。実稼働・装備・車幅は未確認。台数変更は固定担当区間内の再配分で、他社の担当は変えない。',
              origin_note='所在地代表点から最寄り道路へスナップ。構内・入口から道路までの未確認接続は距離・時間に含まない。',
              transit_note='回送用にtrunk/trunk_link/serviceを追加。motorroad=yesは除外。車両別通行可否、旋回、季節規制は未検証。')
    data['mode']='joint' if args.joint else 'fixed'
    if args.joint:data['method']='会社担当を固定せず全30台の候補から、車両の完了予測時間＋0.2×今回の回送時間が最小の車両へ作業を直接割当。近似解で全体最適性の保証なし。'
    with gzip.open(out/f'{prefix}_ordered_routes.json.gz','wt',encoding='utf-8') as f:json.dump(full,f,ensure_ascii=False,separators=(',',':'))
    (out/f'{prefix}_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    (out/f'{prefix}_unassigned.geojson').write_text(json.dumps(missing_geometry,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (out/f'{prefix}.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    webname='joint-dispatch-data.js' if args.joint else 'dispatch-data.js'
    variable='JOINT_ROUTES' if args.joint else 'CONTRACTOR_ROUTES'
    (ROOT/('web/'+webname)).write_text('window.'+variable+' = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=True),flush=True)

if __name__=='__main__':main()
