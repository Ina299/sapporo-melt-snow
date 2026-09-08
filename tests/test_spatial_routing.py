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
