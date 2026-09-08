"""Spatial territories + direct inter-job routing. Builds fixed and joint modes."""
import gzip,json,sys
from collections import Counter,defaultdict
from pathlib import Path
import networkx as nx
from shapely.geometry import shape,Point
from shapely.prepared import prep
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from src.routing import build_graph,travel_graph,distance,metrics,DRIVABLE
from src.spatial_routing import bisect_groups,improve_order
from scripts.run_dispatch import LIMITS

SHIFT_HOURS=8  # one shift: leave the depot, work, return; the next shift restarts from the depot

def main():
    out=ROOT/'data/processed';load=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
    previous={m:load(f'data/processed/{p}_summary.json') for m,p in [('fixed','dispatch'),('joint','joint_dispatch')]}
    previous={m:s.get('previous',s) for m,s in previous.items()}
    meta=load('data/city_roads_source.json');DRIVABLE.difference_update({'trunk','trunk_link','service'})
    work,_=build_graph(load('data/raw/city_roads_osm.json'),meta['bbox'])
    extra=load('data/raw/transit_roads_osm.json');extra['elements']=[e for e in extra['elements'] if e.get('tags',{}).get('motorroad')!='yes']
    DRIVABLE.update({'trunk','trunk_link','service'});g,_=build_graph(extra,meta['bbox']);del extra
    g.add_nodes_from(work.nodes(data=True))
    for u,v,k,a in work.edges(keys=True,data=True):g.add_edge(u,v,key=k,**a)
    d=travel_graph(g);companies=load('data/processed/contractors.json');trees=[]
    for c in companies:
        loc=dict(lat=c['latitude'],lon=c['longitude']);node=min(d,key=lambda n:distance(loc,d.nodes[n]))
        c.update(depot_node=node,depot=dict(d.nodes[node]),snap_distance_m=distance(loc,d.nodes[node]),fleet_limit=LIMITS[c['id']][0],fleet_basis=LIMITS[c['id']][1])
        p,f=nx.dijkstra_predecessor_and_distance(d,node,weight='weight');fp={n:x[0] for n,x in p.items() if x}
        p,b=nx.dijkstra_predecessor_and_distance(d.reverse(copy=False),node,weight='weight');bp={n:x[0] for n,x in p.items() if x}
        trees.append((f,b,fp,bp));print('Tree',c['id'],flush=True)
    def path_steps(path):
        return [dict(u=u,v=v,task_id=None,original_key=d[u][v]['key'],service=False,length_m=g[u][v][d[u][v]['key']]['length_m'],service_s=0,cost=d[u][v]['weight']) for u,v in zip(path,path[1:])]
    def access(node,parents,back=False):
        path=[node]
        while path[-1] in parents:path.append(parents[path[-1]])
        return path_steps(path if back else path[::-1])
    def geometry(steps,trip):
        features=[]
        for s in steps:
            if not features or features[-1]['properties']['service']!=s['service']:
                features.append(dict(type='Feature',properties=dict(trip=trip,service=s['service']),geometry=dict(type='LineString',coordinates=[[round(g.nodes[s['u']]['lon'],6),round(g.nodes[s['u']]['lat'],6)]])))
            features[-1]['geometry']['coordinates'].append([round(g.nodes[s['v']]['lon'],6),round(g.nodes[s['v']]['lat'],6)])
        return features
    boundary=load('data/processed/sapporo_boundary.geojson')
    city_poly=prep(shape(boundary['geometry'] if boundary.get('type')=='Feature' else boundary['features'][0]['geometry']))
    def in_city(st):
        a,b_=g.nodes[st['u']],g.nodes[st['v']]
        return city_poly.contains(Point((a['lon']+b_['lon'])/2,(a['lat']+b_['lat'])/2))
    out_of_scope=[]  # service arcs outside the Sapporo boundary: not part of the work set
    jobs=[]
    def add_job(steps,tour=None,pos=None):
        # tour/pos remember the Euler-circuit origin: consecutive chunks of one circuit join
        # with zero deadhead, so sequencing keeps them together as fragments.
        if any(s['service'] for s in steps):jobs.append(dict(id=len(jobs),steps=steps,tour=tour,pos=pos,**metrics(steps)))
    for ti,tour in enumerate(load('data/processed/city_routes.json')):
        chunk=[];elapsed=0;pos=0
        for s in tour['steps']:
            if s['service'] and not in_city(s):
                # out-of-city arc: close the current chunk and leave this arc out of the work set
                out_of_scope.append(s)
                if chunk:add_job(chunk,ti,pos);pos+=1
                chunk=[];elapsed=0;continue
            if not chunk and not s['service']:continue  # a chunk starts with work, not with a connector
            if chunk and (elapsed>=900 or distance(g.nodes[chunk[0]['u']],g.nodes[s['v']])>750):
                add_job(chunk,ti,pos);pos+=1;chunk=[];elapsed=0
            chunk.append(s);elapsed+=s['service_s'] if s['service'] else s['cost']/1000
        add_job(chunk,ti,pos)
    for e in load('data/processed/city_excluded_arcs.json'):
        a=work[e['u']][e['v']][e['task_id']]
        st=dict(u=e['u'],v=e['v'],task_id=e['task_id'],original_key=e['task_id'],service=True,length_m=a['length_m'],service_s=a['service_s'],cost=a['cost'])
        if in_city(st):add_job([st])
        else:out_of_scope.append(st)
    print('Out-of-city service arcs excluded',len(out_of_scope),flush=True)
    valid=[];unassigned=[]
    for j in jobs:
        steps=j['steps'];sample=[steps[0]['u'],steps[len(steps)//2]['u'],steps[-1]['v']]
        j['scores']=[sum(f[n]+b[n] for n in sample)/len(sample)/3600000 if all(n in f and n in b for n in sample) else float('inf') for f,b,_,_ in trees]
        if min(j['scores'])==float('inf'):unassigned.extend(s for s in steps if s['service'])
        else:valid.append(j)
    print('Local jobs',len(valid),'unassigned tasks',len(unassigned),flush=True)
    def territory(offsets):
        owner=[min(range(4),key=lambda i:(j['scores'][i]+offsets[i],i)) for j in valid]
        hours=[0]*4
        for j,i in zip(valid,owner):hours[i]+=j['hours']
        return owner,hours
    owners,hours=territory([0]*4);plans={'fixed':owners};offsets=[0.0]*4
    # Additive network-distance weights move whole territory boundaries rather than
    # assigning scattered jobs according to momentary vehicle availability.
    best=(max(hours[i]/companies[i]['fleet_limit'] for i in range(4)),owners[:],offsets[:])
    for iteration in range(120):
        owner,h=territory(offsets);average=sum(h)/sum(c['fleet_limit'] for c in companies)
        score=max(h[i]/companies[i]['fleet_limit'] for i in range(4))
        if score<best[0]:best=(score,owner[:],offsets[:])
        step=.001/(1+iteration/30)
        for i,c in enumerate(companies):offsets[i]+=step*(h[i]/c['fleet_limit']-average)
    plans['joint']=best[1]
    out_ids={s['task_id'] for s in out_of_scope}
    required={k for u,v,k in work.edges(keys=True)}-out_ids
    for mode,owner in plans.items():
        results=[];covered=Counter();archive={'jobs':[],'scenarios':[]};prefix='joint_dispatch' if mode=='joint' else 'dispatch'
        for ci,c in enumerate(companies):
            company_jobs=[j for j,o in zip(valid,owner) if o==ci]
            for j in company_jobs:
                for s in j['steps']:
                    if s['service']:covered[s['task_id']]+=1
            f,b,fp,bp=trees[ci];depot_pos=(c['depot']['lat'],c['depot']['lon']);job_by_id={j['id']:j for j in company_jobs}
            position=lambda j:(g.nodes[j['steps'][0]['u']]['lat'],g.nodes[j['steps'][0]['u']]['lon'])
            def cell_walk(group):
                """Rural postman for one vehicle: balance the cell's service arcs with shortest deadhead
                paths (transportation problem on the road graph), take an Euler circuit per component,
                join components nearest-first from the depot. Returns the closed list of steps."""
                required=[st for j in group for st in j['steps'] if st['service']]
                bal=Counter()
                for st in required:bal[st['u']]+=1;bal[st['v']]-=1
                surplus={n:k for n,k in bal.items() if k>0};deficit={n:-k for n,k in bal.items() if k<0}
                aug=nx.MultiDiGraph()
                for st in required:aug.add_edge(st['u'],st['v'],step=st)
                if deficit:
                    B=nx.DiGraph();paths={}
                    for n,k in deficit.items():B.add_node(('D',n),demand=-k)
                    for n,k in surplus.items():B.add_node(('S',n),demand=k)
                    for n in deficit:
                        cost,par=dijkstra_to(n,set(surplus))
                        for m in surplus:
                            if m in cost:B.add_edge(('D',n),('S',m),weight=int(cost[m]),capacity=10**6);paths[(n,m)]=trace(par,n,m)
                    flow=nx.min_cost_flow(B)
                    for dn,fl in flow.items():
                        for sn,amount in fl.items():
                            for _ in range(amount):
                                for st in path_steps(paths[(dn[1],sn[1])]):aug.add_edge(st['u'],st['v'],step=st)
                components=[aug.subgraph(cn).copy() for cn in nx.weakly_connected_components(aug)]
                # Component visiting order: approximate hop costs (nearest node pair, directed road cost),
                # nearest-first from the depot, then Or-opt with the return-to-depot cost included.
                node_sets=[set(cn) for cn in components];K=len(components)
                hop_cost={}
                if K>1:
                    for i in range(K):
                        others=set().union(*(node_sets[j] for j in range(K) if j!=i))
                        cost=multi_source_costs(node_sets[i],others)
                        for j in range(K):
                            if j!=i:hop_cost[(i,j)]=min(cost.get(n,float('inf')) for n in node_sets[j])
                depot_cost=multi_source_costs({c['depot_node']},set().union(*node_sets))
                start_cost=lambda i:min(depot_cost.get(n,float('inf')) for n in node_sets[i])
                end_cost=lambda i:min(b.get(n,float('inf')) for n in node_sets[i])
                order=[];remaining=list(range(K));cur=None
                while remaining:
                    nxt=min(remaining,key=lambda j:start_cost(j) if cur is None else hop_cost[(cur,j)])
                    order.append(nxt);remaining.remove(nxt);cur=nxt
                if K>1:order=improve_order(order,lambda i,j:hop_cost[(i,j)],start_cost,end_cost,max_segment=3,max_passes=30)
                current_nodes={c['depot_node']};walk=[]
                for i in order:
                    entry,par=multi_source_nearest(current_nodes,node_sets[i])
                    hop=trace_back(par,current_nodes,entry);walk.extend(path_steps(hop))
                    comp=components[i]
                    for u,v,k in nx.eulerian_circuit(comp,source=entry,keys=True):walk.append(comp[u][v][k]['step'])
                    current_nodes={entry}
                walk.extend(access(walk[-1]['v'],bp,True) if walk else [])
                return walk
            def dijkstra_to(src,targets):
                import heapq
                q=[(0,src)];cost={src:0};par={};found=0
                while q and found<len(targets):
                    cst,u=heapq.heappop(q)
                    if cst!=cost[u]:continue
                    if u in targets:found+=1
                    for v,a in d[u].items():
                        nc=cst+a['weight']
                        if nc<cost.get(v,float('inf')):cost[v]=nc;par[v]=u;heapq.heappush(q,(nc,v))
                return cost,par
            def trace(par,src,dst):
                pth=[dst]
                while pth[-1]!=src:pth.append(par[pth[-1]])
                return pth[::-1]
            def multi_source_costs(sources,targets):
                import heapq
                q=[(0,n) for n in sources];cost={n:0 for n in sources};found=0;targets=set(targets)-set(sources)
                while q and found<len(targets):
                    cst,u=heapq.heappop(q)
                    if cst!=cost[u]:continue
                    if u in targets:found+=1
                    for v,a in d[u].items():
                        nc=cst+a['weight']
                        if nc<cost.get(v,float('inf')):cost[v]=nc;heapq.heappush(q,(nc,v))
                return cost
            def multi_source_nearest(sources,targets):
                import heapq
                q=[(0,n) for n in sources];cost={n:0 for n in sources};par={}
                while q:
                    cst,u=heapq.heappop(q)
                    if cst!=cost[u]:continue
                    if u in targets:return u,par
                    for v,a in d[u].items():
                        nc=cst+a['weight']
                        if nc<cost.get(v,float('inf')):cost[v]=nc;par[v]=u;heapq.heappush(q,(nc,v))
                raise ValueError('Component unreachable')
            def trace_back(par,sources,dst):
                pth=[dst]
                while pth[-1] not in sources:pth.append(par[pth[-1]])
                return pth[::-1]
            def chunk_trips(walk,base_id,return_steps=False):
                """Cut a vehicle walk into ~15 min / 750 m display units (trips) without breaking continuity."""
                trips=[];chunk=[];elapsed=0
                for st in walk:
                    if chunk and (elapsed>=900 or distance(g.nodes[chunk[0]['u']],g.nodes[st['v']])>750):
                        trips.append(chunk);chunk=[];elapsed=0
                    chunk.append(st);elapsed+=st['service_s'] if st['service'] else st['cost']/1000
                if chunk:trips.append(chunk)
                # A chunk with no service arc would show as a vehicle driving somewhere for nothing:
                # fold connector-only chunks into the previous trip (or the next one at the start).
                merged=[]
                for ch in trips:
                    if merged and (not any(st['service'] for st in ch) or not any(st['service'] for st in merged[-1])):merged[-1].extend(ch)
                    else:merged.append(ch)
                trips=merged;trip_steps=trips
                records=[]
                for k,steps in enumerate(trips):
                    tid=base_id+k
                    records.append(dict(id=tid,task_count=sum(st['service'] for st in steps),start_node=steps[0]['u'],end_node=steps[-1]['v'],
                                        incoming_features=[],features=geometry(steps,tid),incoming_metrics=metrics([]),**metrics(steps)))
                return (records,trip_steps) if return_steps else records
            scenarios=[];standard_trips=[]
            counts=[c['fleet_limit']]  # standard fleet only in both modes; a fleet sweep made the page 131 MB
            total_tasks=sum(sum(st['service'] for st in j['steps']) for j in company_jobs)
            for count in counts:
                routes=[];scenario_archive=[];scenario_trips=[];served=Counter();next_id=0
                for vi,group in enumerate(bisect_groups(company_jobs,count,position),1):
                    if not group:
                        routes.append(dict(vehicle_id=vi,trip_ids=[],head_features=[],tail_features=[],incoming_features=[],hours=0,service_km=0,deadhead_km=0,distance_km=0));continue
                    body=cell_walk(group)
                    # body starts with the hop from the depot (head) and ends with the return (tail)
                    first_service=next(i for i,st in enumerate(body) if st['service']);last_service=max(i for i,st in enumerate(body) if st['service'])
                    head=body[:first_service];core=body[first_service:last_service+1];tail=body[last_service+1:]
                    steps=head+core+tail
                    if steps[0]['u']!=c['depot_node'] or steps[-1]['v']!=c['depot_node']:raise AssertionError('Not closed')
                    for k,st in enumerate(steps):
                        if not g.has_edge(st['u'],st['v'],st['original_key']):raise AssertionError('Illegal direction')
                        if k and steps[k-1]['v']!=st['u']:raise AssertionError('Disconnected route')
                    for st in core:
                        if st['service']:served[st['task_id']]+=1
                    trips,trip_steps=chunk_trips(core,next_id,return_steps=True);next_id+=len(trips);scenario_trips.extend(trips)
                    # Split into shifts: each shift leaves the depot, works at most SHIFT_HOURS including the
                    # return trip, and the next shift starts again from the depot.
                    shifts=[];cur=None;cur_end=None
                    def close(cur,cur_end):
                        tail_=access(cur_end,bp,True);cur['steps'].extend(tail_);cur['tail']=tail_;shifts.append(cur)
                    for k,chunk in enumerate(trip_steps):
                        body_=chunk
                        if cur is None or cur['hours']+metrics(chunk)['hours']+b[chunk[-1]['v']]/1000/3600>SHIFT_HOURS and cur['trip_idx']:
                            if cur is not None:close(cur,cur_end)
                            while len(body_)>1 and not body_[0]['service']:body_=body_[1:]  # a new shift heads straight to the work
                            head_=access(body_[0]['u'],fp);cur=dict(steps=head_[:],head=head_,trip_idx=[],hours=metrics(head_)['hours'])
                        cur['steps'].extend(body_);cur['trip_idx'].append(k);cur['hours']+=metrics(body_)['hours'];cur_end=body_[-1]['v']
                    close(cur,cur_end)
                    steps=[st for sh in shifts for st in sh['steps']]
                    for k,st in enumerate(steps):
                        if not g.has_edge(st['u'],st['v'],st['original_key']):raise AssertionError('Illegal direction')
                        if k and steps[k-1]['v']!=st['u']:raise AssertionError('Disconnected route')
                    for sh in shifts:
                        if sh['steps'][0]['u']!=c['depot_node'] or sh['steps'][-1]['v']!=c['depot_node']:raise AssertionError('Shift not closed')
                    shift_records=[dict(shift=i+1,trip_ids=[trips[k]['id'] for k in sh['trip_idx']],head_features=geometry(sh['head'],-1),tail_features=geometry(sh['tail'],-1),**metrics(sh['steps'])) for i,sh in enumerate(shifts)]
                    routes.append(dict(vehicle_id=vi,trip_ids=[t['id'] for t in trips],head_features=shift_records[0]['head_features'],tail_features=shift_records[-1]['tail_features'],
                                       incoming_features=[[] for _ in trips],shifts=shift_records,shift_count=len(shift_records),shift_hours=SHIFT_HOURS,**metrics(steps)))
                    scenario_archive.append(dict(vehicle=vi,shifts=[dict(head=sh['head'],core=[st for k in sh['trip_idx'] for st in trip_steps[k]],tail=sh['tail']) for sh in shifts]))
                expected=Counter(st['task_id'] for j in company_jobs for st in j['steps'] if st['service'])
                if served!=expected:raise AssertionError('Cell coverage mismatch')
                scenarios.append(dict(vehicles=count,routes=routes,trips=None if count==counts[-1] else scenario_trips,validation=dict(valid=True,covered=total_tasks,closed_at_depot=True)))
                archive['scenarios'].append(dict(company=c['id'],vehicles=count,routes=scenario_archive))
                print(mode,c['id'],count,'vehicles routed, deadhead',round(sum(r['deadhead_km'] for r in routes),1),'km',flush=True)
                standard_trips=scenario_trips
            ordered_jobs=standard_trips
            archive['jobs'].extend(dict(company=c['id'],id=j['id'],body=j['steps']) for j in company_jobs)
            results.append({k:c[k] for k in ['id','name','fleet_limit','fleet_basis','depot_node','depot','snap_distance_m']}|dict(trips=ordered_jobs,scenarios=scenarios))
        missing=required-set(covered)
        if set(covered)-required or any(n!=1 for n in covered.values()) or missing!={s['task_id'] for s in unassigned}:raise AssertionError('Global coverage mismatch')
        baseline=[r for c in results for r in c['scenarios'][-1]['routes']]
        summary=dict(required_arcs=len(required),assigned_arcs=len(covered),unassigned_arcs=len(missing),duplicate_service_arcs=0,fleet=30,
                     total_hours=sum(r['hours'] for r in baseline),total_deadhead_km=sum(r['deadhead_km'] for r in baseline),
                     total_service_km=sum(r['service_km'] for r in baseline),baseline_makespan_hours=max(r['hours'] for r in baseline),
                     all_tasks_assigned=not missing,valid_assigned_routes=True,trip_count=sum(len(c['trips']) for c in results),previous=previous[mode],
                     territory_offsets_hours=best[2] if mode=='joint' else [0]*4,
                     out_of_scope_arcs=len(out_ids),scope_note='札幌市境（OSM行政界）の内側の区間のみを作業対象とし、市外区間は対象外として除外。',
                     shift_hours=SHIFT_HOURS,baseline_days=max(r['shift_count'] for r in baseline),total_shifts=sum(r['shift_count'] for r in baseline))
        reason='追加した回送道路を含めても、公開4社の出発道路ノードから往復可能な経路を確認できない市内区間。'
        missing_geometry=dict(type='FeatureCollection',features=[dict(type='Feature',properties=dict(task_id=s['task_id'],reason=reason),geometry=dict(type='LineString',coordinates=[[round(g.nodes[s['u']]['lon'],6),round(g.nodes[s['u']]['lat'],6)],[round(g.nodes[s['v']]['lon'],6),round(g.nodes[s['v']]['lat'],6)]])) for s in unassigned])
        if {f['properties']['task_id'] for f in missing_geometry['features']}!=missing:raise AssertionError('Unassigned map differs from audit')
        (out/f'{prefix}_unassigned.geojson').write_text(json.dumps(missing_geometry,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        data=dict(mode=mode,route_format='direct_jobs',companies=results,summary=summary,unassigned_geometry=missing_geometry,
                  scope='札幌市内の方向区間の仮の割当（市外区間は対象外）。実契約地区ではない。',
                  method='道路往復時間で会社の区域を作成し、作業時間が均等になるよう地理的に二分割を繰り返して車両ごとの連続した担当区域に分割。各区域では担当区間を郵便配達人問題として解き直し（不足する接続を道路最短経路で補い、成分ごとにEuler閉路）、成分の訪問順は帰庫コストを含めて最寄り順＋Or-optで決めて最初に出発・最後に帰庫。各車両の経路は8時間のシフトに分け、シフトごとに所在地から出発して帰庫する。'+('全社台数で区域境界を調整。' if mode=='joint' else '会社所在地への近さを優先。')+'近似解で最適性・区域の完全な連結性の保証なし。',
                  transit_note='回送は市外道路も通行可。車種別通行・右左折制限・雪量・実稼働は未検証。',
                  fleet_note='両方式とも台数は公表主要機種による標準台数で固定。機種は公表主要機種の仮定。',origin_note='入口と道路の未確認接続は未算入。')
        with gzip.open(out/f'{prefix}_ordered_routes.json.gz','wt',encoding='utf-8') as file:json.dump(archive,file,ensure_ascii=False,separators=(',',':'))
        (out/f'{prefix}.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        (out/f'{prefix}_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        print(mode,summary['total_hours'],summary['baseline_makespan_hours'],summary['total_deadhead_km'],flush=True)

if __name__=='__main__':
    main()
    from build_web_geometry import main as build_web_geometry
    build_web_geometry()
