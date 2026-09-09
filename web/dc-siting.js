'use strict';
// Snow-supply screening for DC candidates: 1 km mesh of road snowfall (season tonnes at the
// assumed haul fraction), assignment of every cell to the nearest site of a chosen candidate
// set, and a factor table that keeps snow, power, IX and land as separate columns (no score).
(function(){
  const S=window.DC_SITING;if(!S)return;
  const dcIndex=Object.fromEntries(D.dc.candidates.map((c,i)=>[c.id,i+1]));
  const label=id=>`DC${dcIndex[id]??'?'}`;
  const siteColors=['#1f7a4d','#2f6fb3','#c78a1e','#b8402f','#6a4c93','#0f8b8d','#8b5e3c'];
  const colorOf=Object.fromEntries(S.candidates.map((c,i)=>[c.id,siteColors[i%siteColors.length]]));
  const cellKm=S.assumptions.cell_km,kx=111.32*Math.cos(43.06*Math.PI/180),ky=110.57;
  const maxT=Math.max(...S.cells.map(c=>c[2]));
  const meshLayer=L.featureGroup();
  let chosen=S.best_sets['2'][0].ids.slice();
  const detour=S.assumptions.detour_factor;
  const hav=(a,b)=>{const r=Math.PI/180,dl=(b[1]-a[1])*r,dp=(b[0]-a[0])*r,h=Math.sin(dp/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dl/2)**2;return 6371.0088*2*Math.asin(Math.sqrt(h));};
  function drawMesh(){
    meshLayer.clearLayers();
    const sites=S.candidates.filter(c=>chosen.includes(c.id));
    for(const [lat,lon,season,peak,km] of S.cells){
      const near=sites.length?sites.reduce((a,c)=>{const d=hav([lat,lon],[c.lat,c.lon])*detour;return d<a.d?{c,d}:a;},{c:null,d:Infinity}):{c:null,d:null};
      const fill=near.c?colorOf[near.c.id]:'#5b6b62';
      const op=0.08+0.62*Math.sqrt(season/maxT);
      const b=[[lat-cellKm/ky/2,lon-cellKm/kx/2],[lat+cellKm/ky/2,lon+cellKm/kx/2]];
      L.rectangle(b,{color:fill,weight:.4,opacity:.5,fillColor:fill,fillOpacity:op,interactive:true})
        .bindPopup(`<b>1kmメッシュ</b><br>季節の路上降雪（排雪率${Math.round(S.assumptions.haul_fraction*100)}%換算） ${num(season)} t<br>95%日量 ${num(peak)} t／日<br>対象車道 ${num(km,1)} km<br>${near.c?`最寄り候補 ${label(near.c.id)}（直線×${detour}＝${num(near.d,1)} km）`:''}<br><small>最寄り観測点の降雪×仮定幅。実排雪量ではない</small>`,{autoPan:false}).addTo(meshLayer);
    }
    S.candidates.filter(c=>chosen.includes(c.id)).forEach(c=>L.circleMarker([c.lat,c.lon],{radius:9,color:'#fff',weight:2,fillColor:colorOf[c.id],fillOpacity:1}).bindTooltip(`${label(c.id)} ${esc(c.name)}`).addTo(meshLayer));
  }
  const controls=document.querySelector('.dc-map-controls');
  const lbl=document.createElement('label');lbl.innerHTML='<input id="mesh-layer" type="checkbox"> <i class="legend-dot" style="background:#1f7a4d"></i>路上降雪メッシュ（最寄り候補で色分け）';controls.appendChild(lbl);
  $('mesh-layer').onchange=e=>e.target.checked?meshLayer.addTo(map):map.removeLayer(meshLayer);
  function showMesh(){$('mesh-layer').checked=true;meshLayer.addTo(map);}
  const t=S.totals;
  $('siting-totals').innerHTML=stat('市内の対象車道',num(t.road_km),'km','未舗装・私道等を除く作業対象。往復を二重計上しない')+stat('季節の路上降雪',num(Math.round(t.season_t/1e4)/100,2),'百万t',`排雪率${Math.round(S.assumptions.haul_fraction*100)}%換算。13観測点の2025年度合計`)+stat('平均日量',num(t.avg_day_t),'t/日',`${S.assumptions.season_days}日で均した値。20MW DC 1か所で${num(t.share_of_avg_day_per_20mw*100,1)}%`)+stat('95%日量',num(t.peak_day_t),'t/日','全量を当日に融雪するには非現実的なMWが要る。貯雪で平準化する前提');
  const pct=v=>v==null?'—':`${num(v*100,0)}%`;
  function renderFactors(){
    $('siting-factors').innerHTML=S.factors.map(f=>{const sn=f.snow,g=f.grid,x=f.ix,l=f.land,b=l.buildings;
      return `<tr class="${chosen.includes(f.id)?'selected-row':''}"><td><b>${label(f.id)}</b> ${esc(f.name)}<br><small>${esc(f.verdict)}</small></td>
        <td>${num(sn.mean_km,1)} km<br><small>10km圏 ${pct(sn.share_within_10km)}</small></td>
        <td>${sn.tonne_km_saved_vs_best2==null?'<small>最良2地点に含む</small>':`${num(Math.round(sn.tonne_km_saved_vs_best2/1e3))} 千t·km`}</td>
        <td>${esc(g.line_187kv||'—')} ${g.line_187kv_km==null?'':num(g.line_187kv_km,1)+' km'}<br><small>${esc(g.line_187kv_rank||'')}／187kV変電所 ${esc(g.substation_187kv)} ${num(g.substation_187kv_km,1)} km</small></td>
        <td>${x.hix_km==null?'—':num(x.hix_km,1)+' km'}</td>
        <td>${b?`${pct(b.residential_share_of_typed)}<br><small>種別付き${num(b.buildings-b.unspecified)}棟中。住宅街路 ${num(l.residential_street_km_per_km2,1)} km/km²</small>`:'—'}</td>
        <td>${l.industrial_parcels_ge_3ha}区画<br><small>最大 ${num(l.largest_industrial_ha,1)} ha／工業 ${pct(l.industrial_share)}／団地 ${esc(x.industrial_park)} ${num(x.industrial_park_km,1)} km</small></td></tr>`;}).join('');
  }
  function renderSets(){
    const k=$('siting-k').value;const sets=S.best_sets[k];
    $('siting-sets').innerHTML=sets.map((e,i)=>`<tr class="${e.ids.join()===chosen.join()?'selected-row':''}"><td>${i+1}</td><td>${e.ids.map(id=>`<span class="legend-tag" style="background:${colorOf[id]}">${label(id)}</span>`).join(' ')}</td><td>${num(e.mean_km,2)} km</td><td>${num(Math.round(e.tonne_km/1e6),0)} 百万t·km</td><td><small>${e.sites.map(s=>`${label(s.id)} ${pct(s.share)}`).join('・')}</small></td><td><button class="text-button" data-siting-set="${e.ids.join(',')}">地図で見る</button></td></tr>`).join('');
    document.querySelectorAll('[data-siting-set]').forEach(b=>b.onclick=()=>{chosen=b.dataset.sitingSet.split(',');drawMesh();showMesh();renderFactors();renderSets();revealMap();map.fitBounds(meshLayer.getBounds(),{padding:[20,20]});});
  }
  $('siting-k').onchange=()=>{chosen=S.best_sets[$('siting-k').value][0].ids.slice();drawMesh();renderFactors();renderSets();};
  $('siting-view').onclick=()=>{showMesh();revealMap();map.fitBounds(meshLayer.getBounds(),{padding:[20,20]});$('map').scrollIntoView({behavior:'smooth',block:'center'});};
  $('siting-assumptions').textContent=`仮定：道路種別ごとの除雪幅 ${Object.entries(S.assumptions.plowed_width_m).filter(([k])=>!k.endsWith('_link')).map(([k,v])=>`${k} ${v}m`).join('、')}。新雪密度 ${S.assumptions.fresh_snow_density_kg_m3} kg/m³、排雪率 ${Math.round(S.assumptions.haul_fraction*100)}%、距離は直線×${S.assumptions.detour_factor}。${S.assumptions.notes.join(' ')}`;
  drawMesh();renderFactors();renderSets();
})();
