"""Spatial territories + direct inter-job routing. Builds fixed and joint modes."""
import gzip,json,sys
from collections import Counter,defaultdict
from pathlib import Path
import networkx as nx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from src.routing import build_graph,travel_graph,distance,metrics,DRIVABLE
from src.spatial_routing import nearest_target_path,contiguous_groups
from scripts.run_dispatch import LIMITS

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
    jobs=[]
    def add_job(steps):
        if any(s['service'] for s in steps):jobs.append(dict(id=len(jobs),steps=steps,**metrics(steps)))
    for tour in load('data/processed/city_routes.json'):
        chunk=[];elapsed=0
        for s in tour['steps']:
            if chunk and (elapsed>=900 or distance(g.nodes[chunk[0]['u']],g.nodes[s['v']])>750):
                add_job(chunk);chunk=[];elapsed=0
            chunk.append(s);elapsed+=s['service_s'] if s['service'] else s['cost']/1000
        add_job(chunk)
    for e in load('data/processed/city_excluded_arcs.json'):
        a=work[e['u']][e['v']][e['task_id']]
        add_job([dict(u=e['u'],v=e['v'],task_id=e['task_id'],original_key=e['task_id'],service=True,length_m=a['length_m'],service_s=a['service_s'],cost=a['cost'])])
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
    required={k for u,v,k in work.edges(keys=True)}
    for mode,owner in plans.items():
        results=[];covered=Counter();archive={'jobs':[],'scenarios':[]};prefix='joint_dispatch' if mode=='joint' else 'dispatch'
        for ci,c in enumerate(companies):
            pending={j['id']:j for j,o in zip(valid,owner) if o==ci};targets=defaultdict(set)
            for jid,j in pending.items():targets[j['steps'][0]['u']].add(jid)
            current=c['depot_node'];ordered_jobs=[];full_steps={};next_access=[]
            while pending:
                target,path=nearest_target_path(d,current,targets)
                jid=min(targets[target]);job=pending.pop(jid);targets[target].remove(jid)
                if not targets[target]:del targets[target]
                # Prefix is stored separately so a vehicle starting at this job
                # can substitute its own depot access without inheriting a detour.
                incoming=path_steps(path);body=job['steps']
                for s in body:
                    if s['service']:covered[s['task_id']]+=1
                record=dict(id=jid,task_count=sum(s['service'] for s in body),start_node=body[0]['u'],end_node=body[-1]['v'],
                            incoming_features=geometry(incoming,jid),features=geometry(body,jid),incoming_metrics=metrics(incoming),**metrics(body))
                ordered_jobs.append(record);full_steps[jid]=(incoming,body);current=body[-1]['v']
            print(mode,c['id'],'sequenced',len(ordered_jobs),'jobs',flush=True)
            scenarios=[];f,b,fp,bp=trees[ci]
            split_jobs=[dict(j,hours=j['hours']+j['incoming_metrics']['hours']) for j in ordered_jobs]
            for count in ([c['fleet_limit']] if mode=='joint' else range(1,c['fleet_limit']+1)):
                routes=[];scenario_archive=[];used=[]
                for vi,group in enumerate(contiguous_groups(split_jobs,count),1):
                    ids=[j['id'] for j in group];used+=ids
                    if not group:
                        routes.append(dict(vehicle_id=vi,trip_ids=[],head_features=[],tail_features=[],hours=0,service_km=0,deadhead_km=0,distance_km=0));continue
                    head=access(group[0]['start_node'],fp);tail=access(group[-1]['end_node'],bp,True)
                    steps=head[:]
                    for k,j in enumerate(group):
                        incoming,body=full_steps[j['id']]
                        if k:steps.extend(incoming)
                        steps.extend(body)
                    steps.extend(tail)
                    if steps[0]['u']!=c['depot_node'] or steps[-1]['v']!=c['depot_node']:raise AssertionError('Not closed')
                    for k,s in enumerate(steps):
                        if not g.has_edge(s['u'],s['v'],s['original_key']):raise AssertionError('Illegal direction')
                        if k and steps[k-1]['v']!=s['u']:raise AssertionError('Disconnected route')
                    routes.append(dict(vehicle_id=vi,trip_ids=ids,head_features=geometry(head,-1),tail_features=geometry(tail,-1),**metrics(steps)))
                    scenario_archive.append(dict(vehicle=vi,trip_ids=ids,head=head,tail=tail))
                if len(set(used))!=len(used) or set(used)!=set(full_steps):raise AssertionError('Lost/duplicate jobs')
                scenarios.append(dict(vehicles=count,routes=routes,validation=dict(valid=True,covered=sum(j['task_count'] for j in ordered_jobs),closed_at_depot=True)))
                archive['scenarios'].append(dict(company=c['id'],vehicles=count,routes=scenario_archive))
            archive['jobs'].extend(dict(company=c['id'],id=jid,incoming=inc,body=body) for jid,(inc,body) in full_steps.items())
            results.append({k:c[k] for k in ['id','name','fleet_limit','fleet_basis','depot_node','depot','snap_distance_m']}|dict(trips=ordered_jobs,scenarios=scenarios))
        missing=required-set(covered)
        if set(covered)-required or any(n!=1 for n in covered.values()) or missing!={s['task_id'] for s in unassigned}:raise AssertionError('Global coverage mismatch')
        baseline=[r for c in results for r in c['scenarios'][-1]['routes']]
        summary=dict(required_arcs=len(required),assigned_arcs=len(covered),unassigned_arcs=len(missing),duplicate_service_arcs=0,fleet=30,
                     total_hours=sum(r['hours'] for r in baseline),total_deadhead_km=sum(r['deadhead_km'] for r in baseline),
                     total_service_km=sum(r['service_km'] for r in baseline),baseline_makespan_hours=max(r['hours'] for r in baseline),
                     all_tasks_assigned=not missing,valid_assigned_routes=True,trip_count=len(valid),previous=previous[mode],
                     territory_offsets_hours=best[2] if mode=='joint' else [0]*4)
        missing_geometry=load('data/processed/dispatch_unassigned.geojson')
        if {f['properties']['task_id'] for f in missing_geometry['features']}!=missing:raise AssertionError('Unassigned map differs from audit')
        data=dict(mode=mode,route_format='direct_jobs',companies=results,summary=summary,unassigned_geometry=missing_geometry,
                  scope='広域431,116方向区間の仮の割当。実契約地区ではない。',
                  method='道路往復時間で区域を作成し、道路上の最寄り作業開始点を順に接続。連続する経路を車両へ分割し、最初に出発・最後に帰庫。'+('全社台数で区域境界を調整。' if mode=='joint' else '会社所在地への近さを優先。')+'近似解で最適性・区域の完全な連結性の保証なし。',
                  transit_note='市外も含む。車種別通行・右左折制限・雪量・実稼働は未検証。',
                  fleet_note='固定区域方式のみ台数を変更可能。機種は公表主要機種の仮定。',origin_note='入口と道路の未確認接続は未算入。')
        with gzip.open(out/f'{prefix}_ordered_routes.json.gz','wt',encoding='utf-8') as file:json.dump(archive,file,ensure_ascii=False,separators=(',',':'))
        (out/f'{prefix}.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        (out/f'{prefix}_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        name='joint-dispatch-data.js' if mode=='joint' else 'dispatch-data.js';variable='JOINT_ROUTES' if mode=='joint' else 'CONTRACTOR_ROUTES'
        (ROOT/('web/'+name)).write_text('window.'+variable+' = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
        print(mode,summary['total_hours'],summary['baseline_makespan_hours'],summary['total_deadhead_km'],flush=True)

if __name__=='__main__':main()
