/* Public facts are loaded from the local reproducible bundle. No external API calls. */
'use strict';
const D=window.SAPPORO_DATA;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'未確認').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=0)=>Number(v).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
const colors=['#207f69','#6374b9','#cd874a','#9b6090','#448aa1','#9a9d43','#926451','#686e7c'];
const stat=(label,value,unit,note)=>`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-note">${note}</div></div>`;
const link=(url,label)=>`<a href="${esc(url)}" target="_blank" rel="noreferrer">${label} ↗</a>`;
$('top-stats').innerHTML=stat('協会掲載の所在地',D.contractor_directory.length,'件','保有台数確認は4社')+stat('地区別の機械計画',D.district_fleet.length,'地区','2026年度・予定資料')+stat('融雪と排熱の調査候補',D.candidates.length,'エリア','用地・受電余力は未確認')+stat('実道路の計算範囲',num(D.analysis.audit.processed_arcs),'方向区間','八軒周辺の限定実証');
const a=D.analysis.audit;
$('coverage-notice').innerHTML=`<b>市全域の経路ではありません。</b> 抽出した${num(a.required_arcs)}方向区間のうち、${num(a.processed_arcs)}区間を計算（${num(a.processed_arcs/a.required_arcs*100,1)}%）。接続が分かれた${a.excluded_connectivity_arcs}区間は未計算です。計算対象内の被覆率は100%。車道以外・構内道路等・矩形境界をまたぐ道路は抽出条件で除外しています。`;

const map=L.map('map',{scrollWheelZoom:false,preferCanvas:true}).setView([43.075,141.36],11);
const base=L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',{maxZoom:18,attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>'}).addTo(map);
map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>');
L.control.scale({imperial:false}).addTo(map);
$('base-map').onchange=e=>e.target.checked?base.addTo(map):map.removeLayer(base);
const roads=L.geoJSON(D.roads,{style:f=>({color:f.properties.included?'#769389':'#c56754',weight:f.properties.included?2:3,opacity:.7}),
  onEachFeature:(f,l)=>l.bindPopup(`<b>${esc(f.properties.name)}</b><br>OSM way ${f.properties.way_id}<br>${num(f.properties.length_m)}m / ${f.properties.included?'計算対象':'接続分離・未計算'}`)}).addTo(map);
const siteMarkers={};
D.candidates.forEach((s,i)=>{if(s.latitude==null)return;siteMarkers[s.id]=L.marker([s.latitude,s.longitude],{icon:L.divIcon({className:'site-marker',html:String(i+1),iconSize:[25,25]})}).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)}<br><small>${esc(s.location_status)}</small><br>${link(s.source_url,'施設資料')}`);});
D.contractors.forEach(s=>{if(s.latitude==null)return;L.marker([s.latitude,s.longitude],{icon:L.divIcon({className:'contractor-marker',iconSize:[13,13]})}).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.location_type)}<br>${esc(s.address)}<br><small>会社全体の公表数／この拠点の配備数ではない</small><br>${Object.entries(s.fleet).map(([k,v])=>`${esc(k)} ${v}台`).join('<br>')}<br>${link(s.source_url,'会社公表値')}`);});
D.analysis.depots.forEach(s=>L.marker([s.lat,s.lon],{icon:L.divIcon({className:'depot-marker',iconSize:[12,12]})}).addTo(map).bindPopup(`${esc(s.id)}<br>道路端に置いた仮定の待機点。実在する車庫ではありません。`));
const routeLayer=L.layerGroup().addTo(map);
function switchView(pilot){$('city-view').classList.toggle('selected',!pilot);$('pilot-view').classList.toggle('selected',pilot);if(pilot)map.fitBounds(roads.getBounds(),{padding:[25,25]});else map.fitBounds(L.latLngBounds(D.candidates.concat(D.contractors).filter(s=>s.latitude!=null).map(s=>[s.latitude,s.longitude])),{padding:[35,35]});}
$('city-view').onclick=()=>{routeLayer.clearLayers();switchView(false);};
$('pilot-view').onclick=()=>{drawRoutes();switchView(true);};
function drawRoutes(){routeLayer.clearLayers();const count=+$('vehicles').value;L.geoJSON({type:'FeatureCollection',features:D.routes.features.filter(f=>f.properties.scenario===count)},{style:f=>({color:colors[(f.properties.vehicle-1)%colors.length],weight:3,opacity:.8}),onEachFeature:(f,l)=>l.bindPopup(`車両 ${f.properties.vehicle}<br>${esc(f.properties.depot)}<br>${num(f.properties.distance_km,2)}km<br>方向・走行順はroutes.geojsonとanalysis.jsonに保存`) }).addTo(routeLayer);}
$('show-routes').onclick=()=>{drawRoutes();switchView(true);$('map').scrollIntoView({behavior:'smooth',block:'center'});};
function numberInput(id){const el=$(id);return el.checkValidity()&&el.value!==''?Number(el.value):null;}
function updateRoutes(){
  const speed=+$('speed').value,travel=+$('deadhead').value,hourly=numberInput('hourly'),shift=numberInput('shift'),count=+$('vehicles').value;
  $('speed-value').textContent=speed+' km/h';$('deadhead-value').textContent=travel+' km/h';
  if(hourly==null||shift==null){$('route-stats').innerHTML='<p class="notice">費用と時間上限に有効な値を入力してください。</p>';return;}
  const scenarios=D.analysis.scenarios.map(s=>{const times=s.routes.map(r=>r.service_km/speed+r.deadhead_km/travel);return {...s,times,makespan:Math.max(...times),cost:times.reduce((a,b)=>a+b,0)*hourly};});
  const s=scenarios.find(s=>s.vehicles===count);
  $('route-stats').innerHTML=stat('完了までの時間',num(s.makespan,2),'時間','各車両を同時に出動')+stat('総走行距離',num(s.total_km,1),'km','全車両の合計')+stat('変動費の試算',num(s.cost/10000,2),'万円','仮の時間単価による比較');
  $('scenario-table').innerHTML=scenarios.map(s=>`<tr class="${s.vehicles===count?'selected-row':''}"><td>${s.vehicles}台</td><td>${num(s.makespan,2)} h</td><td>${num(s.total_km,1)} km</td><td>${num(s.deadhead_km,1)} km</td><td>¥${num(s.cost)}</td><td class="${s.makespan<=shift?'ok':'bad'}">${s.makespan<=shift?'範囲内':'超過・要再計画'}</td></tr>`).join('');
  $('vehicle-list').innerHTML=s.routes.map((r,i)=>`<span class="vehicle-chip"><i style="background:${colors[i%colors.length]}"></i>車両 ${r.vehicle_id}　${num(s.times[i],2)} h / ${num(r.distance_km,1)} km</span>`).join('');
  if($('pilot-view').classList.contains('selected'))drawRoutes();
}
['vehicles','speed','deadhead','hourly','shift'].forEach(id=>$(id).addEventListener('input',updateRoutes));updateRoutes();
function updateHeat(){
  const it=+$('it').value,load=+$('load').value/100,recovery=+$('recovery').value/100,temp=+$('snow-temp').value,hours=+$('heat-hours').value,density=numberInput('density');
  $('it-value').textContent=it+' MW';$('load-value').textContent=num(load*100)+'%';$('recovery-value').textContent=num(recovery*100)+'%';$('snow-temp-value').textContent=temp+'℃';$('heat-hours-value').textContent=hours+'時間/日';
  const q=it*load*recovery,tonnes=q*hours*3600/(333.5+2.1*Math.abs(temp));
  $('melt-tonnes').textContent=num(tonnes);$('melt-volume').textContent=density==null?'密度を入力':num(tonnes*1000/density)+' m³/日';$('heat-output').textContent=num(q,2)+' MW';
}
['it','load','recovery','snow-temp','density','heat-hours'].forEach(id=>$(id).addEventListener('input',updateHeat));updateHeat();
$('site-grid').innerHTML=D.candidates.map((s,i)=>`<article class="site-card"><div class="site-top"><span>候補 ${String(i+1).padStart(2,'0')}</span><span>調査順 ${s.investigation_tier} · 条件付き</span></div><h3>${esc(s.name)}</h3><p>${esc(s.address)}<br>${esc(s.facility_status)}</p><div class="site-capacity">${s.existing_capacity_m3_day==null?'未確認':num(s.existing_capacity_m3_day)} <small>${s.existing_capacity_m3_day==null?'処理能力':'m³/日・公表融雪能力'}</small></div><p>${esc(s.rationale)}</p><p class="checks">確認事項：${esc(s.site_specific_checks)}</p><div class="site-actions"><button data-site="${s.id}">地図で見る ↑</button>${link(s.source_url,'根拠資料')}</div></article>`).join('');
document.querySelectorAll('[data-site]').forEach(b=>b.onclick=()=>{const s=D.candidates.find(s=>s.id===b.dataset.site);if(s.latitude!=null){map.setView([s.latitude,s.longitude],15);siteMarkers[s.id].openPopup();$('map').scrollIntoView({behavior:'smooth',block:'center'});}});
$('contractor-table').innerHTML=D.contractors.map(c=>`<tr><td><b>${esc(c.name)}</b><small>${esc(c.location_type)}<br>${esc(c.address)}</small></td><td>${Object.entries(c.fleet).map(([k,v])=>`<span class="equipment">${esc(k)} <b>${v}台</b></span>`).join('')}</td><td>${link(c.source_url,'機械')}<br>${link(c.address_source_url,'所在地')}</td></tr>`).join('');
$('district-table').innerHTML=D.district_fleet.map(r=>`<tr><td>${esc(r.ward+r.district)}</td><td>${Object.values(r.city_loan).reduce((a,b)=>a+b,0)}台</td><td>${r.minimum_including_city_loan.grader_family}台</td><td>${r.minimum_including_city_loan.wheel_loader_8t}台</td><td>${r.minimum_including_city_loan.dump_10t}台</td></tr>`).join('');
function directory(){const q=$('company-search').value.trim();const rows=D.contractor_directory.filter(r=>(r.name+r.address).includes(q));$('company-count').textContent=rows.length+'件';$('directory-table').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td>未確認</td></tr>`).join('');}
$('company-search').oninput=directory;directory();
if(D.weather){$('weather-table').innerHTML=D.weather.stations.map(r=>`<tr><td>${esc(r.station)}</td><td>${num(r.snowfall_sum_cm)} cm</td><td>${num(r.snowfall_max_cm)} cm</td><td>${r.days_over_10cm}日</td><td>${num(r.snowdepth_max_cm)} cm</td></tr>`).join('');$('weather-note').textContent=D.weather.period+'。'+D.weather.notes;}
$('source-list').innerHTML=D.sources.map(r=>`<div class="source-row"><span>${link(r.url,esc(r.id))}</span><small>${esc(r.retrieved_at.slice(0,10))} · <a href="../${esc(r.path.replaceAll('\\','/'))}">取得原本</a></small></div>`).join('');
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){document.querySelectorAll('nav a').forEach(n=>n.classList.toggle('active',n.hash==='#'+e.target.id));}}),{rootMargin:'-5% 0px -70% 0px'});document.querySelectorAll('main section').forEach(s=>observer.observe(s));
