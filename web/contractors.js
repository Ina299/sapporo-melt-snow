'use strict';
let CR=window.JOINT_ROUTES;
if(CR){
  const layer=L.featureGroup().addTo(map);
  let mode='all';
  const selectedCounts={};
  const vehicleColors=['#245caf','#7651b3','#17856c','#9a7925','#4651a0','#167e91','#9757a3','#668724','#54439b','#387aab','#357653','#8b8733','#8c5792'];
  const color=i=>vehicleColors[(i-1)%vehicleColors.length];
  const company=()=>CR.companies.find(c=>c.id===$('route-company').value);
  $('route-company').innerHTML=CR.companies.map(c=>`<option value="${c.id}">${esc(companyLabel(c))}</option>`).join('');
  function selectCompany(id,fit=false){
    $('route-company').value=id;
    const c=company();
    $('company-vehicles').innerHTML=c.scenarios.map(s=>`<option value="${s.vehicles}">${s.vehicles}台</option>`).join('');
    $('company-vehicles').value=String(CR.mode==='joint'?c.fleet_limit:(selectedCounts[id]??c.fleet_limit));
    $('company-vehicles').disabled=CR.mode==='joint';
    updateFocus();draw(fit);
  }
  function updateFocus(){
    const n=+$('company-vehicles').value;
    $('company-vehicle-focus').innerHTML='<option value="0">全車両</option>'+Array.from({length:n},(_,i)=>`<option value="${i+1}">車両 ${i+1}</option>`).join('');
  }
  function draw(fit=false){
    const c=company(),s=c.scenarios.find(s=>s.vehicles===+$('company-vehicles').value),focus=+$('company-vehicle-focus').value;
    mode='company';setViewButtons(true);
    Object.entries(contractorMarkers).forEach(([id,m])=>m.getElement()?.classList.toggle('is-selected',id===c.id));
    const trips=new Map(c.trips.map(t=>[t.id,t]));
    const features=s.routes.filter(r=>!focus||r.vehicle_id===focus).flatMap(r=>{
      const parts=CR.route_format==='direct_jobs'?[...(r.head_features??[]),...r.trip_ids.flatMap((id,k)=>[...(k?trips.get(id).incoming_features:[]),...trips.get(id).features]),...(r.tail_features??[])]:r.trip_ids.flatMap(id=>trips.get(id).features);
      return parts.map(f=>({...f,properties:{...f.properties,vehicle:r.vehicle_id}}));
    });
    routeLayer.clearLayers();layer.clearLayers();
    cityRoadLayer?.setStyle(f=>({opacity:f.properties.included ? .16 : .55}));
    const geo=L.geoJSON({type:'FeatureCollection',features},
      {style:f=>({color:color(f.properties.vehicle),weight:f.properties.service?4:3,dashArray:f.properties.service?null:'8 7',opacity:.85}),
       onEachFeature:(f,l)=>l.bindPopup(`${esc(companyLabel(c))}<br>車両 ${f.properties.vehicle} / ${f.properties.service?'除雪作業':'往復・区間間の回送'}`)}).addTo(layer);
    const started=new Set();
    for(const f of features){
      const v=f.properties.vehicle;
      if(!f.properties.service||started.has(v)||(focus&&v!==focus))continue;
      started.add(v);const [lon,lat]=f.geometry.coordinates[0];
      L.marker([lat,lon],{icon:L.divIcon({className:'vehicle-start',html:`<span style="background:${color(v)}">${v}</span>`,iconSize:[22,22]})}).addTo(layer).bindPopup(`車両 ${v} の作業開始点`);
    }
    const source=D.contractors.find(x=>x.id===c.id);
    L.polyline([[source.latitude,source.longitude],[c.depot.lat,c.depot.lon]],{color:'#687278',dashArray:'2 5',weight:2}).addTo(layer).bindPopup(`道路への未確認接続 ${num(c.snap_distance_m)}m。走行距離・時間に未算入。`);
    $('company-route-note').textContent=`${c.name} / 広域担当${num(s.validation.covered)}方向区間。試算設定の最大${c.fleet_limit}台：${c.fleet_basis}。実際の上限・稼働・拠点配備は未確認。所在地と道路接続点の差：約${num(c.snap_distance_m)}m。台数変更は固定担当区間内の再配分です。`;
    $('company-route-stats').innerHTML=stat('担当分の完了まで',num(Math.max(...s.routes.map(r=>r.hours)),2),'時間',`${s.vehicles}台同時出発・休憩未算入`)+stat('全車両の総走行',num(s.routes.reduce((t,r)=>t+r.distance_km,0),1),'km','作業＋往復等の回送')+stat('広域の担当区間',num(s.validation.covered),'方向区間','他社と作業区間の重複なし');
    $('company-route-table').innerHTML=s.routes.map(r=>`<tr><td><i class="legend-line" style="background:${color(r.vehicle_id)}"></i>${r.vehicle_id}</td><td>${num(r.service_km,2)} km</td><td>${num(r.deadhead_km,2)} km</td><td>${num(r.hours,2)} h</td><td class="${r.hours<=6?'ok':'bad'}">${r.hours<=6?'範囲内':'超過'}</td></tr>`).join('');
    $('company-map-legend').innerHTML=`<b>${esc(companyLabel(c))} / ${s.vehicles}台${focus?` / 車両${focus}を表示`:''}</b><span>実線：作業　破線：回送　番号：作業開始点　灰色点線：未確認接続</span><a href="#company-routing">事業者・台数・表示車両を変更 ↓</a><div>${s.routes.filter(r=>!focus||r.vehicle_id===focus).map(r=>`<span class="vehicle-chip"><i style="background:${color(r.vehicle_id)}"></i>車両 ${r.vehicle_id}</span>`).join('')}</div>`;
    if(fit){map.fitBounds(layer.getBounds(),{padding:[45,45],maxZoom:15});$('map').scrollIntoView({behavior:'smooth',block:'center'});}
  }
  function allCompanies(fit=true){
    mode='all';setViewButtons(false);layer.clearLayers();routeLayer.clearLayers();
    Object.values(contractorMarkers).forEach(m=>m.getElement()?.classList.remove('is-selected'));
    cityRoadLayer?.setStyle({opacity:.12});
    CR.companies.forEach((c,i)=>L.geoJSON({type:'FeatureCollection',features:c.trips.flatMap(t=>t.features.filter(f=>f.properties.service))},{style:()=>({color:companyColor(c.id),weight:2,opacity:.75}),onEachFeature:(f,l)=>l.bindPopup(`${esc(companyLabel(c))}の広域担当区間<br>事業者マーカーから車両別経路を表示`)}).addTo(layer));
    $('company-map-legend').innerHTML='<b>仮定配備による割当（会社ごとの色）</b><span>実線：試算で割り当てた区間　赤：往復到達できず未割当　角丸の業1〜業4：公開住所の代表点（割当色と同じ）</span><div>'+CR.companies.map((c,i)=>`<span class="vehicle-chip"><i style="background:${companyColor(c.id)}"></i>${esc(companyLabel(c))}</span>`).join('')+'</div>';
    if(fit&&layer.getLayers().length)map.fitBounds(layer.getBounds(),{padding:[35,35]});
  }
  const missing=L.geoJSON(CR.unassigned_geometry,{style:()=>({color:'#d13932',weight:3,opacity:.8}),onEachFeature:(f,l)=>l.bindPopup(`未割当：${esc(f.properties.reason)}`)}).addTo(map);
  function updateSummary(){
  const a=CR.summary;
  $('dispatch-audit').textContent=`広域${num(a.required_arcs)}方向区間のうち${num(a.assigned_arcs)}区間を4社・仮定${a.fleet}台へ割当。作業重複${a.duplicate_service_arcs}。未割当${num(a.unassigned_arcs)}区間は赤で表示。この仮定台数で全社完了まで約${num(a.baseline_makespan_hours,1)}時間（休憩なしの理論時間）となり、6時間内の配車としては成立しません。`;
  $('top-stats').lastElementChild.outerHTML=stat('広域の仮定割当',num(a.assigned_arcs),'方向区間',`${num(a.unassigned_arcs)}区間は未割当`);
  $('city-stats').innerHTML=stat('対象の方向区間',num(a.required_arcs),'区間','市域と周辺のOSM車道')+stat('事業者・車両へ配車',num(a.assigned_arcs),'区間','4社が重複なく担当')+stat('仮定の試算台数',a.fleet,'台','公表主要機種による仮定')+stat('往復できず未割当',num(a.unassigned_arcs),'区間','架空の接続は追加しません');
  $('city-audit').textContent=CR.scope+' '+CR.method+' '+CR.transit_note;
  $('dispatch-mode-note').textContent=CR.mode==='joint'?'各社の仮定台数を考慮して区域境界を調整し、近い作業へ直行する近似配車。仮定30台で比較します。':'比較用の基準線。会社所在地への道路上の近さだけで区域を作成し、台数を考慮しないため、台数の少ないKRS・サツイチに区間が集中します。会社内の台数を変更できます。';
  const old=a.previous;
  if(old){
    let note=$('route-improvement');if(!note){note=document.createElement('p');note.id='route-improvement';$('dispatch-mode-note').after(note);}
    const oldDeadhead=(old.total_hours-a.total_service_km/8)*20;
    note.textContent=`旧モデルとの比較（同じ作業対象）：回送 ${num(oldDeadhead)} → ${num(a.total_deadhead_km)} km、総車両時間 ${num(old.total_hours,1)} → ${num(a.total_hours,1)} h。実際の運用実績との比較ではありません。`;
  }
  $('dispatch-comparison').innerHTML=[['所在地に近い区域',window.CONTRACTOR_ROUTES],['全社台数で区域調整',window.JOINT_ROUTES]].map(([label,d])=>`<tr><td>${label}</td><td>${d?.summary.fleet??'—'}</td><td>${d?num(d.summary.baseline_makespan_hours,2)+' h':'選択時に読込'}</td><td>${d?num(d.summary.total_hours,1)+' h':'—'}</td></tr>`).join('');
  }
  updateSummary();
  $('dispatch-mode').onchange=async()=>{
    const el=$('dispatch-mode');el.disabled=true;
    try{
      if(el.value==='fixed'&&!window.CONTRACTOR_ROUTES){
        $('dispatch-mode-note').textContent='会社担当固定の配車データを読み込んでいます…';
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='dispatch-data.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('配車データを読み込めませんでした'));};document.body.appendChild(script);});
      }
      CR=el.value==='joint'?window.JOINT_ROUTES:window.CONTRACTOR_ROUTES;
      missing.clearLayers();missing.addData(CR.unassigned_geometry);
      selectCompany($('route-company').value);$('company-vehicles').disabled=el.value==='joint';updateSummary();allCompanies();
    }catch(error){el.value=CR===window.JOINT_ROUTES?'joint':'fixed';$('dispatch-mode-note').textContent=error.message;}
    finally{el.disabled=false;}
  };
  $('route-company').onchange=()=>selectCompany($('route-company').value,true);
  $('company-vehicles').onchange=()=>{selectedCounts[company().id]=+$('company-vehicles').value;updateFocus();draw(true);};
  $('company-vehicle-focus').onchange=()=>draw(true);
  $('company-route-view').onclick=()=>draw(true);
  for(const c of CR.companies){
    const marker=contractorMarkers[c.id];
    marker.on('mouseover',()=>{if(mode==='all'||company().id!==c.id||!layer.getLayers().length)selectCompany(c.id);});
    marker.on('click',()=>selectCompany(c.id,true));
    marker.getElement()?.addEventListener('focus',()=>selectCompany(c.id));
  }
  selectCompany(CR.companies[0].id);allCompanies();
  $('company-view').onclick=()=>draw(true);
  $('city-view').onclick=()=>allCompanies();
  map.on('click',()=>{if(mode!=='all')allCompanies(false);});
  [...Object.values(siteMarkers),...Object.values(dcMarkers)].forEach(marker=>marker.on('click',()=>{if(mode!=='all')allCompanies(false);}));
  document.querySelectorAll('[data-site],[data-dc-site]').forEach(button=>button.addEventListener('click',()=>allCompanies(false)));
}
