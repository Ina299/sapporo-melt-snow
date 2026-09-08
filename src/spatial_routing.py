"""Road-network nearest-job sequencing and contiguous fleet splitting."""
import heapq

def nearest_target_path(graph, source, targets):
    """Dijkstra stopping at the nearest remaining job start (directed costs)."""
    queue=[(0,source)];costs={source:0};parent={}
    while queue:
        cost,u=heapq.heappop(queue)
        if cost!=costs[u]:continue
        if u in targets:
            path=[u]
            while path[-1] in parent:path.append(parent[path[-1]])
            return u,list(reversed(path))
        for v,a in graph[u].items():
            candidate=cost+a['weight']
            if candidate<costs.get(v,float('inf')):
                costs[v]=candidate;parent[v]=u;heapq.heappush(queue,(candidate,v))
    raise ValueError('Remaining jobs unreachable')

def contiguous_groups(jobs,count):
    """Split an existing local route order by cumulative time, never scatter jobs."""
    total=sum(j['hours'] for j in jobs);groups=[];start=0;elapsed=0
    for i,j in enumerate(jobs):
        elapsed+=j['hours']
        if len(groups)<count-1 and elapsed>=total*(len(groups)+1)/count and len(jobs)-i-1>=count-len(groups)-1:
            groups.append(jobs[start:i+1]);start=i+1
    groups.append(jobs[start:])
    while len(groups)<count:groups.append([])
    return groups


def sector_groups(jobs,count,depot,position):
    """Partition jobs into `count` angular sectors around the depot, balanced by hours.

    Each sector is a contiguous wedge, so a vehicle's territory is compact instead of
    scattered leftovers of a single nearest-neighbour tour. `position(job)` returns
    (lat, lon) of the job start; `depot` is (lat, lon). The wedge boundary offset is
    chosen among the job angles to minimise the largest sector load. Empty sectors are
    padded so exactly `count` groups are returned. Jobs are never lost or duplicated.
    """
    import math
    if count<=1 or len(jobs)<=1:
        groups=[list(jobs)]
    else:
        lat0=math.radians(depot[0])
        def angle(j):
            lat,lon=position(j)
            return math.atan2(lat-depot[0],(lon-depot[1])*math.cos(lat0))
        ordered=sorted(jobs,key=angle)
        total=sum(j['hours'] for j in ordered);n=len(ordered)
        def split(start):
            seq=ordered[start:]+ordered[:start];out=[];chunk=[];elapsed=0
            for i,j in enumerate(seq):
                chunk.append(j);elapsed+=j['hours']
                if len(out)<count-1 and elapsed>=total*(len(out)+1)/count and n-i-1>=count-len(out)-1:
                    out.append(chunk);chunk=[]
            out.append(chunk)
            return out
        candidates=range(0,n,max(1,n//24))
        groups=min((split(s) for s in candidates),key=lambda gs:(max(sum(j['hours'] for j in g) for g in gs),len(gs)))
    while len(groups)<count:groups.append([])
    return groups
