# データ辞書

共通：座標はWGS84、緯度経度は十進度、未確認値は `null`。`0` は資料で0と判定できる値だけに使います。数値は取得日時時点に公開されていた内容で、当日稼働数ではありません。

| ファイル | 主な項目 | 解釈 |
|---|---|---|
| contractor_directory | name, address, ward_category, source_url | 協会の掲載209件。分類区と実際の所在地は一致しない場合がある。会社・営業所単位であり重複排除した法人全数ではない |
| contractors | fleet, fleet_scope, address, location_type | 4社の公表保有数。会社合計と拠点配備を区別。小型ショベル等は除雪適合性未確認 |
| contractors | available_now, fleet_as_of | 当日稼働台数、保有台数の基準日。どちらも未確認 |
| contractors / candidates | latitude, longitude, geocoded_title | 国土地理院住所検索の単一候補。地番や丁目代表点を含む。出入口・建物中心・候補区画とは限らない |
| district_fleet | city_loan | 2026年度市貸与車配置の予定台数。9機種。括弧内の増減や部分集合は加算しない |
| district_fleet | minimum_including_city_loan | 最低必要台数の予定。市貸与を含む。資料4の値をさらに加算しない |
| candidates | existing_capacity_m3_day | 公表融雪能力。搬入雪体積のm³/日。排水量・槽容量とは異なる。新川・厚別等は昼夜分を合計 |
| candidates | incremental_capacity_m3_day | DC排熱による現地実増分。全候補で未確認 |
| candidates | investigation_tier | 1:最初の設備接続調査、2:比較候補、3:都心小規模連携。設計者の判断であり数値最適化結果ではない |
| weather_daily | value_cm, kind, date, station | 公表日次の降雪量/積雪深。Xはnull。参考値期間はsummaryの注記を参照 |
| weather_summary | snowfall_sum_cm | 取得期間の有効日量の合計。欠測があれば真の累計ではない |
| roads.geojson | task_id, way_id, included | OSM way内の隣接ノード間・方向ごとのタスク。道路名ごとや交差点間リンク数とは異なる |
| analysis | scenarios[].routes[].steps | u,vの順で連続した走行。service=trueのみ担当作業。falseは回送。original_keyは元の有向辺 |
| analysis | audit | 対象道路数、未計算数、道路種別除外数、境界除外数、未反映制約 |
| routes.geojson | scenario, vehicle, depot | 台数別の仮定シナリオ。同一シナリオ内の車両ごとに順序付きLineString |
| excluded_arcs | task_id, u,v | 強連結性のため計算しなかった有向辺。消去せず保存 |

`analysis.json` のサービス速度8km/h、回送速度20km/h、時間単価12,000円/台h、6時間上限、車両1/2/4/8台はすべて仮定です。時間単価には実際の見積根拠はありません。画面の速度・単価変更は固定経路に対する感度計算で、経路分担の再最適化ではありません。

`data.js` は画面用の計算結果のコピーです。更新するには `scripts/run_analysis.py` を実行します。ルートの全ステップは容量削減のため画面用コピーから外し、`analysis.json` に保持しています。
