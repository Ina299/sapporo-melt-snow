import unittest
import networkx as nx
from src.routing import postman, split_fleet, validate_routes, metrics, build_graph
from src.thermal import melt_capacity

def fixture():
    g=nx.MultiDiGraph()
    for i,(u,v,c) in enumerate([(0,1,1),(1,2,1),(2,0,1),(0,2,5)]):
        g.add_edge(u,v,key=str(i),length_m=c,service_s=c,cost=c*1000,task_id=str(i))
    return g

class Models(unittest.TestCase):
    def test_known_optimal_directed_postman(self):
        g=fixture();route=postman(g,0)
        # Original cost 8, imbalance requires exactly one extra 2->0 arc (cost 1).
        self.assertEqual(sum(r['cost'] for r in route),9000)
        self.assertTrue(validate_routes(g,[{'steps':route}])['valid'])

    def test_multiple_depots_and_capacity(self):
        g=fixture();r=split_fleet(g,postman(g,0),[{'id':'a','node':0,'count':1},{'id':'b','node':1,'count':1}])
        self.assertEqual(len(r),2)
        self.assertEqual({x['depot_id'] for x in r},{'a','b'})
        self.assertTrue(validate_routes(g,r)['valid'])

    def test_infeasible_shift_reported(self):
        g=fixture();r=split_fleet(g,postman(g),[{'id':'a','node':0,'count':1}],shift_hours=0.00001)
        self.assertFalse(r[0]['within_shift'])

    def test_disconnected_rejected(self):
        g=fixture();g.add_edge(8,9)
        with self.assertRaises(ValueError):postman(g)

    def test_parallel_arcs_not_lost(self):
        g=fixture();g.add_edge(0,1,key='parallel',length_m=2,service_s=2,cost=2000,task_id='parallel')
        self.assertTrue(validate_routes(g,[{'steps':postman(g)}])['valid'])

    def test_oneway_and_private_filter(self):
        p={'elements':[{'type':'node','id':i,'lat':43+i/1000,'lon':141} for i in range(3)]+[
           {'type':'way','id':10,'nodes':[0,1],'tags':{'highway':'residential','oneway':'-1'}},
           {'type':'way','id':11,'nodes':[1,2],'tags':{'highway':'residential','access':'private'}}]}
        g,_=build_graph(p,[42,140,44,142])
        self.assertEqual(list(g.edges()),[(1,0)])

    def test_thermal_units(self):
        r=melt_capacity()
        self.assertAlmostEqual(r['tonnes_day'],200.930232558,places=6)
        self.assertAlmostEqual(r['snow_m3_day'],502.325581395,places=6)
        self.assertAlmostEqual(melt_capacity(it_mw=10)['tonnes_day'],10*r['tonnes_day'])
        self.assertEqual(melt_capacity(recovery=0)['tonnes_day'],0)
        self.assertLess(melt_capacity(outlet_c=5)['tonnes_day'],r['tonnes_day'])
        with self.assertRaises(ValueError):melt_capacity(density=0)
        with self.assertRaises(ValueError):melt_capacity(it_mw=float('nan'))

if __name__=='__main__':unittest.main()
