'use strict';
let CR=window.JOINT_ROUTES;
if(CR){
  const layer=L.featureGroup().addTo(map);
  const detailLayer=L.layerGroup().addTo(map);
  let mode='all';
  let tripIndex=[];            // ordered trips of the focused vehicle with cumulative hours
  let selectedTrip=null;
  let timeLimit=null;          // hours; null = show whole route
  const hiddenCompanies=new Set();
  const selectedCounts={};
  const SERVICE_KPH=8,DEADHEAD_KPH=20,SHIFT_HOURS=6;
  const vehicleColors=['#245caf','#7651b3','#17856c','#9a7925','#4651a0','#167e91','#9757a3','#668724','#54439b','#387aab','#357653','#8b8733','#8c5792'];
  const color=i=>vehicleColors[(i-1)%vehicleColors.length];
  const bands=[[2,'#1f7a4d'],[4,'#2f6fb3'],[6,'#c78a1e'],[Infinity,'#b8402f']];
  const bandColor=h=>bands.find(([limit])=>h<limit)[1];
  const company=()=>CR.companies.find(c=>c.id===$('route-company').value);
  const mapVisible=()=>{const r=$('map').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;};
  const revealMap=()=>{if(!mapVisible())$('map').scrollIntoView({behavior:'smooth',block:'center'});};
  const km=(a,b)=>{const R=6371,toRad=x=>x*Math.PI/180,la1=toRad(a[1]),la2=toRad(b[1]),dLa=la2-la1,dLo=toRad(b[0]-a[0]);const x=Math.sin(dLa/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
  const lengthKm=f=>{const c=f.geometry.coordinates;let s=0;for(let i=1;i<c.length;i++)s+=km(c[i-1],c[i]);return s;};
  const hoursOf=f=>lengthKm(f)/(f.properties.service?SERVICE_KPH:DEADHEAD_KPH);
  const bearing=(a,b)=>{const toRad=x=>x*Math.PI/180,la1=toRad(a[1]),la2=toRad(b[1]),dLo=toRad(b[0]-a[0]);const y=Math.sin(dLo)*Math.cos(la2),x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLo);return (Math.atan2(y,x)*180/Math.PI+360)%360;};
  const midpoint=f=>{const c=f.geometry.coordinates;let total=0;const seg=[];for(let i=1;i<c.length;i++){const d=km(c[i-1],c[i]);seg.push(d);total+=d;}let acc=0;for(let i=0;i<seg.length;i++){if(acc+seg[i]>=total/2){const t=seg[i]?(total/2-acc)/seg[i]:0;const a=c[i],b=c[i+1];return {lat:a[1]+(b[1]-a[1])*t,lon:a[0]+(b[0]-a[0])*t,bearing:bearing(a,b),km:total};}acc+=seg[i];}return null;};
  $('route-company').innerHTML=CR.companies.map(c=>`<option value="${c.id}">${esc(companyLabel(c))}</option>`).join('');

  function focusVehicle(v){$('company-vehicle-focus').value=String(v);selectedTrip=null;timeLimit=null;draw(false);}
  // Buttons inside Leaflet popups are created dynamically; delegate their clicks.
  document.addEventListener('click',e=>{
    const f=e.target.closest('[data-popup-focus]');if(f){focusVehicle(+f.dataset.popupFocus);map.closePopup();return;}
    const c=e.target.closest('[data-popup-company]');if(c){selectCompany(c.dataset.popupCompany,false);map.closePopup();}
  });
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
    selectedTrip=null;timeLimit=null;
  }
  // Ordered feature list of one vehicle: depot → trips (incoming + body) → depot.
  function vehicleFeatures(c,r){
    const trips=new Map(c.trips.map(t=>[t.id,t]));
    const out=[];let clock=0;const seq=[];
    const push=(f,tripSeq)=>{const h=hoursOf(f);out.push({...f,properties:{...f.properties,vehicle:r.vehicle_id,seq:tripSeq,start_h:clock,end_h:clock+h}});clock+=h;};
    if(CR.route_format!=='direct_jobs'){r.trip_ids.forEach((id,k)=>trips.get(id).features.forEach(f=>push(f,k+1)));return {features:out,seq:[],hours:clock};}
    (r.head_features??[]).forEach(f=>push(f,0));
    r.trip_ids.forEach((id,k)=>{
      const t=trips.get(id);
      const incoming=k?(r.incoming_features?.[k]??t.incoming_features):[];
      const before=clock;incoming.forEach(f=>push(f,k+1));
      const start=clock;const first=t.features.find(f=>f.properties.service)??t.features[0];
      t.features.forEach(f=>push(f,k+1));
      seq.push({seq:k+1,trip:t,start_h:start,end_h:clock,incoming_km:incoming.reduce((a,f)=>a+lengthKm(f),0),incoming_h:start-before,lat:first.geometry.coordinates[0][1],lon:first.geometry.coordinates[0][0]});
    });
    (r.tail_features??[]).forEach(f=>push(f,r.trip_ids.length+1));
    return {features:out,seq,hours:clock};
  }
  function vehicleStart(c,r){
    const trips=new Map(c.trips.map(t=>[t.id,t]));
    for(const id of r.trip_ids){const t=trips.get(id);const f=t.features.find(x=>x.properties.service)??t.features[0];if(f){const [lon,lat]=f.geometry.coordinates[0];return [lat,lon];}}
    return null;
  }
  function styleFor(f,focus){
    const p=f.properties;
    const faded=timeLimit!=null&&p.start_h>timeLimit;
    const base=focus?bandColor(p.end_h):color(p.vehicle);
    const selected=selectedTrip!=null&&p.seq===selectedTrip;
    return {color:base,weight:selected?7:(p.service?4:3),dashArray:p.service?null:'8 7',opacity:faded?.12:(selectedTrip!=null&&!selected?.35:.85)};
  }
  function draw(fit=false){
    const c=company(),s=c.scenarios.find(s=>s.vehicles===+$('company-vehicles').value),focus=+$('company-vehicle-focus').value;
    mode='company';setViewButtons(true);
    Object.entries(contractorMarkers).forEach(([id,m])=>m.getElement()?.classList.toggle('is-selected',id===c.id));
    routeLayer.clearLayers();layer.clearLayers();detailLayer.clearLayers();
    cityRoadLayer?.setStyle(f=>({opacity:f.properties.included ? .16 : .55}));
    const routes=s.routes.filter(r=>!focus||r.vehicle_id===focus);
    const built=routes.map(r=>vehicleFeatures(c,r));
    const features=built.flatMap(b=>b.features);
    tripIndex=focus?built[0]?.seq??[]:[];
    L.geoJSON({type:'FeatureCollection',features},
      {style:f=>styleFor(f,focus),
       onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`${esc(companyLabel(c))}<br>車両 ${p.vehicle} / ${p.service?'除雪作業':'往復・区間間の回送'}${p.seq?`<br>作業 ${p.seq} 番目 / 出発から ${num(p.start_h,1)}〜${num(p.end_h,1)} 時間`:''}${focus?'':`<br><button class="text-button" data-popup-focus="${p.vehicle}">この車両の作業順序・方向を見る →</button>`}`,{autoPan:false});
         if(focus&&p.seq)l.on('click',()=>selectTrip(p.seq,false));}}).addTo(layer);
    // Start markers: one per vehicle (all vehicles) or one per job (focused vehicle).
    // Start markers for every vehicle (車N). In the focused view the other vehicles stay as faded,
    // clickable markers so the user can jump between vehicles without leaving the view.
    // Vehicles that start at (almost) the same point are fanned out in a small ring so every tag stays clickable.
    const starts=s.routes.map(r=>({r,start:vehicleStart(c,r)})).filter(x=>x.start);
    // Cluster in screen space at the current zoom (tags closer than ~28px would overlap).
    const groups=[];
    starts.forEach(x=>{const pt=map.latLngToContainerPoint(x.start);const g=groups.find(g=>g.pt.distanceTo(pt)<28);if(g)g.items.push(x);else groups.push({pt,items:[x]});});
    for(const group of groups.map(g=>g.items)){
      group.forEach((x,i)=>{
        const {r,start}=x;const v=r.vehicle_id,other=focus&&v!==focus;
        const n=group.length,ang=n>1?(2*Math.PI*i)/n:0,rad=n>1?20:0;
        L.marker(start,{icon:L.divIcon({className:'vehicle-start'+(other?' is-other':''),html:`<span style="background:${color(v)}">車${v}</span>`,iconSize:[30,20],iconAnchor:[15-Math.round(rad*Math.cos(ang)),10-Math.round(rad*Math.sin(ang))]}),title:`車両 ${v} の作業開始点。クリックで作業順序・方向を表示`,zIndexOffset:other?1800:2000})
        .addTo(layer).bindTooltip(`車両 ${v}：クリックで${other?'この車両に切替':'順序・方向・経過時間を表示'}`,{direction:'top',offset:[0,-12]}).on('click',()=>focusVehicle(v));
      });
    }
    if(focus)drawDetail(c,built[0]);
    const source=D.contractors.find(x=>x.id===c.id);
    L.polyline([[source.latitude,source.longitude],[c.depot.lat,c.depot.lon]],{color:'#687278',dashArray:'2 5',weight:2}).addTo(layer).bindPopup(`道路への未確認接続 ${num(c.snap_distance_m)}m。走行距離・時間に未算入。`,{autoPan:false});
    $('company-route-note').textContent=`${c.name} / 広域担当${num(s.validation.covered)}方向区間。試算設定の最大${c.fleet_limit}台：${c.fleet_basis}。実際の上限・稼働・拠点配備は未確認。所在地と道路接続点の差：約${num(c.snap_distance_m)}m。${CR.mode==='joint'?'全社方式では台数は固定です。':'台数変更は固定担当区間内の再配分です。'}`;
    $('company-route-stats').innerHTML=stat('担当分の完了まで',num(Math.max(...s.routes.map(r=>r.hours)),2),'時間',`${s.vehicles}台同時出発・休憩未算入`)+stat('全車両の総走行',num(s.routes.reduce((t,r)=>t+r.distance_km,0),1),'km','作業＋往復等の回送')+stat('広域の担当区間',num(s.validation.covered),'方向区間','他社と作業区間の重複なし');
    $('company-route-table').innerHTML=s.routes.map(r=>`<tr class="${focus===r.vehicle_id?'selected-row':''}" data-vehicle="${r.vehicle_id}"><td><i class="legend-line" style="background:${color(r.vehicle_id)}"></i>${r.vehicle_id}</td><td>${num(r.service_km,2)} km</td><td>${num(r.deadhead_km,2)} km</td><td>${num(r.hours,2)} h</td><td class="${r.hours<=SHIFT_HOURS?'ok':'bad'}">${r.hours<=SHIFT_HOURS?'範囲内':'超過'}</td><td><button class="text-button" data-focus-vehicle="${r.vehicle_id}">順序を見る</button></td></tr>`).join('');
    document.querySelectorAll('[data-focus-vehicle]').forEach(b=>b.onclick=()=>{$('company-vehicle-focus').value=b.dataset.focusVehicle;selectedTrip=null;timeLimit=null;draw(false);});
    renderTripPanel(c,focus,built[0]);
    const chips=s.routes.map(r=>`<button class="vehicle-chip${focus===r.vehicle_id?' is-selected':''}" data-vehicle-chip="${r.vehicle_id}" title="車両 ${r.vehicle_id} の順序・方向を表示"><i style="background:${color(r.vehicle_id)}"></i>車${r.vehicle_id}</button>`).join('');
    const prev=focus?((focus-2+s.routes.length)%s.routes.length)+1:0,next=focus?(focus%s.routes.length)+1:0;
    const nav=focus?`<button id="prev-vehicle" class="text-button">← 車${prev}</button><button id="next-vehicle" class="text-button">車${next} →</button>`:'';
    const bandLegend=focus?`<div class="time-bands">${bands.map(([limit,col],i)=>`<span><i style="background:${col}"></i>${i?`${bands[i-1][0]}〜`:'0〜'}${limit===Infinity?'':limit}時間${limit===Infinity?'超':''}</span>`).join('')}</div>`:'';
    $('company-map-legend').innerHTML=`<b>${esc(companyLabel(c))} / ${s.vehicles}台${focus?` / 車両${focus}を表示`:''}</b><span>${focus?'色：出発からの経過時間　丸数字：作業の順序　矢印：進行方向　破線：回送　薄い車N：他車両の開始点（クリックで切替）':'実線：作業　破線：回送　車N：作業開始点（クリックでその車両の順序・方向・経過時間）'}　灰色点線：未確認接続</span>${bandLegend}<div>${chips}</div><div class="legend-actions">${focus?'<button id="all-vehicles-view" class="primary-button">◀ 全車両に戻る</button>':''}<button id="all-companies-view" class="${focus?'text-button':'primary-button'}">◀ 全社表示に戻る</button>${nav}<button id="fit-company" class="text-button">この表示範囲に合わせる</button><a href="#company-routing">事業者・台数・表示車両を変更 ↓</a></div>`;
    $('fit-company').onclick=()=>{if(layer.getLayers().length)map.fitBounds(layer.getBounds(),{padding:[45,45],maxZoom:15});};
    $('all-companies-view').onclick=()=>allCompanies(false);
    const back=$('all-vehicles-view');if(back)back.onclick=()=>focusVehicle(0);
    document.querySelectorAll('#company-map-legend [data-vehicle-chip]').forEach(b=>b.onclick=()=>focusVehicle(+b.dataset.vehicleChip===focus?0:+b.dataset.vehicleChip));
    if(focus){$('prev-vehicle').onclick=()=>focusVehicle(prev);$('next-vehicle').onclick=()=>focusVehicle(next);}
    updateBackControl();
    if(fit&&layer.getLayers().length){map.fitBounds(layer.getBounds(),{padding:[45,45],maxZoom:15});revealMap();}
  }
  // Direction arrows and job-order numbers for a single vehicle.
  function drawDetail(c,b){
    if(!b)return;
    const serviceFeatures=b.features.filter(f=>f.properties.service);
    const step=Math.max(1,Math.ceil(serviceFeatures.length/350));
    serviceFeatures.forEach((f,i)=>{
      if(i%step)return;const m=midpoint(f);if(!m||m.km<0.04)return;
      const faded=timeLimit!=null&&f.properties.start_h>timeLimit;
      L.marker([m.lat,m.lon],{interactive:false,icon:L.divIcon({className:'route-arrow',html:`<span style="transform:rotate(${m.bearing}deg);color:${bandColor(f.properties.end_h)};opacity:${faded?.15:1}">➤</span>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(detailLayer);
    });
    // Thin out order numbers when zoomed out; always keep the first/last job and the selected one.
    const z=map.getZoom();const every=z>=14?1:z>=13?3:z>=12?8:20;
    b.seq.forEach(t=>{
      if(every>1&&t.seq!==1&&t.seq!==b.seq.length&&t.seq!==selectedTrip&&(t.seq-1)%every)return;
      const faded=timeLimit!=null&&t.start_h>timeLimit;
      L.marker([t.lat,t.lon],{zIndexOffset:800,icon:L.divIcon({className:'trip-seq'+(selectedTrip===t.seq?' is-selected':''),html:`<span style="background:${bandColor(t.end_h)};opacity:${faded?.2:1}">${t.seq}</span>`,iconSize:[24,24],iconAnchor:[12,12]})})
        .addTo(detailLayer).bindPopup(`<b>作業 ${t.seq} / ${b.seq.length}</b><br>出発から ${num(t.start_h,2)} 時間で開始、${num(t.end_h,2)} 時間で完了<br>作業 ${num(t.trip.service_km,2)} km／区間内回送 ${num(t.trip.deadhead_km,2)} km${t.end_h>SHIFT_HOURS?'<br><span class="bad">6時間の範囲外</span>':''}`,{autoPan:false})
        .on('click',()=>selectTrip(t.seq,false));
    });
  }
  map.on('zoomend',()=>{if(mode==='company')draw(false);});
  let popupWasOpen=false;
  map.on('preclick',()=>{popupWasOpen=!!map._popup;});
  map.on('click',()=>{if(popupWasOpen)return;if(mode==='company'&&+$('company-vehicle-focus').value)focusVehicle(0);});
  // Floating "back" control on the map itself so the way out is always visible.
  const backControl=L.control({position:'topright'});
  backControl.onAdd=()=>{const div=L.DomUtil.create('div','map-back-control');L.DomEvent.disableClickPropagation(div);div.innerHTML='';return div;};
  backControl.addTo(map);
  function updateBackControl(){
    const div=document.querySelector('.map-back-control');if(!div)return;
    const focus=mode==='company'?+$('company-vehicle-focus').value:0;
    const c=mode==='company'?company():null;
    div.innerHTML=mode==='all'?'':`<div class="map-back-title">${esc(companyLabel(c))}${focus?` / 車両 ${focus}`:''}</div>${focus?'<button class="primary-button" data-back="vehicles">◀ 全車両に戻る</button>':''}<button class="${focus?'text-button':'primary-button'}" data-back="companies">◀ 全社表示に戻る</button><span class="map-back-hint">${focus?'地図の何もない所をクリックしても全車両に戻ります':''}</span>`;
    div.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>b.dataset.back==='vehicles'?focusVehicle(0):allCompanies(false));
  }
  function selectTrip(seq,move){
    selectedTrip=selectedTrip===seq?null:seq;
    draw(false);
    if(move&&selectedTrip!=null){const t=tripIndex.find(x=>x.seq===selectedTrip);if(t){map.setView([t.lat,t.lon],Math.max(map.getZoom(),14));revealMap();}}
    if(!move){const row=document.querySelector(`#trip-table tr[data-seq="${selectedTrip}"]`);const box=row?.closest('.trip-scroll');if(row&&box)box.scrollTop=row.offsetTop-box.clientHeight/2;}
  }
  function renderTripPanel(c,focus,b){
    const panel=$('trip-panel');
    if(!focus||!b||!b.seq.length){panel.hidden=true;return;}
    panel.hidden=false;
    const total=b.hours;
    const slider=$('time-slider');slider.max=Math.ceil(total*2)/2;slider.step=.5;slider.value=timeLimit??slider.max;
    $('time-slider-value').textContent=timeLimit==null?'全行程':`出発から ${num(timeLimit,1)} 時間まで`;
    const done=timeLimit==null?b.seq.length:b.seq.filter(t=>t.end_h<=timeLimit).length;
    $('trip-nav').innerHTML=Array.from({length:+$('company-vehicles').value},(_,i)=>i+1).map(v=>`<button class="vehicle-chip${v===focus?' is-selected':''}" data-vehicle-chip="${v}"><i style="background:${color(v)}"></i>車${v}</button>`).join('');
    document.querySelectorAll('#trip-nav [data-vehicle-chip]').forEach(b2=>b2.onclick=()=>focusVehicle(+b2.dataset.vehicleChip));
    $('trip-summary').textContent=`車両 ${focus}：作業 ${b.seq.length} 件、行程 ${num(total,2)} 時間。${timeLimit==null?'':`${num(timeLimit,1)} 時間時点で完了 ${done} 件。`}6時間以内に完了する作業は ${b.seq.filter(t=>t.end_h<=SHIFT_HOURS).length} 件。`;
    $('trip-table').innerHTML=b.seq.map(t=>`<tr data-seq="${t.seq}" class="${selectedTrip===t.seq?'selected-row':''}${timeLimit!=null&&t.start_h>timeLimit?' faded-row':''}"><td><i class="legend-dot" style="background:${bandColor(t.end_h)}"></i>${t.seq}</td><td>${num(t.start_h,2)} h</td><td>${num(t.end_h,2)} h</td><td>${num(t.trip.service_km,2)} km</td><td>${num(t.trip.deadhead_km+t.incoming_km,2)} km</td><td class="${t.end_h<=SHIFT_HOURS?'ok':'bad'}">${t.end_h<=SHIFT_HOURS?'範囲内':'超過'}</td><td><button class="text-button" data-trip-go="${t.seq}">地図で見る</button></td></tr>`).join('');
    document.querySelectorAll('#trip-table tr[data-seq]').forEach(row=>row.onclick=e=>{if(e.target.closest('button'))return;selectTrip(+row.dataset.seq,false);});
    document.querySelectorAll('[data-trip-go]').forEach(b2=>b2.onclick=()=>{selectedTrip=null;selectTrip(+b2.dataset.tripGo,true);});
  }
  $('time-slider').oninput=()=>{const v=+$('time-slider').value;timeLimit=v>=+$('time-slider').max?null:v;draw(false);};
  $('time-slider-reset').onclick=()=>{timeLimit=null;selectedTrip=null;draw(false);};

  const companyLayers={};
  function allCompanies(fit=false){
    mode='all';setViewButtons(false);layer.clearLayers();detailLayer.clearLayers();routeLayer.clearLayers();
    $('trip-panel').hidden=true;
    Object.values(contractorMarkers).forEach(m=>m.getElement()?.classList.remove('is-selected'));
    cityRoadLayer?.setStyle({opacity:.12});
    CR.companies.forEach(c=>{
      companyLayers[c.id]=L.geoJSON({type:'FeatureCollection',features:c.trips.flatMap(t=>t.features.filter(f=>f.properties.service))},{style:()=>({color:companyColor(c.id),weight:2,opacity:.75}),onEachFeature:(f,l)=>l.bindPopup(`${esc(companyLabel(c))}の広域担当区間<br><button class="text-button" data-popup-company="${c.id}">この会社の車両別経路を表示 →</button>`,{autoPan:false})});
      if(!hiddenCompanies.has(c.id))companyLayers[c.id].addTo(layer);
    });
    const a=CR.summary;
    $('company-map-legend').innerHTML=`<b>仮定配備による割当（会社ごとの色）</b><span>実線：試算で割り当てた区間　赤：往復到達できず未割当　角丸の業1〜業4：公開住所の代表点（クリックで車両別経路）。凡例をクリックすると表示を切り替えます。</span><div>${CR.companies.map(c=>`<button class="vehicle-chip company-toggle${hiddenCompanies.has(c.id)?' is-off':''}" data-company-toggle="${c.id}"><i style="background:${companyColor(c.id)}"></i>${esc(companyLabel(c))}</button>`).join('')}<label class="vehicle-chip"><input type="checkbox" id="unassigned-toggle" ${map.hasLayer(missing)?'checked':''}> <i style="background:#d13932"></i>未割当 ${num(a.unassigned_arcs)} 区間</label></div><div class="legend-actions"><button id="fit-all" class="text-button">全社の範囲に合わせる</button></div>`;
    document.querySelectorAll('[data-company-toggle]').forEach(b=>b.onclick=()=>{const id=b.dataset.companyToggle;if(hiddenCompanies.has(id)){hiddenCompanies.delete(id);companyLayers[id].addTo(layer);}else{hiddenCompanies.add(id);layer.removeLayer(companyLayers[id]);}b.classList.toggle('is-off',hiddenCompanies.has(id));});
    $('unassigned-toggle').onchange=e=>e.target.checked?missing.addTo(map):map.removeLayer(missing);
    $('fit-all').onclick=()=>{if(layer.getLayers().length)map.fitBounds(layer.getBounds(),{padding:[35,35]});};
    updateBackControl();
    if(fit&&layer.getLayers().length)map.fitBounds(layer.getBounds(),{padding:[35,35]});
  }
  const missing=L.geoJSON(CR.unassigned_geometry,{style:()=>({color:'#d13932',weight:3,opacity:.8}),onEachFeature:(f,l)=>l.bindPopup(`未割当：${esc(f.properties.reason)}`,{autoPan:false})}).addTo(map);
  function updateSummary(){
    const a=CR.summary;
    $('dispatch-audit').textContent=`広域${num(a.required_arcs)}方向区間のうち${num(a.assigned_arcs)}区間を4社・仮定${a.fleet}台へ割当。作業重複${a.duplicate_service_arcs}。未割当${num(a.unassigned_arcs)}区間は赤で表示。この仮定台数で全社完了まで約${num(a.baseline_makespan_hours,1)}時間（休憩なし・全車同時出発の理論時間）となり、6時間内の配車としては成立しません。`;
    $('top-stats').lastElementChild.outerHTML=stat('広域の仮定割当',num(a.assigned_arcs),'方向区間',`${num(a.unassigned_arcs)}区間は未割当`);
    $('city-stats').innerHTML=stat('対象の方向区間',num(a.required_arcs),'区間','市域と周辺のOSM車道')+stat('事業者・車両へ配車',num(a.assigned_arcs),'区間','4社が重複なく担当')+stat('仮定の試算台数',a.fleet,'台','公表主要機種による仮定')+stat('往復できず未割当',num(a.unassigned_arcs),'区間','架空の接続は追加しません');
    $('city-audit').textContent=CR.scope+' '+CR.method+' '+CR.transit_note;
    $('dispatch-mode-note').textContent=CR.mode==='joint'?'各社の仮定台数を考慮して区域境界を調整し、近い作業へ直行する近似配車。仮定30台で比較します（この方式では台数を変更できません）。':'比較用の基準線。会社所在地への道路上の近さだけで区域を作成し、台数を考慮しないため、台数の少ないKRS・サツイチに区間が集中します。会社内の台数を変更できます。';
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
      const wasCompany=mode==='company';
      selectCompany($('route-company').value);updateSummary();
      if(!wasCompany)allCompanies(false);   // keep the current viewport either way
    }catch(error){el.value=CR===window.JOINT_ROUTES?'joint':'fixed';$('dispatch-mode-note').textContent=error.message;}
    finally{el.disabled=false;}
  };
  $('route-company').onchange=()=>selectCompany($('route-company').value,false);
  $('company-vehicles').onchange=()=>{selectedCounts[company().id]=+$('company-vehicles').value;updateFocus();draw(false);};
  $('company-vehicle-focus').onchange=()=>{selectedTrip=null;timeLimit=null;draw(false);};
  $('company-route-view').onclick=()=>draw(true);
  // Markers: click selects the company (popup opens, viewport unchanged). Hover only highlights.
  for(const c of CR.companies){
    const marker=contractorMarkers[c.id];
    marker.on('click',()=>selectCompany(c.id,false));
    marker.getElement()?.addEventListener('keydown',e=>{if(e.key==='Enter')selectCompany(c.id,false);});
  }
  selectCompany(CR.companies[0].id);allCompanies(true);
  $('company-view').onclick=()=>draw(false);
  $('city-view').onclick=()=>allCompanies(false);
}
