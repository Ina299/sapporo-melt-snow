# SAPPORO SNOW LAB

札幌の除雪経路と、データセンター排熱を使う融雪候補地を検討する実データ付きプロトタイプです。

**[画面を開く](web/index.html)** · **[設計・調査結果](docs/design.md)** · **[データ辞書](docs/data_dictionary.md)**

## 起動

取得済みデータと計算結果を同梱しています。[web/index.html](web/index.html) をブラウザで直接開けます。背景地図のみネット接続が必要です。背景地図なしでも道路・候補地・操作は動きます。

ローカルサーバーを使う場合：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

http://127.0.0.1:8000/web/ を開いてください。

## できていること

- 札幌市除雪事業協会の所在地209件を取得。4社は会社公表の保有機械数を整理し、所在地代表点を地図表示。
- 2026年度23地区の市貸与機械計画・最低必要台数を転記し、列合計と照合。
- 八軒周辺のOSM実道路で、有向郵便配達人問題と1/2/4/8台の経路分担を実行。
- 7つの融雪候補エリア、排熱融雪の熱収支計算、2025年度の13観測点の降雪・積雪を表示。
- 原本・URL・取得日時・ハッシュを保存。CSV、GeoJSON、順序付き経路JSONを出力。

## 計算の範囲

市全域の実配車システムは未完成です。取得した矩形内の車道1,343方向区間のうち、最大強連結成分1,236区間を計算し、107区間を接続分離として明示しています。対象種別以外・境界をまたぐ道路は別途除外しています。

両方向道路は各方向1回の作業を仮定。仮設待機点・仮の車両数・作業速度を用い、実業者の車庫・稼働台数とはまだ接続していません。複数台分担に大域最適性の保証はありません。右左折禁止、車幅、交差点作業、実降雪量からの作業時間推定は未実装です。

立地候補は既存施設と周辺エリアです。用地、受電・通信、浸水、排水余力は未確認で、建設可能区画を特定したものではありません。

## データの再計算

Python 3.10以上を使用。

```powershell
python -m pip install -r requirements.txt
python scripts/build_inventory.py
python scripts/geocode.py
python scripts/process_weather.py
python scripts/run_analysis.py
python -m unittest discover -s tests -v
```

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
