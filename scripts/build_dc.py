"""Evidence snapshots and a conditional DC shortlist; no parcel certification."""
import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import requests
from geocode_dc import locate

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.thermal import melt_capacity

SOURCES = {
    'land': 'https://www.ishikari-dev.co.jp/bunjyo/',
    'infrastructure': 'https://www.ishikari-dev.co.jp/infrastructure/',
    'jpnap_pop': 'https://www.jpnap.net/ix/pop',
    'jpnap_options': 'https://www.jpnap.net/ix/option',
    'sapporoix_poc': 'https://www.city.ishikari.hokkaido.jp/shisei/shiseiunei/1001911/1003728.html',
    'dc_precedent': 'https://www.tokyu-dc.com/dc_ishikari.html',
    'grid_lines': 'https://hello.hepco.co.jp/wp-content/uploads/geojson/generated/lines_all.json',
}

def main():
    raw = ROOT / 'data/raw/dc'
    raw.mkdir(exist_ok=True)
    manifest = []
    for name, url in SOURCES.items():
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        path = raw / (name + ('.json' if name == 'grid_lines' else '.html'))
        path.write_bytes(response.content)
        manifest.append(dict(id=name, url=url, path=path.relative_to(ROOT).as_posix(),
                             retrieved_at=datetime.now(timezone.utc).isoformat(),
                             sha256=hashlib.sha256(response.content).hexdigest()))
    (ROOT / 'data/dc_sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    rows = [
        ('central1', '石狩市新港中央1丁目', '優先調査', '分譲図の黄色区画がある地区。区画面積・地番・予約状況は未取得。', '工業・物流地区内でまとまった用地を探す。札幌北部の雪を主対象。', '津波・洪水・内水、海岸からの退避経路を区画ごとに確認。'),
        ('zenibako4', '小樽市銭函4丁目', '優先比較', '分譲図の黄色区画がある地区。将来分譲・未換地を同一条件で扱わない。', '新川通経由で手稲・新川側の雪を受ける案。行政境界を越える排雪協定が必要。', '沿岸・新川周辺の津波と洪水を確認。札幌市のハザード図だけでは不足。'),
        ('south2', '石狩市新港南2丁目', '条件付き比較', '分譲図の黄色区画がある地区。敷地境界の確定前。', '住宅側の境界を避け、工業地区内部と幹線道路への出入口を優先。', '洪水・内水、花川側住宅への騒音と搬入経路を確認。'),
        ('shinkawa', '札幌市新川・発寒の工業地区', '用地探索', 'まとまった現行売地は今回未確認。既存工業用地の更新・共同利用を探索。', '西区・北区からの運搬を短縮できる可能性。既存融雪場そのものを空地と扱わない。', '新川水系の洪水・内水、既存住宅と工場の距離を確認。'),
        ('yonesato', '札幌市東米里・米里の物流地区', '用地探索', '物流施設や東部融雪施設の存在は空地の根拠にならない。現行売地未確認。', '白石・厚別の雪を対象に、石狩へ運ぶ場合との比較候補。', '豊平川等の洪水・内水と道路冠水を確認。'),
    ]
    candidates = [dict(id=i, name=n, verdict=v, land=l, rationale=r, hazard=h,
                       source_url=SOURCES['land'] if k < 3 else 'https://www.city.sapporo.jp/kensetsu/yochikanri/nyuusatsu.html',
                       buildable_confirmed=False, grid_connection_confirmed=False,
                       network_routes_confirmed=False, parcel_flood_depth_m=None)
                  for k, (i,n,v,l,r,h) in enumerate(rows)]
    locate(candidates)
    cases = []
    for mw in [5,20,50]:
        c = melt_capacity(it_mw=mw, utilization=.9, recovery=.8, snow_c=-5, density=400, outlet_c=2)
        # Explicit design assumptions, not measured site operating data.
        flow = c['useful_heat_mw'] * 1000 / (4.186 * 10)  # kg/s, loop delta T 10 K
        pump_kw = (flow / 1000) * 200000 / .7 / 1000  # 200 kPa total, 70% efficiency
        c.update(it_mw=mw, receiving_mw_at_pue_1_2=mw*1.2,
                 loop_flow_m3_h=flow*3.6, pump_kw=pump_kw,
                 pump_mwh_day=pump_kw*24/1000,
                 loads_day_at_8t=c['tonnes_day']/8,
                 unload_bays_at_16h_8min_70pct=__import__('math').ceil(c['tonnes_day']/8/(16*60/8*.7)),
                 incremental_diesel_l_day_at_extra_5km_one_way=c['tonnes_day']/8*10/2)
        cases.append(c)
    output = dict(as_of='2026-09-08', candidates=candidates, scenarios=cases,
                  ix=dict(existing='JPNAP札幌：NTT東日本 北海道第2データセンター。100G/10G/1G掲載、400Gは要照会。',
                          poc='SapporoIX PoC協定は2023年。商用サービスのSLA・参加AS・帯域保証とは別。',
                          proposal='異経路の2回線と既存IX接続を基本とし、需要に応じ既存IXの現地POPを誘致。'),
                  assumptions='稼働率90%、IT熱回収80%、雪-5℃・400kg/m³、排水2℃、24時間。補機・搬入は仮定。熱交換器実性能・雪到着量・排水許可で制限される。')
    (ROOT/'data/processed/dc_feasibility.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    with (ROOT/'data/processed/dc_candidates.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=candidates[0].keys()); writer.writeheader(); writer.writerows(candidates)
    print('Saved',len(candidates),'conditional candidates and',len(cases),'thermal scenarios')

if __name__ == '__main__':
    main()
