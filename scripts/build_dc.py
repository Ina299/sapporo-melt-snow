"""Evidence snapshots and a Sapporo-only conditional DC shortlist; no parcel certification."""
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
    'city_land_sale': 'https://www.city.sapporo.jp/kensetsu/yochikanri/nyuusatsu.html',
    'snow_sites_plan': 'https://www.city.sapporo.jp/kensetsu/yuki/jigyosha/documents/3-taisekijoitiran.pdf',
    'oyachi_vision': 'https://www.city.sapporo.jp/keizai/ooyachi/koudokavision.html',
    'jpnap_pop': 'https://www.jpnap.net/ix/pop',
    'jpnap_options': 'https://www.jpnap.net/ix/option',
    'sapporoix_poc': 'https://www.city.ishikari.hokkaido.jp/shisei/shiseiunei/1001911/1003728.html',
    'dc_precedent': 'https://www.tokyu-dc.com/dc_ishikari.html',
    'grid_lines': 'https://hello.hepco.co.jp/wp-content/uploads/geojson/generated/lines_all.json',
}
EXT = {'grid_lines': '.json', 'snow_sites_plan': '.pdf'}

def main():
    raw = ROOT / 'data/raw/dc'
    raw.mkdir(exist_ok=True)
    manifest = []
    for name, url in SOURCES.items():
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        path = raw / (name + EXT.get(name, '.html'))
        path.write_bytes(response.content)
        manifest.append(dict(id=name, url=url, path=path.relative_to(ROOT).as_posix(),
                             retrieved_at=datetime.now(timezone.utc).isoformat(),
                             sha256=hashlib.sha256(response.content).hexdigest()))
    (ROOT / 'data/dc_sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    # Sapporo city only. Districts are search hypotheses, not confirmed parcels.
    rows = [
        ('teine', '札幌市手稲区手稲山口・前田方面', '用地探索',
         '手稲北部の工業・未利用地区でまとまった用地を探す。現行売地・地番は未確認。',
         '手稲・新川側の雪を市内で受ける案。市の2026年度配置案では手稲北地区の雪堆積場が石狩新港西地区にあり、市外搬出を市内処理へ置き換える比較候補。',
         '新川下流・沿岸低地の洪水・内水・津波、軟弱地盤、住宅地からの搬入経路を確認。',
         SOURCES['snow_sites_plan']),
        ('makomanai_ishiyama', '札幌市南区真駒内・石山方面', '用地探索',
         '住宅地が多く、幹線道路に接する既利用地・公共用地の転用を探す。現行売地は未確認。',
         '南区・中央区南側の雪を対象。配置案では南区の雪処理施設欄が空欄で、石山大橋・五輪大橋・藻南橋周辺の河川敷雪堆積場に依存している。',
         '豊平川の洪水、斜面・土砂災害、橋の横断と冬季渋滞、住宅への騒音を確認。',
         SOURCES['snow_sites_plan']),
        ('oyachi_kitano', '札幌市大谷地流通業務団地・北野方面', '用地探索',
         '流通業務団地の高度化・更新に合わせた共同利用を探す。更新方針は売地・DC用途許可の証拠ではない。',
         '清田・豊平東側・厚別南側の雪を対象。配置案では清田区の雪処理施設欄が空欄。DC5（東米里）との運搬時間比較が必要。',
         '厚別川・月寒川の洪水・内水、現物流機能との交錯、北野側住宅への搬入影響を確認。',
         SOURCES['oyachi_vision']),
        ('shinkawa', '札幌市新川・発寒の工業地区', '用地探索',
         'まとまった現行売地は今回未確認。市有地売払は新川西の宅地小区画のみでDC規模ではない。既存工業用地の更新・共同利用を探索。',
         '西区・北区からの運搬を短縮できる可能性。既存融雪場そのものを空地と扱わない。',
         '新川水系の洪水・内水、既存住宅と工場の距離を確認。',
         SOURCES['city_land_sale']),
        ('yonesato', '札幌市東米里・米里の物流地区', '用地探索',
         '物流施設や東部融雪施設の存在は空地の根拠にならない。現行売地未確認。',
         '白石・厚別の雪を対象。東部融雪槽・東米里雪堆積場との接続を比較。',
         '豊平川等の洪水・内水と道路冠水を確認。',
         SOURCES['city_land_sale']),
        ('maruyama', '札幌市中央区 円山・宮の森方面（参考）', '参考・用地未発見',
         'OSMの土地利用では半径3.5km内にまとまった工業・遊休地がなく、大きな区画は競技場・公園・駐車場・市電車両センター（約1ha）・藻岩浄水場・中央卸売市場・札幌競馬場。いずれも売地ではない。',
         '中央区西部の雪を近距離で処理する仮説。変電所・IXの近さと用地の無さを同じ表で比較するために残す。',
         '住宅密集地への搬入、円山公園・北海道神宮周辺の景観・交通、藻岩山側の斜面を確認。',
         'https://www.openstreetmap.org/copyright'),
    ]
    candidates = [dict(id=i, name=n, verdict=v, land=l, rationale=r, hazard=h, source_url=u,
                       municipality='札幌市',
                       buildable_confirmed=False, grid_connection_confirmed=False,
                       network_routes_confirmed=False, parcel_flood_depth_m=None)
                  for (i,n,v,l,r,h,u) in rows]
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
