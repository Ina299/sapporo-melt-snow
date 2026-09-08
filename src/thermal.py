"""Steady-state heat bound; not a heat-exchanger/process design."""
import math

def melt_capacity(it_mw=1,utilization=1,recovery=0.8,snow_c=-5,density=400,hours=24,outlet_c=0):
    vals=[it_mw,utilization,recovery,snow_c,density,hours,outlet_c]
    if not all(math.isfinite(v) for v in vals): raise ValueError('Finite values required')
    if it_mw<0 or not 0<=utilization<=1 or not 0<=recovery<=1 or snow_c>0 or density<=0 or not 0<=hours<=24 or outlet_c<0:
        raise ValueError('Invalid thermal parameters')
    # Latent heat + warming ice to 0 C + warming resulting water.
    kj_kg=333.5+2.1*abs(snow_c)+4.186*outlet_c
    useful_mw=it_mw*utilization*recovery
    tonnes=useful_mw*hours*3600/kj_kg
    return dict(useful_heat_mw=useful_mw,kwh_per_tonne=kj_kg/3.6,
                tonnes_day=tonnes,snow_m3_day=tonnes*1000/density,water_m3_day=tonnes,
                assumptions=dict(it_mw=it_mw,utilization=utilization,recovery=recovery,snow_c=snow_c,density=density,hours=hours,outlet_c=outlet_c))
