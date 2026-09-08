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
