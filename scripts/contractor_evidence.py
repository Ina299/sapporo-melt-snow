"""Keep published ownership, office evidence and hypothetical deployment distinct."""
EVIDENCE = {
    'toyo': dict(published_scope='会社の保有機械一覧から関連4機種を抜粋',
        location_evidence='発寒事業所の住所を確認。本社は中央区北6条西22丁目2番7号。発寒への機械配備内訳は記載なし。',
        scenario_fleet={'グレーダ':3,'ショベルローダ':7},
        excluded_fleet={'大型ロータリ':2,'4tダンプ':2}),
    'kashima': dict(published_scope='会社の保有機械・車輌一覧から関連5機種を抜粋',
        location_evidence='資材センター・モータープールの住所を確認。本社は南区川沿10条2丁目7-10。モータープールの名称は確認できるが機械別配備は記載なし。',
        scenario_fleet={'グレーダー':3,'タイヤショベル2.0–2.8m3':10},
        excluded_fleet={'大型ロータリー':1,'小型ショベル':3,'4tダンプ':9}),
    'satsuichi': dict(published_scope='土木事業部ページの保有車両一覧（全社総数ではない）',
        location_evidence='本社住所と土木事業部の連絡先を確認。別に札幌営業所（川下581番地1：運輸・重機事業部）、札幌流通センター支店（流通センター5丁目2-33）がある。土木車両の駐車場所・配備内訳は記載なし。',
        scenario_fleet={'タイヤショベル':4},excluded_fleet={'10tダンプ':23}),
    'krs': dict(published_scope='会社の保有車両・機械一覧から関連7機種を抜粋',
        location_evidence='工事事務所の住所を確認。本社は中央区南1条西1丁目13番1号。工事事務所への除雪車配備は記載なし。',
        scenario_fleet={'タイヤショベル2m3':1,'タイヤショベル1.5m3':2},
        excluded_fleet={'11tダンプ':4,'4tダンプ':4,'2tダンプ':1,'タイヤショベル0.8m3':2,'タイヤショベル0.5m3以下':2}),
}

def annotate(c):
    c.update(EVIDENCE[c['id']])
    c.update(evidence_checked_on='2026-09-08', depot_fleet=None,
        dispatch_depot_verified=False, entrance_verified=False,
        coordinate_precision='住所検索の地番代表点。枝番・敷地・出入口は未照合',
        scenario_fleet_count=sum(c['scenario_fleet'].values()),
        scenario_status='選択機種を公開所在地の代表点に集中配備する仮定。実配備・除雪適性・稼働数の確認ではない',
        fleet_scope=c['published_scope']+'。拠点別配備・基準日・当日の稼働数は未確認')
    return c
