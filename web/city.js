'use strict';
const C=decodeRoads(window.SAPPORO_CITY);
let cityRoadLayer=null;
if(C){
  const layer=L.geoJSON(C.roads,{style:()=>({color:'#82988d',weight:1,opacity:.3}),onEachFeature:(f,l)=>l.bindPopup(`${esc(f.properties.name)}<br>OSM way ${f.properties.way_id}<br>取得した作業対象道路の下図。担当は事業者別レイヤーで表示。`)}).addTo(map);
  cityRoadLayer=layer;
  $('city-roads-toggle').onchange=e=>e.target.checked?layer.addTo(map):map.removeLayer(layer);
  $('city-roads-view').onclick=()=>{layer.addTo(map);$('city-roads-toggle').checked=true;map.fitBounds(layer.getBounds());$('map').scrollIntoView({behavior:'smooth',block:'center'});};
}
if(window.SAPPORO_BOUNDARY){
  map.createPane('municipal-boundary');map.getPane('municipal-boundary').style.zIndex=450;
  const boundary=L.geoJSON(window.SAPPORO_BOUNDARY.boundary,{pane:'municipal-boundary',interactive:false,style:()=>({color:'#283644',weight:2.5,dashArray:'10 6',fill:false})}).addTo(map);
  const label=document.createElement('label');label.innerHTML='<input id="boundary-layer" type="checkbox" checked> 札幌市境（黒破線）';document.querySelector('.dc-map-controls').appendChild(label);
  $('boundary-layer').onchange=e=>e.target.checked?boundary.addTo(map):map.removeLayer(boundary);
  const note=document.createElement('p');note.className='fineprint';note.id='municipal-scope';note.textContent='札幌市境はOSMの行政界。公開4社の所在地はすべて札幌市内です。作業対象は市境で切り抜いていないため、小樽・石狩等の市外道路も含みます。市外の担当は実契約の確認を示しません。';document.querySelector('.map-panel').appendChild(note);
}
