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


def nearest_k_costs(graph,source,targets,k,cap=None):
    """Dijkstra from `source` that stops after `k` distinct target nodes (or cost > cap).

    Returns {target_node: cost}. Used to build a sparse job-to-job connection table:
    only the nearest starts are candidates for re-sequencing, which keeps the
    improvement step cheap on a city-scale directed road graph.
    """
    queue=[(0,source)];costs={source:0};found={}
    while queue and len(found)<k:
        cost,u=heapq.heappop(queue)
        if cost!=costs[u]:continue
        if cap is not None and cost>cap:break
        if u in targets and u not in found:found[u]=cost
        for v,a in graph[u].items():
            candidate=cost+a['weight']
            if candidate<costs.get(v,float('inf')):
                costs[v]=candidate;heapq.heappush(queue,(candidate,v))
    return found


def improve_order(order,hop,start_cost,end_cost,max_segment=3,max_passes=12):
    """Or-opt: relocate segments of 1..max_segment jobs (no reversal) while the total
    connection cost decreases. `hop(a,b)` returns the directed cost from job a's end to
    job b's start or None when unknown (then the move is skipped). `start_cost(j)` is
    depot->job, `end_cost(j)` job->depot. Directions of jobs are never changed, so
    every evaluated connection is a forward road path. Returns a new list with the
    same jobs exactly once.
    """
    seq=list(order);n=len(seq)
    if n<3:return seq
    def link(a,b):
        if a is None and b is None:return 0
        if a is None:return start_cost(b)
        if b is None:return end_cost(a)
        return hop(a,b)
    for _ in range(max_passes):
        improved=False
        i=0
        while i<n:
            for length in range(1,max_segment+1):
                if i+length>n:break
                seg=seq[i:i+length];prev=seq[i-1] if i>0 else None;nxt=seq[i+length] if i+length<n else None
                removed_gain=None
                c1=link(prev,seg[0]);c2=link(seg[-1],nxt);c3=link(prev,nxt)
                if None in (c1,c2,c3):continue
                removed_gain=c1+c2-c3
                rest=seq[:i]+seq[i+length:]
                best=None
                for pos in range(len(rest)+1):
                    a=rest[pos-1] if pos>0 else None;b=rest[pos] if pos<len(rest) else None
                    if a is seg[0] or b is seg[0]:pass
                    d1=link(a,seg[0]);d2=link(seg[-1],b);d3=link(a,b)
                    if None in (d1,d2,d3):continue
                    added=d1+d2-d3
                    if added<removed_gain-1e-9 and (best is None or added<best[0]):best=(added,pos)
                if best is not None:
                    pos=best[1];seq=rest[:pos]+seg+rest[pos:];improved=True
                    break
            i+=1
        if not improved:break
    assert sorted(map(id,seq))==sorted(map(id,order)) and len(seq)==n
    return seq


def bisect_groups(jobs,count,position):
    """Recursive balanced bisection into `count` compact, contiguous cells.

    At each step the job set is cut along its longer geographic axis at the point
    where cumulative hours reach the share of vehicles on that side, so cells are
    convex-like blocks with equal work instead of long thin wedges. `position(job)`
    returns (lat, lon). Exactly `count` groups are returned (empty ones padded).
    """
    import math
    def rec(items,k):
        if k<=1 or len(items)<=1:return [list(items)]+[[] for _ in range(k-1)]
        lats=[position(j)[0] for j in items];lons=[position(j)[1] for j in items]
        lat0=sum(lats)/len(lats);scale=math.cos(math.radians(lat0))
        span_lat=(max(lats)-min(lats))*110.57;span_lon=(max(lons)-min(lons))*111.32*scale
        key=(lambda j:position(j)[0]) if span_lat>=span_lon else (lambda j:position(j)[1])
        ordered=sorted(items,key=key)
        k1=k//2;k2=k-k1;total=sum(j['hours'] for j in ordered);target=total*k1/k
        acc=0;cut=0
        for i,j in enumerate(ordered):
            acc+=j['hours']
            if acc>=target:
                cut=i+1;break
        cut=max(1,min(cut,len(ordered)-1))
        return rec(ordered[:cut],k1)+rec(ordered[cut:],k2)
    groups=rec(list(jobs),count)
    return groups[:count] if len(groups)>count else groups+[[] for _ in range(count-len(groups))]

def refine_groups(groups,position,hours_cap,passes=12,gain=0.9,tol=0.15):
    """Remove islands left by the straight cuts of `bisect_groups`.

    Two kinds of change, both only when they shorten centroid distances: a job moves to
    the group whose centroid is clearly nearer (factor `gain`) if the receiving group stays
    within `hours_cap`; otherwise it is swapped with a job of that group that is at least
    as well placed on this side, so balanced groups can still exchange boundary jobs.
    A swap may raise a group already at the cap by at most `tol` hours (the routed tour is
    checked against the shift length afterwards). Centroids are recomputed each pass;
    stops when a pass changes nothing. Group order
    is irrelevant here (each group is routed afterwards), so groups are plain lists.
    """
    import math
    groups=[list(g) for g in groups]
    def centroid(g):
        if not g:return None
        lats=[position(j)[0] for j in g];lons=[position(j)[1] for j in g]
        return (sum(lats)/len(lats),sum(lons)/len(lons))
    def dist(a,b):
        return math.hypot((a[0]-b[0])*110.57,(a[1]-b[1])*111.32*math.cos(math.radians((a[0]+b[0])/2)))
    hours=[sum(j['hours'] for j in g) for g in groups]
    for _ in range(passes):
        cents=[centroid(g) for g in groups];changed=0
        for gi,g in enumerate(groups):
            for j in list(g):
                if len(g)<=1 or j not in g:break
                p=position(j);own=dist(p,cents[gi]);best=None
                for k,c in enumerate(cents):
                    if k==gi or c is None:continue
                    d=dist(p,c)
                    if d<own*gain and (best is None or d<best[0]):best=(d,k)
                if not best:continue
                d,k=best
                if hours[k]+j['hours']<=hours_cap:
                    g.remove(j);groups[k].append(j);hours[gi]-=j['hours'];hours[k]+=j['hours'];changed+=1;continue
                # swap with the job of group k that gains most by coming to group gi
                cand=None
                for j2 in groups[k]:
                    if len(groups[k])<=1:break
                    q=position(j2);gain2=dist(q,cents[k])-dist(q,cents[gi])  # >0 means j2 is better placed in gi
                    if hours[k]-j2['hours']+j['hours']<=max(hours_cap,hours[k]+tol) and hours[gi]-j['hours']+j2['hours']<=max(hours_cap,hours[gi]+tol) and (cand is None or gain2>cand[0]):cand=(gain2,j2)  # a swap may push a group over the cap by at most `tol`
                if cand and (own-d)+cand[0]>0:
                    j2=cand[1];g.remove(j);groups[k].remove(j2);groups[k].append(j);g.append(j2)
                    hours[gi]+=j2['hours']-j['hours'];hours[k]+=j['hours']-j2['hours'];changed+=1
        if not changed:break
    return groups
