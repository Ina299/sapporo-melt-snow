'use strict';
(()=>{
  const W=window.SNOW_DATA,M=window.SnowModel;
  const el=id=>document.getElementById(id);
  const n=(x,d=0)=>Number(x).toLocaleString('ja-JP',{maximumFractionDigits:d});
  const fields=[
    ['road_km','対象道路延長','km',.1,1000,.1],['width_m','除雪対象幅','m',.1,50,.1],
    ['roadside_m3','道路脇の堆雪上限','m³',0,1000000,10],['temporary_m3','近接一時堆雪の上限','m³',0,1000000,10],
    ['trucks','この範囲に使うダンプ','台',0,100,1],['truck_hours','1台の日稼働時間','時間',0,24,.5],
    ['dump_distance_km','雪堆積場までの片道','km',0,200,.5],['dc_distance_km','DC融雪点までの片道','km',0,200,.5],
    ['dc_it_mw','この範囲へ熱を配分するIT容量','MW',0,50,.1],
    ['dump_daily_t','雪堆積場の日受入枠','t/日',0,100000,10],['dump_storage_m3','雪堆積場の貯留枠','m³',0,10000000,100],
    ['melt_intake_t_day','DCの日搬入枠','t/日',0,100000,10],['drain_m3_day','DCの排水上限','m³/日',0,100000,10],
    ['melt_buffer_m3','DCの未融雪貯留枠','m³',0,1000000,10],
    ['fresh_density','新雪密度','kg/m³',1,917,1],['packed_density','堆雪・運搬雪密度','kg/m³',1,917,1],
    ['local_move_t_day','近接一時堆雪への移動上限','t/日',0,100000,1],
    ['payload_t','ダンプ積載重量上限','t',.1,50,.1],['body_m3','荷台容積','m³',.1,100,.1],
    ['speed_kph','運搬の平均速度','km/h',1,80,1],['load_min','1便の積込時間','分',1,240,1],
    ['unload_min','1便の投雪時間','分',1,240,1],['wait_min','1便の待機時間','分',0,480,1],
    ['thaw_pct_day','屋外在庫の日自然融解率','%',0,100,.1]
  ];
  const labels=Object.fromEntries(fields.map(f=>[f[0],`${f[1]} (${f[2]})`]));
  const inputHTML=f=>`<label>${f[1]} <small>${f[2]}</small><input id="snow-${f[0]}" data-snow-key="${f[0]}" type="number" min="${f[3]}" max="${f[4]}" step="${f[5]}" value="${M.defaults[f[0]]}"></label>`;
  el('snow-inputs').innerHTML=fields.slice(0,9).map(inputHTML).join('');
  el('snow-more-inputs').innerHTML=fields.slice(9).map(inputHTML).join('');
  Object.keys(W.stations).forEach(name=>el('snow-station').add(new Option(name,name)));
  el('snow-station').value='南区(南31条西8丁目)';
  el('snow-weather-note').textContent=W.period+'。'+W.weather_notes;
  const modes={mixed:'堆積場＋DC融雪',dump_only:'堆積場のみ（DCなし）',melt_only:'搬出先をDC融雪に限定'};
  let current,comparisons;
  function config(){
    const c={};
    for(const f of fields){const e=el('snow-'+f[0]);if(e.value===''||!e.checkValidity())throw Error(`${f[1]}の入力範囲を確認してください`);c[f[0]]=Number(e.value);}
    c.policy=el('snow-policy').value;return c;
  }
  const stat=(label,value,unit)=>`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${n(value,1)}<small>${unit}</small></div></div>`;
  function showDay(){
    if(!current)return;
    const d=current.daily[+el('snow-day').value];
    el('snow-day-label').textContent=`${d.date} ／ 観測降雪 ${n(d.snowfall_cm,1)}cm`;
    el('snow-day-stocks').innerHTML=[['道路脇',d.road_t],['近接一時堆雪',d.temporary_t],['雪堆積場',d.dump_t],['DC未融雪',d.melt_buffer_t]].map(([k,v])=>`<span>${k} <b>${n(v,1)}t</b></span>`).join('');
    el('snow-day-note').textContent=`当日発生 ${n(d.generated_t,1)}t ／ 堆積場へ ${n(d.to_dump_t,1)}t ／ DCへ ${n(d.to_melt_t,1)}t ／ 融雪 ${n(d.melted_t,1)}t ／ ${d.trips}便。日末の道路堆雪超過 ${n(d.excess_t,1)}t。`;
  }
  function render(){
    try{
      const c=config(),weather=W.stations[el('snow-station').value];
      comparisons=Object.keys(modes).map(mode=>M.simulate(weather,c,mode));
      current=comparisons.find(r=>r.mode===el('snow-mode').value);
      const s=current.summary,cap=current.capacity;
      el('snow-error').textContent='';el('snow-results').hidden=false;el('snow-export').disabled=false;
      el('snow-summary').innerHTML=stat('対象道路に発生した雪',s.generated_t,'t')+stat('ダンプで搬出した雪',s.transported_t,'t')+
        stat('日末に堆雪上限を超えた日',s.excess_days,'日')+stat('ダンプ総走行',s.truck_km,'km');
      el('snow-capacity-note').textContent=`実効積載 ${n(cap.payload_t,1)}t/便。選択方式の融雪上限 ${n(cap.melt_t_day,1)}t/日（熱上限 ${n(cap.thermal_t_day,1)}t/日と排水制約）。道路脇上限 ${n(cap.road_t,1)}t。道路脇の80％超で搬出を開始し、50％まで減らす方針です。`;
      const disposition=[['道路脇に残る',s.road_t,'#926451'],['一時堆雪に残る',s.temporary_t,'#cd874a'],['雪堆積場に残る',s.dump_t,'#6374b9'],['DCで融雪待ち',s.melt_buffer_t,'#9b6090'],['DCで融雪済み',s.melted_t,'#207f69'],['自然融解済み',s.natural_t,'#448aa1']];
      el('snow-balance').innerHTML=disposition.map(([label,value,color])=>`<div class="snow-balance-item"><span><i style="background:${color}"></i>${label}</span><b>${n(value,1)}t</b><meter min="0" max="${Math.max(1,s.generated_t)}" value="${value}" aria-label="${label}"></meter></div>`).join('');
      el('snow-balance-note').textContent=`期末の4種類の残雪＋DC融雪済み＋自然融解済み＝発生量。収支の最大誤差 ${s.max_balance_error_t.toExponential(1)}t。搬出量は移動量なので、この合計には加えません。`;
      el('snow-comparison').innerHTML=comparisons.map(r=>`<tr class="${r.mode===current.mode?'selected-row':''}"><td>${modes[r.mode]}</td><td>${r.summary.excess_days}</td><td>${n(r.summary.road_t+r.summary.temporary_t,1)}</td><td>${n(r.summary.dump_t,1)}</td><td>${n(r.summary.melted_t,1)}</td><td>${n(r.summary.truck_km)}</td><td>${n(r.summary.truck_hours,1)}</td></tr>`).join('');
      const ds=current.daily,top=Math.max(1,cap.road_t,...ds.map(d=>d.road_t));
      const x=i=>45+i*670/Math.max(1,ds.length-1),y=v=>165-v/top*140;
      const points=ds.map((d,i)=>`${x(i)},${y(d.road_t)}`).join(' ');
      el('snow-chart').innerHTML=`<svg viewBox="0 0 740 205" role="img" aria-label="日末の道路脇残雪量。破線は堆雪上限"><text x="5" y="18">${n(top)}t</text><line x1="45" y1="165" x2="715" y2="165" stroke="#b9c8c0"/><line x1="45" y1="${y(cap.road_t)}" x2="715" y2="${y(cap.road_t)}" stroke="#bd6555" stroke-dasharray="6 4"/><polyline points="${points}" fill="none" stroke="#217b68" stroke-width="2"/><text x="45" y="190">${ds[0].date}</text><text x="610" y="190">${ds.at(-1).date}</text></svg>`;
      el('snow-day').max=ds.length-1;
      el('snow-day').value=Math.min(+el('snow-day').value,ds.length-1);showDay();
    }catch(e){current=null;el('snow-error').textContent=e.message;el('snow-results').hidden=true;el('snow-export').disabled=true;}
  }
  el('snow-management').addEventListener('input',e=>{if(e.target.id==='snow-day')showDay();else render();});
  el('snow-export').onclick=()=>{
    if(!current)return;
    const data={station:el('snow-station').value,weather_period:W.period,weather_notes:W.weather_notes,
      scope:W.scope,source_url:W.source_url,input_labels:labels,assumption_status:'降雪のみ観測値。他の入力は感度計算用の仮定。実施設・実経路への割当ではない。',result:current,
      comparisons:comparisons.map(r=>({mode:r.mode,summary:r.summary}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='snow-management-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  render();
})();
