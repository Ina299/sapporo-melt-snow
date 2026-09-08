/* Daily mass balance for one catchment. Also used by Node tests and exports. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SnowModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const defaults={road_km:10,width_m:6,fresh_density:100,packed_density:400,
    roadside_m3:500,temporary_m3:500,local_move_t_day:40,trigger:.8,target:.5,
    trucks:2,truck_hours:8,payload_t:8,body_m3:20,speed_kph:20,
    load_min:20,unload_min:8,wait_min:20,
    dump_distance_km:8,dump_daily_t:160,dump_storage_m3:2500,
    dc_distance_km:3,dc_it_mw:.5,utilization:.9,recovery:.8,
    snow_c:-5,outlet_c:2,melt_intake_t_day:160,drain_m3_day:160,melt_buffer_m3:200,
    thaw_pct_day:0,policy:'shortest'};
  function check(input){
    const c={...defaults,...input};
    for(const [k,v] of Object.entries(c)){
      if(k==='policy')continue;
      if(typeof v!=='number'||!Number.isFinite(v))throw Error(`${k}: 数値を入力してください`);
      if(k!=='snow_c'&&v<0)throw Error(`${k}: 0以上にしてください`);
    }
    for(const k of ['fresh_density','packed_density','speed_kph','payload_t','body_m3'])
      if(c[k]<=0)throw Error(`${k}: 0より大きい値が必要です`);
    if(!Number.isInteger(c.trucks)||c.trucks>1000)throw Error('ダンプ台数は0〜1000の整数です');
    if(c.truck_hours>24||c.snow_c>0||c.fresh_density>917||c.packed_density>917||
      c.utilization>1||c.recovery>1||c.trigger>1||c.target>=c.trigger||c.thaw_pct_day>100)
      throw Error('密度・時間・割合・温度の範囲を確認してください');
    if(c.load_min+c.unload_min<=0)throw Error('積込・投雪時間の合計は0より大きい値が必要です');
    if(!['shortest','melt_first'].includes(c.policy))throw Error('不明な搬出方針です');
    return c;
  }
  function simulate(weather,input={},mode='mixed'){
    const c=check(input);
    if(!['mixed','dump_only','melt_only'].includes(mode))throw Error('不明な処理方式です');
    let previous='';
    for(const w of weather){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(w.date)||w.date<=previous||
        (previous&&Date.parse(w.date)-Date.parse(previous)!==86400000))throw Error('日付は連続した昇順で指定してください');
      if(typeof w.cm!=='number'||!Number.isFinite(w.cm)||w.cm<0)throw Error(`${w.date}: 欠測の降雪を0として計算できません`);
      previous=w.date;
    }
    const roadCap=c.roadside_m3*c.packed_density/1000;
    const tempCap=c.temporary_m3*c.packed_density/1000;
    const dumpCap=c.dump_storage_m3*c.packed_density/1000;
    const bufferCap=c.melt_buffer_m3*c.packed_density/1000;
    const payload=Math.min(c.payload_t,c.body_m3*c.packed_density/1000);
    const thermal=c.dc_it_mw*c.utilization*c.recovery*86400/(333.5+2.1*Math.abs(c.snow_c)+4.186*c.outlet_c);
    const meltCap=mode==='dump_only'?0:Math.min(thermal,c.drain_m3_day);
    const cycle=kind=>2*c[`${kind}_distance_km`]/c.speed_kph+(c.load_min+c.unload_min+c.wait_min)/60;
    let road=0,temp=0,dump=0,buffer=0,demand=0,natural=0,melted=0,transported=0,km=0,truckHours=0,trips=0;
    let dumpReceived=0,meltReceived=0,excessDays=0,peakExcess=0,peakDump=0,peakRoad=0,maxBalanceError=0;
    const daily=[];
    for(const w of weather){
      // Melt/thaw old stock first; never discard snow merely because a capacity is full.
      const thaw=(road+temp+dump)*c.thaw_pct_day/100;
      const keep=1-c.thaw_pct_day/100;road*=keep;temp*=keep;dump*=keep;natural+=thaw;
      const oldMelt=Math.min(buffer,meltCap);buffer-=oldMelt;melted+=oldMelt;
      let meltRemaining=meltCap-oldMelt;
      const fresh=c.road_km*1000*c.width_m*w.cm/100*c.fresh_density/1000;
      road+=fresh;demand+=fresh;
      const beforeMoveExcess=Math.max(0,road-roadCap);
      let roadNeed=road>roadCap*c.trigger?Math.max(0,road-roadCap*c.target):0;
      // Temporary stock is an adjacent, permitted staging area, moved with a local loader.
      const staged=Math.min(roadNeed,Math.max(0,tempCap-temp),c.local_move_t_day);
      road-=staged;temp+=staged;roadNeed-=staged;
      const remainingHours=Array(c.trucks).fill(c.truck_hours);
      let toDump=0,toMelt=0,dayTrips=0,dayKm=0,dayHours=0;
      const take=amount=>{
        // Road evacuation first, then clear temporary stock for the next snowfall.
        const fromRoad=Math.min(roadNeed,amount);road-=fromRoad;roadNeed-=fromRoad;
        temp-=amount-fromRoad;
      };
      while(roadNeed+temp>1e-8){
        const choices=[];
        if(mode!=='melt_only')choices.push({kind:'dump',available:Math.min(c.dump_daily_t-toDump,dumpCap-dump),hours:cycle('dump')});
        if(mode!=='dump_only'&&meltCap>0)choices.push({kind:'dc',available:Math.min(c.melt_intake_t_day-toMelt,meltRemaining+bufferCap-buffer),hours:cycle('dc')});
        choices.sort((a,b)=>c.policy==='melt_first'&&a.kind!==b.kind?(a.kind==='dc'?-1:1):a.hours-b.hours);
        let selected;
        for(const dest of choices){
          const truck=remainingHours.findIndex(h=>h+1e-9>=dest.hours);
          if(dest.available>1e-8&&truck>=0){selected={...dest,truck};break;}
        }
        if(!selected)break;
        const amount=Math.min(payload,roadNeed+temp,selected.available);
        take(amount);remainingHours[selected.truck]-=selected.hours;
        if(selected.kind==='dump'){dump+=amount;toDump+=amount;}
        else{toMelt+=amount;const direct=Math.min(amount,meltRemaining);meltRemaining-=direct;melted+=direct;buffer+=amount-direct;}
        dayTrips++;dayKm+=2*c[`${selected.kind}_distance_km`];dayHours+=selected.hours;
      }
      transported+=toDump+toMelt;dumpReceived+=toDump;meltReceived+=toMelt;
      trips+=dayTrips;km+=dayKm;truckHours+=dayHours;
      const excess=Math.max(0,road-roadCap);
      if(excess>1e-7)excessDays++;
      peakExcess=Math.max(peakExcess,excess);peakDump=Math.max(peakDump,dump);peakRoad=Math.max(peakRoad,road);
      const balanceError=demand-(road+temp+dump+buffer+natural+melted);
      maxBalanceError=Math.max(maxBalanceError,Math.abs(balanceError));
      daily.push({date:w.date,snowfall_cm:w.cm,generated_t:fresh,road_t:road,temporary_t:temp,
        dump_t:dump,melt_buffer_t:buffer,melted_t:oldMelt+(meltCap-oldMelt-meltRemaining),natural_t:thaw,
        staged_t:staged,to_dump_t:toDump,to_melt_t:toMelt,trips:dayTrips,truck_km:dayKm,truck_hours:dayHours,
        excess_t:excess,before_move_excess_t:beforeMoveExcess,balance_error_t:balanceError});
    }
    return {mode,config:c,capacity:{road_t:roadCap,temporary_t:tempCap,dump_t:dumpCap,melt_buffer_t:bufferCap,
      thermal_t_day:thermal,melt_t_day:meltCap,payload_t:payload},
      summary:{generated_t:demand,road_t:road,temporary_t:temp,dump_t:dump,melt_buffer_t:buffer,natural_t:natural,
        melted_t:melted,transported_t:transported,to_dump_t:dumpReceived,to_melt_t:meltReceived,trips,truck_km:km,
        truck_hours:truckHours,excess_days:excessDays,peak_excess_t:peakExcess,peak_dump_t:peakDump,peak_road_t:peakRoad,
        max_balance_error_t:maxBalanceError},daily};
  }
  return {defaults,simulate};
});
