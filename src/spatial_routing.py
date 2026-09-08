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
