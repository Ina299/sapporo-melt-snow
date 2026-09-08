# SAPPORO SNOW LAB

札幌の除雪経路と、データセンター排熱を使う融雪候補地を検討する実データ付きプロトタイプです。

**[画面を開く](web/index.html)** · **[設計・調査結果](docs/design.md)** · **[データ辞書](docs/data_dictionary.md)**

公開版：**https://ina299.github.io/sapporo-melt-snow/** （GitHub Pages。`main` へのpushで `.github/workflows/pages.yml` が自動配信。文書は `python scripts/build_docs_html.py` でHTML化したものを同梱）

**更新：[堆雪・排雪・融雪の日別収支](docs/snow_management.md)**。13観測点の実降雪を使い、道路脇に残す雪、一時堆雪、堆積場への搬出、DC融雪を分けました。車両・受入・貯留・熱・排水の制約で残雪を翌日に繰り越し、3方式を画面で比較・JSON保存できます。道路面積・堆雪余地・運搬距離等は変更できる仮定です。`npm run build:snow` / `npm run test:snow` で再生成・検証します。

**更新：[南西・南東へのDC融雪拠点の分散案](docs/regional_melting.md)**。DC4・DC5の既存融雪機能との連携に加え、真駒内・石山方面と大谷地・北野方面の用地探索を比較。市の配置案と地図の収録範囲を区別し、同じ総IT容量で運搬と設備費を評価します。個別区画と実運搬効果は未確定です。[事業者所在地・台数の照合](docs/contractor_audit.md)では公表台数と拠点配備を分けています。

**更新：[新設DC候補地・IX・受電と融雪の検証](docs/dc_feasibility.md)**。DC建設を前提に、候補を札幌市内に限定し、一等地を避けた6地区（手稲山口・前田、真駒内・石山、大谷地流通業務団地・北野、新川・発寒北、東米里・米里、宮の沢・発寒木工団地南端）に参考地区として山鼻・南22条橋方面を加え、5/20/50MWの規模比較を掲載しています。全候補について最寄りの187kV・66kV変電所、送電線の公開区分、H-IXまでの距離、最寄り工業団地を同じ表で比較できます（`python scripts/build_grid_ix.py`）。札幌市の施策として検討するため、石狩・小樽の候補は対象外にしました。いずれも地区単位の探索段階で、個別敷地の取得・受電・排水・通信経路は未確定です。

## 起動

取得済みデータと計算結果を同梱しています。[web/index.html](web/index.html) をブラウザで直接開けます。背景地図のみネット接続が必要です。背景地図なしでも道路・候補地・操作は動きます。

ローカルサーバーを使う場合：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

http://127.0.0.1:8000/web/ を開いてください。

## できていること

- **[区域と直行経路の改善](docs/direct_routing.md)**：道路距離でまとまった会社の区域を作り、作業時間が均等になるよう地理的に二分割を繰り返して車両ごとに連続した担当区域に分け、各区域の担当区間を郵便配達人問題として解き直して一筆書きの経路にし、最後に帰庫。**2026年9月9日更新**：作業対象を札幌市内の区間に限定し、各車両の経路を8時間シフト（シフトごとに帰庫・再出庫）に分けました。市内302,349方向区間のうち300,081区間を割当、2,268区間は未割当、市外128,767区間は対象外。全社方式の最長車両は67.47時間・9シフト、会社担当固定は217.54時間・28シフト。回送はシフトごとの往復が加わり4,923km（前版2,111km）。両方式とも台数は標準台数で固定です。車両を選んでシフトの色をクリックすると、そのシフトの出庫から帰庫までだけを表示します。**再計算待ち**：市内でも朝里ダム周辺などの未舗装の山道（OSM `surface` が未舗装、または `tracktype` 付き、175路線）が作業対象に入り、手稲の車両が山中へ長距離回送する経路が生じていたため、これらを対象外にするコード変更を入れました。数値・画面データは Actions の再生成（`city+dispatch`）で更新されます。現行データは `python scripts/improve_dispatch.py` で再生成します。

- 事業者の番号表示、融雪施設の非表示、市境の表示、地図クリックによるフォーカス解除に対応。「会社担当を固定」と「全30台へ直接割当」を画面で比較できます。現行画面から八軒の旧パネル・旧道路データの読込みを除去しました。

- **[広域の共同配車](docs/wide_dispatch.md)**：市内302,349方向区間のうち300,081区間を4社・各車両へ重複なく割当。2,268区間は未到達として明示（前版は市外込み431,116区間・421,029割当）。初期画面は全社の台数で区域を調整した方式の会社別担当範囲で、事業者マーカーから車両別の広域経路へ切替。所在地の近さだけで区域を作る会社担当固定方式は比較用として選択できます。現行モデルの標準30台では全社方式で最長車両67.5時間・9シフト、会社担当固定で217.5時間・28シフト（前版は89.3時間・297時間、帰庫制約付きの旧モデルでは約156時間）となり、いずれも1回の出動で終わる実配車ではありません。

- **[広域道路・事業者別経路](docs/expanded_roads.md)**：431,116方向区間へ拡張し、430,517区間の閉路を検証。599区間は未計算として表示。公表4社から八軒実証への1〜公表機種別上限台数の往復経路を30シナリオ追加。マーカーホバー・台数選択・車両別表示に対応。

- 札幌市除雪事業協会の所在地209件を取得。4社は会社公表の保有機械数を整理し、所在地代表点を地図表示。
- 2026年度23地区の市貸与機械計画・最低必要台数を転記し、列合計と照合。
- 八軒周辺のOSM実道路で、有向郵便配達人問題と1/2/4/8台の経路分担を実行。
- 7つの融雪候補エリア、排熱融雪の熱収支計算、2025年度の13観測点の降雪・積雪を表示。
- 原本・URL・取得日時・ハッシュを保存。CSV、GeoJSON、順序付き経路JSONを出力。

## 計算の範囲

主画面は札幌市境（OSM行政界）の内側302,349方向区間を対象とする広域配車です（近郊込みで抽出した431,116区間のうち市外128,767区間は対象外。回送は市外道路も通行可）。300,081区間を公開4社へ重複なく割り当て、各社の車両別経路を8時間シフトに分けて生成しました。2,268区間は各社の出発点から往復到達を確認できず未割当です。市公式除雪対象路線との照合は未実施で、市の実配車システムではありません。

両方向道路は各方向1回の作業を仮定。広域配車の出発点は公開所在地に最も近い道路ノードです。実入口・当日の稼働台数は未確認。複数台分担に大域最適性の保証はありません。右左折禁止、車幅、交差点作業、実降雪量からの作業時間推定は未実装です。八軒の小規模実証は再現用ファイルとして残し、主画面から外しています。

既存施設7エリアに加え、新設DCの調査地区5件を表示します。地区選定と建設可能区画の確定は別です。新設案の証拠・未確認条件は追加検証書に記載しています。

## データの再計算

Python 3.10以上を使用。

```powershell
python -m pip install -r requirements.txt
python scripts/build_inventory.py
python scripts/geocode.py
python scripts/process_weather.py
python scripts/build_dc.py
python scripts/run_analysis.py
python -m unittest discover -s tests -v
```

広域配車・市域道路・市境・雪収支は別スクリプトで生成します。手順の詳細は各文書を参照してください。

```powershell
python scripts/expand_roads.py        # 広域道路の抽出（docs/expanded_roads.md）
python scripts/run_city.py            # 市域閉路の計算
python scripts/build_boundary.py      # 市境の取得（docs/wide_dispatch.md）
python scripts/run_dispatch.py        # 会社担当固定の広域配車
python scripts/run_dispatch.py --joint
python scripts/improve_dispatch.py    # 区域別配車の現行データ（docs/direct_routing.md）。末尾で画面用データも再生成
python scripts/build_web_geometry.py  # 画面用データだけを再生成（共有座標表＋頂点番号列）
python scripts/build_snow_management.py  # 日別雪収支（docs/snow_management.md）
python scripts/build_grid_ix.py           # 変電所・送電線・IX・工業団地の一律評価（docs/dc_feasibility.md）
```

`main` への push で `.github/workflows/test.yml` が Actions 上で単体試験と Playwright を実行します。

重い再生成（`improve_dispatch.py`、`run_city.py`、雪収支）はローカルで実行するとメモリ不足になることがあるため、GitHub Actions で実行できます。Actions タブの **Regenerate dispatch data** → Run workflow で対象を選ぶと、ランナー上で計算し、テスト後に結果を `main` へコミットして Pages を再配信します（`.github/workflows/regenerate.yml`）。ログにピークメモリと所要時間が出ます。

`build_inventory.py` は手動で検証した2026年9月8日時点の転記データを生成します。再実行すると座標が初期化されるため、続けて `geocode.py` を実行してください。住所検索はキャッシュを再利用します。

公開サイトの再取得：`python scripts/fetch_sources.py`、道路の再取得：`python scripts/fetch_roads.py`。PDFは同じURLで内容が更新されるため、原本更新後には**転記内容と年度を再確認**してください。降雪原本の更新方法は設計書参照。公共APIの取得失敗時に架空道路へ置き換える処理はありません。

画面のテストには Node.js と Microsoft Edge が必要です。

```powershell
npm ci
npm test
```

## ファイル

| 場所 | 内容 |
|---|---|
| `web/` | 日本語の地図・比較画面。Leafletを同梱 |
| `src/routing.py` | 道路抽出・最小費用流・Euler閉路・車両分担・被覆検証 |
| `src/thermal.py` | 単位と入力値を検証した熱収支 |
| `scripts/` | 取得・転記データ生成・住所検索・降雪集計・計算 |
| `data/raw/` | 取得原本・PDFの確認用画像・OSM・住所検索キャッシュ |
| `data/processed/analysis.json` | 各車両の走行順序と全区間被覆の検証結果 |
| `data/processed/routes.geojson` | 車両ごとの順序付き経路形状 |
| `data/sources.json` | 公開資料の出典・取得日時・SHA-256 |
| `data/roads_source.json` | OSM取得範囲・ライセンス・出典 |

道路データは © OpenStreetMap contributors / ODbL 1.0。市資料・企業サイトの原本はそれぞれの権利者に帰属します。各資料の公開と二次利用条件は同一ではありません。Leafletのライセンスは [web/vendor/LICENSE](web/vendor/LICENSE)。
