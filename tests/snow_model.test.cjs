const {test}=require('node:test');
const assert=require('node:assert/strict');
const {simulate}=require('../web/snow-model.js');
const weather=(values)=>values.map((cm,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,cm}));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const demand100={road_km:1,width_m:10,fresh_density:100}; // 10 cm -> 100 tonnes

test('snow stays on road if there is storage; no compulsory melting or transport',()=>{
  const r=simulate(weather([10,10]),{...demand100,roadside_m3:10000});
  close(r.summary.generated_t,200);close(r.summary.road_t,200);assert.equal(r.summary.trips,0);
});
test('unavailable trucks retain excess and mass across days',()=>{
  const r=simulate(weather([10,10,0]),{...demand100,roadside_m3:0,temporary_m3:0,trucks:0});
  close(r.summary.road_t,200);assert.equal(r.summary.excess_days,3);close(r.summary.max_balance_error_t,0);
});
test('temporary storage obeys both local loader throughput and storage cap',()=>{
  const r=simulate(weather([10,0]),{...demand100,roadside_m3:0,temporary_m3:100,local_move_t_day:30,trucks:0});
  close(r.daily[0].temporary_t,30);close(r.daily[1].temporary_t,40);close(r.summary.road_t,60);
});
test('payload is limited by volume and each truck must finish its full cycle',()=>{
  const r=simulate(weather([10]),{...demand100,roadside_m3:0,temporary_m3:0,
    trucks:2,truck_hours:1,body_m3:2,packed_density:400,
    dump_distance_km:5,speed_kph:20,load_min:15,unload_min:15,wait_min:0},'dump_only');
  assert.equal(r.summary.trips,2);close(r.summary.to_dump_t,1.6);close(r.summary.truck_km,20);close(r.summary.truck_hours,2);
});
test('dump has finite seasonal space and daily intake; unreceived snow is not lost',()=>{
  const r=simulate(weather([10,0,0]),{...demand100,roadside_m3:0,temporary_m3:0,
    dump_storage_m3:25,dump_daily_t:6},'dump_only');
  close(r.daily[0].to_dump_t,6);close(r.daily[1].to_dump_t,4);close(r.daily[2].to_dump_t,0);
  close(r.summary.dump_t,10);close(r.summary.road_t,90);
});
test('melt buffer carries over and is bounded separately from melted snow',()=>{
  const r=simulate(weather([10,0]),{...demand100,roadside_m3:0,temporary_m3:0,
    dc_it_mw:20,drain_m3_day:10,melt_buffer_m3:25,melt_intake_t_day:100},'melt_only');
  close(r.daily[0].to_melt_t,20);close(r.daily[0].melted_t,10);close(r.daily[0].melt_buffer_t,10);
  close(r.daily[1].melted_t,10);close(r.summary.melted_t,20);close(r.summary.max_balance_error_t,0);
});
test('thermal capacity includes snow warming and outlet temperature',()=>{
  const r=simulate(weather([10]),{...demand100,dc_it_mw:1,drain_m3_day:10000});
  close(r.capacity.thermal_t_day,.9*.8*86400/(333.5+10.5+8.372));
});
test('DC zero or no drainage cannot receive unlimited snow into a fictional sink',()=>{
  for(const c of [{dc_it_mw:0},{drain_m3_day:0}]){
    const r=simulate(weather([10]),{...demand100,roadside_m3:0,temporary_m3:0,...c},'melt_only');
    close(r.summary.road_t,100);close(r.summary.to_melt_t,0);
  }
});
test('natural thaw is a tracked mass outflow and frees storage the next day',()=>{
  const r=simulate(weather([10,0]),{...demand100,roadside_m3:10000,thaw_pct_day:50,trucks:0});
  close(r.summary.road_t,50);close(r.summary.natural_t,50);close(r.summary.max_balance_error_t,0);
});
test('distance priority and melt priority produce distinct allocations',()=>{
  const c={...demand100,roadside_m3:0,temporary_m3:0,dump_distance_km:1,dc_distance_km:8,
    trucks:10,dc_it_mw:10,drain_m3_day:1000};
  const a=simulate(weather([10]),c),b=simulate(weather([10]),{...c,policy:'melt_first'});
  close(a.summary.to_dump_t,100);close(b.summary.to_melt_t,100);assert.ok(a.summary.truck_km<b.summary.truck_km);
});
test('missing values, negative snow, gaps and invalid parameters fail explicitly',()=>{
  assert.throws(()=>simulate(weather([null])));assert.throws(()=>simulate(weather([-1])));
  assert.throws(()=>simulate([{date:'2026-01-01',cm:0},{date:'2026-01-03',cm:0}]));
  for(const c of [{trucks:1.5},{truck_hours:25},{payload_t:0},{trigger:.3,target:.5},{road_km:NaN}])assert.throws(()=>simulate(weather([0]),c));
});
test('all observed station series conserve mass in all three treatment modes',()=>{
  const data=require('../data/processed/snow_management.json');
  for(const series of Object.values(data.stations))for(const mode of ['mixed','dump_only','melt_only']){
    const r=simulate(series,{},mode);assert.ok(r.summary.max_balance_error_t<1e-7);
    for(const d of r.daily){
      for(const k of ['road_t','temporary_t','dump_t','melt_buffer_t'])assert.ok(d[k]>=-1e-7);
      assert.ok(d.temporary_t<=r.capacity.temporary_t+1e-7);assert.ok(d.dump_t<=r.capacity.dump_t+1e-7);
      assert.ok(d.melt_buffer_t<=r.capacity.melt_buffer_t+1e-7);assert.ok(d.truck_hours<=16+1e-7);
    }
  }
});
