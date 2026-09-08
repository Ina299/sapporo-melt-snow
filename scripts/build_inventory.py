"""Curated primary-source facts; null means unverified, never zero."""
import csv
import json
from pathlib import Path
from bs4 import BeautifulSoup
from contractor_evidence import annotate

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'data/processed'
BASE = 'https://www.city.sapporo.jp/kensetsu/yuki/jigyosha/documents/'
FAC = 'https://www.city.sapporo.jp/gesui/01yakuwari/documents/'

def save(name, rows):
    (OUT/(name+'.json')).write_text(json.dumps(rows, ensure_ascii=False, indent=2),encoding='utf-8')
    if rows:
        with (OUT/(name+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()} for r in rows)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    # Visual transcription of 2026 procurement PDF, page 1. Brackets are subsets, not extra vehicles.
    counts = [
      ('中央','中',[9,0,0,0,0,8,2,0,1],[13,12,9,3,45]),
      ('中央','西',[5,0,1,0,1,5,2,0,0],[10,14,6,2,30]),
      ('中央','南',[4,0,1,0,0,3,0,0,0],[9,10,4,2,30]),
      ('北','東',[5,2,1,2,1,11,1,0,0],[11,35,12,7,105]),
      ('北','西',[5,0,1,1,0,12,0,0,0],[10,36,12,6,90]),
      ('北','南',[10,0,1,2,1,12,1,2,2],[14,25,12,5,75]),
      ('東','東',[6,2,1,0,0,8,1,0,0],[10,23,9,3,45]),
      ('東','西',[3,0,0,1,1,14,0,0,0],[7,19,14,7,105]),
      ('東','南',[8,0,0,3,0,10,1,0,1],[11,20,11,4,80]),
      ('白石','南',[7,0,2,1,0,11,2,0,2],[13,23,13,4,60]),
      ('白石','北',[9,0,0,1,0,9,0,0,0],[11,25,9,3,45]),
      ('厚別','南',[5,1,2,1,0,8,1,0,1],[7,17,8,4,60]),
      ('厚別','北',[2,0,1,0,0,8,0,0,0],[6,20,9,4,50]),
      ('豊平','東',[2,0,0,1,0,10,0,0,0],[4,24,10,5,60]),
      ('豊平','西',[9,0,2,1,0,7,2,0,1],[12,20,7,4,60]),
      ('清田','南',[7,0,0,2,0,8,2,0,0],[8,23,8,5,60]),
      ('清田','北',[5,0,0,0,0,6,2,0,0],[7,16,6,4,60]),
      ('南','南',[7,2,1,3,0,6,2,0,0],[11,33,7,3,45]),
      ('南','北',[7,0,1,0,0,8,1,0,1],[10,30,8,4,60]),
      ('西','南',[4,1,0,0,0,9,2,0,0],[10,33,9,7,105]),
      ('西','北',[7,1,3,1,0,10,1,0,1],[12,26,10,6,90]),
      ('手稲','南',[8,1,4,0,1,6,1,1,0],[11,26,6,4,60]),
      ('手稲','北',[5,0,1,1,0,10,0,0,0],[6,24,10,4,60]),
    ]
    kinds=['grader','snow_truck','wheel_loader','rotary_large','rotary_40ps','rotary_80_130ps','spreader_4m3','spreader_2m3','spreader_sidewalk']
    minimum=['grader_family','wheel_loader_8t','rotary_80_130ps','rotary_large','dump_10t']
    assert [sum(r[2][i] for r in counts) for i in range(9)] == [139,10,23,21,5,199,24,3,10]
    assert [sum(r[3][i] for r in counts) for i in range(5)] == [223,534,209,100,1480]
    save('district_fleet',[dict(ward=w+'区',district=d+'地区',fiscal_year=2026,status='予定・参考／稼働実績ではない',
         city_loan=dict(zip(kinds,c)),minimum_including_city_loan=dict(zip(minimum,m)),
         contractor_owned=None,available_now=None,source_url=BASE+'4_taiyosyadaisu.pdf',minimum_source_url=BASE+'5_saiteidaisu.pdf',source_page=1)
         for w,d,c,m in counts])
    soup=BeautifulSoup((ROOT/'data/raw/members.html').read_text(encoding='utf-8'), 'html.parser')
    members=[]
    wards=['中央','北','東','白石','厚別','豊平','清田','南','西','手稲']
    for ward,table in zip(wards,soup.select('table')):
        for tr in table.select('tr')[1:]:
            cells=tr.select('td')
            if len(cells)<3: continue
            name,postal,address=[c.get_text(' ',strip=True) for c in cells[:3]]
            if not name: continue
            # Category can differ from office city; preserve listed address independently.
            full=address if '市' in address else '札幌市'+ward+'区'+address
            link=cells[0].find('a',href=True)
            members.append(dict(id='member_'+str(len(members)+1),name=name,ward_category=ward+'区',postal_code=postal,
                address=full,website=link['href'] if link else None,fleet=None,depot_address=None,latitude=None,longitude=None,
                status='協会掲載所在地。保有機械・出動拠点未確認',source_url='https://sapporo-josetsu.jp/member.html'))
    save('contractor_directory',members)
    contractors=[
      dict(id='toyo',name='東洋ロードメンテナンス株式会社',address='札幌市西区発寒13条14丁目1080番地29',location_type='発寒事業所',fleet={'グレーダ':3,'大型ロータリ':2,'ショベルローダ':7,'4tダンプ':2},source_url='https://toyoroad.co.jp/about/',address_source_url='https://toyoroad.co.jp/about/'),
      dict(id='kashima',name='鹿島舗道工業株式会社',address='札幌市南区中の沢1775-5',location_type='資材センター・モータープール',fleet={'グレーダー':3,'大型ロータリー':1,'タイヤショベル2.0–2.8m3':10,'小型ショベル':3,'4tダンプ':9},source_url='https://kashimahodou.jp/',address_source_url='https://kashimahodou.jp/'),
      dict(id='satsuichi',name='株式会社サツイチ',address='札幌市北区新川7条16丁目708番地3',location_type='本社・土木事業部',fleet={'10tダンプ':23,'タイヤショベル':4},source_url='https://www.satsuichi.co.jp/engineering/',address_source_url='https://www.satsuichi.co.jp/about/'),
      dict(id='krs',name='KRS株式会社',address='札幌市白石区川下577番地87号',location_type='工事事務所',fleet={'11tダンプ':4,'4tダンプ':4,'2tダンプ':1,'タイヤショベル2m3':1,'タイヤショベル1.5m3':2,'タイヤショベル0.8m3':2,'タイヤショベル0.5m3以下':2},source_url='https://www.krs-sapporo.co.jp/business/',address_source_url='https://www.krs-sapporo.co.jp/business/'),
    ]
    for c in contractors:
        c.update(latitude=None,longitude=None,available_now=None,fleet_as_of=None,fleet_scope='会社公表保有数。所在地への配備内訳、除雪装備、当日稼働台数は未確認',location_status='公開住所／出入口未確認')
    save('contractors',[annotate(c) for c in contractors])
    sites=[
      ('shinkawa','新川融雪槽・周辺','札幌市西区八軒9条西7丁目1番65号',14000,'既存',1,'既存槽への排熱追加を優先調査。市街地からの運搬と増強履歴を検証できる。','住宅近接・既存施設との施工干渉・追加受入余力',FAC+'r7yuusetusou.pdf',2),
      ('atsubetsu','厚別融雪槽・周辺','札幌市厚別区厚別町山本1073-21',10000,'既存',1,'既存の搬入・融雪機能と隣接雪堆積場を組み合わせる実証候補。','融雪槽と水再生プラザの住所は異なる。接続距離・土地権利・浸水',FAC+'r7yuusetusou.pdf',1),
      ('tobu','東部水再生プラザ・東部融雪槽周辺','札幌市白石区東米里2172番地1',None,'2026年度供用計画／稼働未確認',1,'2026年度整備計画との同時検討候補。新設設備との熱交換接続を調査。','最新の竣工・受入能力・東米里の敷地別浸水深・系統接続', 'https://www.city.sapporo.jp/gesui/keieiplan/documents/honsyo_all.pdf',49),
      ('hassamu','発寒融雪槽・周辺','札幌市西区発寒14条14丁目1081',2200,'既存／2026配置一覧には掲載なし',2,'焼却余熱を使う施設。排熱源の代替・補完価値を調査。','既存熱との重複・現行稼働・更新計画・土地権利',FAC+'r7yuusetusou.pdf',3),
      ('sosei','創成川融雪管・投雪施設周辺','札幌市東区北28条東1丁目',8400,'既存',2,'北部市街地の既存投雪拠点。配管延長を抑えられる隣接地の有無を調査。','水再生プラザ本体と投雪口は別地点。地下管・用地・熱輸送距離',FAC+'r7yuusetukann.pdf',1),
      ('fushiko','伏古川融雪管・投雪施設周辺','札幌市東区東苗穂2条2丁目',8000,'既存',2,'東部市街地の既存投雪施設への補助熱源を検討。','水再生プラザ本体と投雪口は別地点。流量制約・用地・搬入待ち',FAC+'r7yuusetukann.pdf',2),
      ('station','都心北融雪槽・札幌駅北口周辺','札幌市北区北7条西3丁目',None,'既存',3,'既存の雪冷熱・地域熱供給との連携を検討する小規模候補。','駅再開発・地下埋設物・高密度市街地・夏季雪冷熱との季節調整','https://www.city.sapporo.jp/kankyo/energy/shokai/snowiceenergy.html',None),
    ]
    save('candidates',[dict(id=i,name=n,address=a,existing_capacity_m3_day=q,facility_status=s,investigation_tier=t,
        rationale=r,site_specific_checks=c,source_url=u,source_page=p,latitude=None,longitude=None,
        location_status='住所代表点用。候補エリアであり建設区画・搬入口ではない',
        land_available=None,grid_available_mw=None,fiber_redundancy=None,flood_depth_m=None,
        incremental_capacity_m3_day=None,decision='条件付き調査候補／立地適合性は未判定')
        for i,n,a,q,s,t,r,c,u,p in sites])
    print('directory',len(members),'contractors',len(contractors),'districts',len(counts),'candidates',len(sites))

if __name__=='__main__': main()
