import unittest
from scripts.run_dispatch import schedule

class DispatchScheduling(unittest.TestCase):
    def test_balances_jobs_without_losing_or_repeating_work(self):
        jobs=[dict(id=i,hours=h,service_km=h,deadhead_km=1,distance_km=h+1) for i,h in enumerate([5,8,6,7])]
        routes=schedule(jobs,2)
        self.assertEqual(sorted(t for r in routes for t in r['trip_ids']),[0,1,2,3])
        self.assertEqual([r['hours'] for r in routes],[13,13])
        self.assertEqual(sum(r['distance_km'] for r in routes),30)

    def test_one_vehicle_preserves_all_work(self):
        jobs=[dict(id=4,hours=3,service_km=20,deadhead_km=5,distance_km=25),dict(id=7,hours=2,service_km=10,deadhead_km=4,distance_km=14)]
        route=schedule(jobs,1)[0]
        self.assertEqual(route['hours'],5)
        self.assertEqual(route['trip_ids'],[4,7])
        self.assertEqual(route['distance_km'],39)
