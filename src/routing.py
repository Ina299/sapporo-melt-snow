"""Directed Chinese Postman + heuristic multi-depot route splitting.

The exact guarantee applies only to the single closed tour on the supplied
strongly connected directed graph, with fixed integer deadhead costs.
Every legal direction is a separate service task (conservative two-way policy).
"""
import math
from collections import Counter
import networkx as nx

DRIVABLE={'primary','secondary','tertiary','unclassified','residential','living_street',
          'primary_link','secondary_link','tertiary_link'}

def distance(a,b):
    lat1,lon1,lat2,lon2=map(math.radians,[a['lat'],a['lon'],b['lat'],b['lon']])
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8*2*math.asin(min(1,math.sqrt(h)))

def build_graph(payload,bbox,service_kph=8,deadhead_kph=20):
    if min(service_kph,deadhead_kph)<=0: raise ValueError('Speeds must be positive')
    nodes={n['id']:n for n in payload['elements'] if n['type']=='node'}
    g=nx.MultiDiGraph()
    excluded=Counter()
    south,west,north,east=bbox
    def inside(n): return south<=n['lat']<=north and west<=n['lon']<=east
    for way in payload['elements']:
        if way['type']!='way' or 'highway' not in way.get('tags',{}): continue
        tags=way['tags']
        if tags['highway'] not in DRIVABLE:
            excluded['way:highway_'+tags['highway']]+=1; continue
        access=next((tags[k] for k in ['motor_vehicle','vehicle','access'] if k in tags),'yes')
        if access not in {'yes','permissive','designated'} or tags.get('area')=='yes':
            excluded['way:access_or_area']+=1; continue
        oneway=tags.get('oneway', 'yes' if tags.get('junction')=='roundabout' else 'no')
        if oneway not in {'yes','1','true','-1','no','0','false'}:
            excluded['way:ambiguous_oneway']+=1; continue
        ids=way['nodes']
        for i,(u,v) in enumerate(zip(ids,ids[1:])):
            if u not in nodes or v not in nodes:
                excluded['segment:missing_node']+=1; continue
            if not (inside(nodes[u]) and inside(nodes[v])):
                excluded['segment:outside_or_crosses_bbox']+=1; continue
            length=distance(nodes[u],nodes[v])
            if length<0.01: continue
            directions=[(v,u)] if oneway=='-1' else [(u,v)]
            if oneway in {'no','0','false'}: directions.append((v,u))
            for a,b in directions:
                for n in [a,b]: g.add_node(n,lat=nodes[n]['lat'],lon=nodes[n]['lon'])
                key=f'{way["id"]}:{i}:{a}:{b}'
                g.add_edge(a,b,key=key,task_id=key,way_id=way['id'],segment_id=f'{way["id"]}:{i}',
                    name=tags.get('name','名称未登録'),highway=tags['highway'],length_m=length,
                    service_s=length/(service_kph/3.6),cost=max(1,round(length/(deadhead_kph/3.6)*1000)),
                    tags=tags)
    restrictions=sum(1 for e in payload['elements'] if e['type']=='relation' and e.get('tags',{}).get('type')=='restriction')
    return g,dict(exclusions=dict(excluded),turn_restriction_relations_in_snapshot=restrictions,
                  required_arcs=g.number_of_edges(),required_segments=len({d['segment_id'] for *_,d in g.edges(data=True)}))

def travel_graph(g):
    d=nx.DiGraph()
    d.add_nodes_from(g.nodes(data=True))
    for u,v,k,a in g.edges(keys=True,data=True):
        if not d.has_edge(u,v) or a['cost']<d[u][v]['weight']:
            d.add_edge(u,v,weight=a['cost'],key=k)
    return d

def postman(g,source=None):
    if not g.number_of_edges() or not nx.is_strongly_connected(g):
        raise ValueError('A nonempty strongly connected directed graph is required')
    d=travel_graph(g)
    # net incoming correction must equal original out-degree minus in-degree.
    for n in d: d.nodes[n]['demand']=g.out_degree(n)-g.in_degree(n)
    flow=nx.min_cost_flow(d)
    aug=nx.MultiDiGraph()
    aug.add_nodes_from(g.nodes(data=True))
    for u,v,k,a in g.edges(keys=True,data=True):
        aug.add_edge(u,v,task_id=k,service=True,original_key=k,**{n:a[n] for n in ['length_m','service_s','cost']})
    for u,adj in flow.items():
        for v,count in adj.items():
            a=g[u][v][d[u][v]['key']]
            for _ in range(count):
                aug.add_edge(u,v,task_id=None,service=False,original_key=d[u][v]['key'],length_m=a['length_m'],service_s=0,cost=a['cost'])
    route=[]
    for u,v,k in nx.eulerian_circuit(aug,source=source,keys=True):
        route.append(dict(u=u,v=v,**aug[u][v][k]))
    return route

def path_steps(g,d,u,v):
    path=nx.shortest_path(d,u,v,weight='weight')
    return [dict(u=a,v=b,task_id=None,service=False,original_key=d[a][b]['key'],
                 length_m=g[a][b][d[a][b]['key']]['length_m'],service_s=0,cost=d[a][b]['weight'])
            for a,b in zip(path,path[1:])]

def metrics(steps):
    return dict(distance_km=sum(s['length_m'] for s in steps)/1000,
                service_km=sum(s['length_m'] for s in steps if s['service'])/1000,
                deadhead_km=sum(s['length_m'] for s in steps if not s['service'])/1000,
                hours=sum(s['service_s'] if s['service'] else s['cost']/1000 for s in steps)/3600)

def split_fleet(g,tour,depots,shift_hours=6,hourly_yen=12000):
    """Split a fixed postman order, then assign each chunk to the nearest available depot.
    Hard route length checks flag infeasibility. No global optimality claim.
    Depots: [{id,node,count}], count is the explicitly assumed available fleet.
    """
    if shift_hours<=0 or hourly_yen<0: raise ValueError('Invalid scenario')
    if not depots or any(p['count']<1 or not isinstance(p['count'],int) or p['node'] not in g for p in depots):
        raise ValueError('Valid depots and positive integer fleet counts required')
    task_count=sum(s['service'] for s in tour)
    count=min(sum(p['count'] for p in depots),task_count)
    cumulative=[];total=0
    for s in tour:
        total+=s['service_s'] if s['service'] else s['cost']/1000
        cumulative.append(total)
    # Maintain route continuity by making contiguous chunks of the actual Euler tour.
    cuts=[0]
    for j in range(1,count):
        lo=cuts[-1]+1; hi=len(tour)-(count-j)
        cuts.append(min(range(lo,hi+1),key=lambda i:abs(cumulative[i-1]-total*j/count)))
    cuts.append(len(tour))
    available={p['id']:p['count'] for p in depots}
    d=travel_graph(g);routes=[]
    for start,end in zip(cuts,cuts[1:]):
        chunk=tour[start:end]
        options=[]
        for p in depots:
            if not available[p['id']]: continue
            head=path_steps(g,d,p['node'],chunk[0]['u'])
            tail=path_steps(g,d,chunk[-1]['v'],p['node'])
            options.append((sum(s['cost'] for s in head+tail),p['id'],head,tail))
        _,depot,head,tail=min(options,key=lambda x:(x[0],x[1]))
        available[depot]-=1
        steps=head+chunk+tail
        m=metrics(steps)
        routes.append(dict(vehicle_id=len(routes)+1,depot_id=depot,steps=steps,**m,
                           cost_yen=m['hours']*hourly_yen,within_shift=m['hours']<=shift_hours))
    return routes

def validate_routes(g,routes):
    covered=set(); errors=[]
    for r in routes:
        steps=r['steps']
        if steps and steps[0]['u']!=steps[-1]['v']: errors.append('not_closed')
        for i,s in enumerate(steps):
            if i and steps[i-1]['v']!=s['u']: errors.append('discontinuity')
            if not g.has_edge(s['u'],s['v'],s['original_key']): errors.append('illegal_arc')
            if s['service']: covered.add(s['task_id'])
    required={k for u,v,k in g.edges(keys=True)}
    missing=sorted(required-covered)
    return dict(required=len(required),covered=len(required&covered),missing=missing,errors=errors,
                coverage= len(required&covered)/len(required) if required else 0,
                valid=not missing and not errors)
