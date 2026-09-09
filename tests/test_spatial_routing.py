import unittest
import networkx as nx
from src.spatial_routing import nearest_target_path,contiguous_groups

class SpatialRouting(unittest.TestCase):
    def test_nearest_uses_directed_road_cost_not_geometric_proximity(self):
        g=nx.DiGraph()
        g.add_weighted_edges_from([(1,2,10),(1,3,1),(3,4,2),(2,1,1)])
        target,path=nearest_target_path(g,1,{2,4})
        self.assertEqual((target,path),(4,[1,3,4]))
        self.assertEqual(nearest_target_path(g,4,{4}),(4,[4]))
        with self.assertRaises(ValueError):nearest_target_path(g,4,{1})

    def test_vehicle_groups_preserve_local_route_order_and_all_jobs(self):
        jobs=[dict(id=i,hours=1) for i in range(10)]
        groups=contiguous_groups(jobs,3)
        self.assertEqual([[j['id'] for j in group] for group in groups],[[0,1,2,3],[4,5,6],[7,8,9]])
        self.assertEqual([j['id'] for group in groups for j in group],list(range(10)))


class RefineGroups(unittest.TestCase):
    def test_island_moves_to_nearest_cell_within_cap(self):
        from src.spatial_routing import refine_groups
        # Two cells split by a straight cut at lon 141.30; job 99 sits just east of the cut but
        # is surrounded by the west cell's jobs, so it belongs west once hours allow.
        west=[dict(id=i,hours=1.0,lat=43.0,lon=141.28+0.002*i) for i in range(8)]
        east=[dict(id=20+i,hours=1.0,lat=43.0,lon=141.32+0.002*i) for i in range(8)]
        island=dict(id=99,hours=1.0,lat=43.0,lon=141.301)
        groups=refine_groups([west,east+[island]],lambda j:(j['lat'],j['lon']),hours_cap=12)
        self.assertIn(99,[j['id'] for j in groups[0]])
        self.assertEqual(sorted(j['id'] for g in groups for j in g),sorted([j['id'] for j in west+east]+[99]))
        # With no room in the west cell the island stays where it is.
        groups=refine_groups([west,east+[island]],lambda j:(j['lat'],j['lon']),hours_cap=8)
        self.assertIn(99,[j['id'] for j in groups[1]])


class SectorGroups(unittest.TestCase):
    def test_sectors_are_contiguous_wedges_and_keep_every_job(self):
        from src.spatial_routing import sector_groups
        import math
        depot=(43.0,141.35)
        jobs=[dict(id=i,hours=1.0,lat=43.0+0.02*math.sin(math.radians(a)),lon=141.35+0.02*math.cos(math.radians(a))/math.cos(math.radians(43.0))) for i,a in enumerate(range(0,360,10))]
        groups=sector_groups(jobs,4,depot,lambda j:(j['lat'],j['lon']))
        self.assertEqual(len(groups),4)
        self.assertEqual(sorted(j['id'] for g in groups for j in g),list(range(36)))
        self.assertEqual([len(g) for g in groups],[9,9,9,9])
        for g in groups:
            angles=sorted(math.degrees(math.atan2(j['lat']-depot[0],(j['lon']-depot[1])*math.cos(math.radians(43.0)))) for j in g)
            span=[b-a for a,b in zip(angles,angles[1:])]
            # a wedge: consecutive angles are adjacent except for one possible wrap gap
            self.assertLessEqual(sum(1 for s in span if s>15),1)
        self.assertEqual(len(sector_groups(jobs[:2],5,depot,lambda j:(j['lat'],j['lon']))),5)


class OrOpt(unittest.TestCase):
    def test_nearest_k_costs_stops_at_k_targets(self):
        from src.spatial_routing import nearest_k_costs
        g=nx.DiGraph();g.add_weighted_edges_from([(1,2,1),(2,3,1),(3,4,1),(4,5,1),(1,9,50)])
        self.assertEqual(nearest_k_costs(g,1,{3,5,9},2),{3:2,5:4})
        self.assertEqual(nearest_k_costs(g,1,{9},5,cap=10),{})

    def test_improve_order_reduces_connection_cost_without_losing_jobs(self):
        from src.spatial_routing import improve_order
        # jobs on a line; the initial order jumps back and forth
        jobs=[dict(id=i,x=i) for i in range(8)]
        order=[jobs[0],jobs[5],jobs[1],jobs[6],jobs[2],jobs[7],jobs[3],jobs[4]]
        hop=lambda a,b:abs(a['x']-b['x'])
        start=lambda j:j['x'];end=lambda j:j['x']
        def total(seq):return start(seq[0])+sum(hop(a,b) for a,b in zip(seq,seq[1:]))+end(seq[-1])
        better=improve_order(order,hop,start,end)
        self.assertEqual(sorted(j['id'] for j in better),list(range(8)))
        self.assertLess(total(better),total(order))
        self.assertEqual(total(better),total(jobs))  # reaches the optimal cost (ties in order allowed)
        # unknown hops are never used
        sparse=lambda a,b:abs(a['x']-b['x']) if abs(a['x']-b['x'])<=2 else None
        again=improve_order(order,sparse,start,end)
        self.assertEqual(sorted(j['id'] for j in again),list(range(8)))


class BisectGroups(unittest.TestCase):
    def test_bisection_balances_hours_and_keeps_every_job(self):
        from src.spatial_routing import bisect_groups
        jobs=[dict(id=i,hours=1.0,lat=43.0+0.01*(i//10),lon=141.3+0.01*(i%10)) for i in range(100)]
        groups=bisect_groups(jobs,5,lambda j:(j['lat'],j['lon']))
        self.assertEqual(len(groups),5)
        self.assertEqual(sorted(j['id'] for g in groups for j in g),list(range(100)))
        self.assertTrue(all(18<=len(g)<=22 for g in groups))
        # cells are compact: each group's bounding box is well below the full extent
        for g in groups:
            lat=[j['lat'] for j in g];lon=[j['lon'] for j in g]
            self.assertLess((max(lat)-min(lat))*(max(lon)-min(lon)),0.09*0.09*0.5)
        self.assertEqual(len(bisect_groups(jobs[:1],4,lambda j:(j['lat'],j['lon']))),4)
