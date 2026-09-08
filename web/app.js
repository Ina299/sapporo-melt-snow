/* Public facts are loaded from the local reproducible bundle. No external API calls. */
'use strict';
const D=window.SAPPORO_DATA;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'未確認').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=0)=>Number(v).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
const colors=['#207f69','#6374b9','#cd874a','#9b6090','#448aa1','#9a9d43','#926451','#686e7c'];
const stat=(label,value,unit,note)=>`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-note">${note}</div></div>`;
const link=(url,label)=>`<a href="${esc(url)}" target="_blank" rel="noreferrer">${label} ↗</a>`;
if(D.dc){
  $('dc-sites').innerHTML=D.dc.candidates.map(s=>`<article class="panel dc-card"><span class="tag">${esc(s.verdict)}</span><h3>${esc(s.name)}</h3><p>${esc(s.land)}</p><p>${esc(s.rationale)}</p><p class="fineprint">${esc(s.hazard)}</p>${link(s.source_url,'用地資料')}</article>`).join('');
  $('dc-assumptions').textContent=D.dc.assumptions;
  $('dc-scenarios').innerHTML=D.dc.scenarios.map(s=>`<tr><td>${s.it_mw} MW</td><td>${num(s.tonnes_day)}</td><td>${num(s.snow_m3_day)}</td><td>${num(s.loads_day_at_8t)}</td><td>${s.unload_bays_at_16h_8min_70pct}</td></tr>`).join('');
  $('dc-network').textContent=Object.values(D.dc.ix).join(' ');
}
$('top-stats').innerHTML=stat('協会掲載の所在地',D.contractor_directory.length,'件','4社の掲載値を確認・配備未確認')+stat('地区別の機械計画',D.district_fleet.length,'地区','2026年度・予定資料')+stat('融雪と排熱の調査候補',D.candidates.length,'エリア','用地・受電余力は未確認')+stat('広域配車','読込中','','');
const map=L.map('map',{scrollWheelZoom:false,preferCanvas:true,zoomSnap:.25,zoomDelta:.5}).setView([43.075,141.36],11);
const base=L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',{maxZoom:18,attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>'}).addTo(map);
map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>');
L.control.scale({imperial:false}).addTo(map);
$('base-map').onchange=e=>e.target.checked?base.addTo(map):map.removeLayer(base);
const siteMarkers={};
const contractorMarkers={};
const contractorNumber=id=>D.contractors.findIndex(c=>c.id===id)+1;
const companyLabel=c=>`事業者${contractorNumber(c.id)} · ${c.name}`;
const companyPalette={toyo:'#386dbe',kashima:'#9260a8',satsuichi:'#268574',krs:'#b08028'};
const companyColor=id=>companyPalette[id];
const meltLayer=L.layerGroup().addTo(map);
$('melt-layer').onchange=e=>e.target.checked?meltLayer.addTo(map):map.removeLayer(meltLayer);
function showMeltLayer(){$('melt-layer').checked=true;meltLayer.addTo(map);}
const dcMarkers={};
const dcLayer=L.layerGroup().addTo(map);
(D.dc?.candidates??[]).forEach((s,i)=>{
  if(s.latitude==null||s.longitude==null)return;
  dcMarkers[s.id]=L.marker([s.latitude,s.longitude],{title:`DC${i+1} ${s.name}`,icon:L.divIcon({className:'dc-marker',html:`DC${i+1}`,iconSize:[40,28],iconAnchor:[20,14]}),zIndexOffset:500})
    .addTo(dcLayer).bindPopup(`<b>DC${i+1} ${esc(s.name)}</b><br>${esc(s.verdict)}<br><small>${esc(s.location_status)}<br>表示基準：${esc(s.map_address)}</small><br>${esc(s.land)}<br>${link(s.source_url,'用地資料')}`);
  const card=$('dc-sites').children[i];
  const button=document.createElement('button');button.className='text-button dc-map-button';button.dataset.dcSite=s.id;button.textContent=`DC${i+1} 地図で見る ↑`;
  button.onclick=()=>{showDcLayer();routeLayer.clearLayers();setViewButtons(false);map.setView([s.latitude,s.longitude],13);dcMarkers[s.id].openPopup();$('map').scrollIntoView({behavior:'smooth',block:'center'});};
  card.appendChild(button);
});
$('dc-layer').onchange=e=>e.target.checked?dcLayer.addTo(map):map.removeLayer(dcLayer);
function showDcLayer(){$('dc-layer').checked=true;dcLayer.addTo(map);}
function setViewButtons(pilot){$('city-view').classList.toggle('selected',!pilot);$('company-view').classList.toggle('selected',pilot);}
$('dc-view').onclick=()=>{showDcLayer();routeLayer.clearLayers();setViewButtons(false);const points=(D.dc?.candidates??[]).filter(s=>s.latitude!=null).map(s=>[s.latitude,s.longitude]);if(points.length)map.fitBounds(points,{padding:[45,45],maxZoom:12});};
D.candidates.forEach((s,i)=>{if(s.latitude==null)return;siteMarkers[s.id]=L.marker([s.latitude,s.longitude],{icon:L.divIcon({className:'site-marker',html:String(i+1),iconSize:[25,25]})}).addTo(meltLayer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)}<br><small>${esc(s.location_status)}</small><br>${link(s.source_url,'施設資料')}`);});
D.contractors.forEach(s=>{if(s.latitude==null)return;contractorMarkers[s.id]=L.marker([s.latitude,s.longitude],{title:s.name,icon:L.divIcon({className:'contractor-marker numbered-contractor',html:`<span>業${contractorNumber(s.id)}</span>`,iconSize:[25,25],iconAnchor:[12,12]}),zIndexOffset:1500,riseOnHover:true}).addTo(map).bindTooltip(esc(companyLabel(s)),{direction:'top',offset:[0,-20]}).bindPopup(`<b>${esc(companyLabel(s))}</b><br>${esc(s.location_type)}<br>${esc(s.address)}<br><small>${esc(s.published_scope)}<br>拠点配備：未確認／地番代表点・入口未確認</small><br>${Object.entries(s.fleet).map(([k,v])=>`${esc(k)} ${v}台`).join('<br>')}<br>${link(s.source_url,'会社公表値')}`);});
Object.entries(contractorMarkers).forEach(([id,marker])=>marker.getElement().style.setProperty('--company-color',companyColor(id)));
const routeLayer=L.layerGroup().addTo(map);
function numberInput(id){const el=$(id);return el.checkValidity()&&el.value!==''?Number(el.value):null;}
function updateHeat(){
  const it=+$('it').value,load=+$('load').value/100,recovery=+$('recovery').value/100,temp=+$('snow-temp').value,hours=+$('heat-hours').value,density=numberInput('density');
  $('it-value').textContent=it+' MW';$('load-value').textContent=num(load*100)+'%';$('recovery-value').textContent=num(recovery*100)+'%';$('snow-temp-value').textContent=temp+'℃';$('heat-hours-value').textContent=hours+'時間/日';
  const q=it*load*recovery,tonnes=q*hours*3600/(333.5+2.1*Math.abs(temp));
  $('melt-tonnes').textContent=num(tonnes);$('melt-volume').textContent=density==null?'密度を入力':num(tonnes*1000/density)+' m³/日';$('heat-output').textContent=num(q,2)+' MW';
}
['it','load','recovery','snow-temp','density','heat-hours'].forEach(id=>$(id).addEventListener('input',updateHeat));updateHeat();
$('site-grid').innerHTML=D.candidates.map((s,i)=>`<article class="site-card"><div class="site-top"><span>候補 ${String(i+1).padStart(2,'0')}</span><span>調査順 ${s.investigation_tier} · 条件付き</span></div><h3>${esc(s.name)}</h3><p>${esc(s.address)}<br>${esc(s.facility_status)}</p><div class="site-capacity">${s.existing_capacity_m3_day==null?'未確認':num(s.existing_capacity_m3_day)} <small>${s.existing_capacity_m3_day==null?'処理能力':'m³/日・公表融雪能力'}</small></div><p>${esc(s.rationale)}</p><p class="checks">確認事項：${esc(s.site_specific_checks)}</p><div class="site-actions"><button data-site="${s.id}">地図で見る ↑</button>${link(s.source_url,'根拠資料')}</div></article>`).join('');
document.querySelectorAll('[data-site]').forEach(b=>b.onclick=()=>{const s=D.candidates.find(s=>s.id===b.dataset.site);if(s.latitude!=null){showMeltLayer();map.setView([s.latitude,s.longitude],15);siteMarkers[s.id].openPopup();$('map').scrollIntoView({behavior:'smooth',block:'center'});}});
$('contractor-table').innerHTML=D.contractors.map(c=>`<tr><td><b>${esc(companyLabel(c))}</b><small>${esc(c.location_type)}<br>${esc(c.address)}<br>${esc(c.location_evidence)}<br>座標：${esc(c.geocoded_title)}の代表点（枝番・入口未確認）</small></td><td><small>${esc(c.published_scope)}</small>${Object.entries(c.fleet).map(([k,v])=>`<span class="equipment">${esc(k)} <b>${v}台</b></span>`).join('')}</td><td><b>試算 ${c.scenario_fleet_count}台</b><small>${Object.entries(c.scenario_fleet).map(([k,v])=>`${esc(k)} ${v}台`).join('＋')}<br>試算から除外：${Object.entries(c.excluded_fleet).map(([k,v])=>`${esc(k)} ${v}台`).join('、')}<br>拠点の実配備：未確認</small></td><td>${link(c.source_url,'機械')}<br>${link(c.address_source_url,'所在地')}</td></tr>`).join('');
$('district-table').innerHTML=D.district_fleet.map(r=>`<tr><td>${esc(r.ward+r.district)}</td><td>${Object.values(r.city_loan).reduce((a,b)=>a+b,0)}台</td><td>${r.minimum_including_city_loan.grader_family}台</td><td>${r.minimum_including_city_loan.wheel_loader_8t}台</td><td>${r.minimum_including_city_loan.dump_10t}台</td></tr>`).join('');
function directory(){const q=$('company-search').value.trim();const rows=D.contractor_directory.filter(r=>(r.name+r.address).includes(q));$('company-count').textContent=rows.length+'件';$('directory-table').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td>未確認</td></tr>`).join('');}
$('company-search').oninput=directory;directory();
if(D.weather){$('weather-table').innerHTML=D.weather.stations.map(r=>`<tr><td>${esc(r.station)}</td><td>${num(r.snowfall_sum_cm)} cm</td><td>${num(r.snowfall_max_cm)} cm</td><td>${r.days_over_10cm}日</td><td>${num(r.snowdepth_max_cm)} cm</td></tr>`).join('');$('weather-note').textContent=D.weather.period+'。'+D.weather.notes;}
$('source-list').innerHTML=D.sources.map(r=>`<div class="source-row"><span>${link(r.url,esc(r.id))}</span><small>${esc(r.retrieved_at.slice(0,10))} · <a href="../${esc(r.path.replaceAll('\\','/'))}">取得原本</a></small></div>`).join('');
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){document.querySelectorAll('nav a').forEach(n=>n.classList.toggle('active',n.hash==='#'+e.target.id));}}),{rootMargin:'-5% 0px -70% 0px'});document.querySelectorAll('main section').forEach(s=>observer.observe(s));
