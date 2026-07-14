# Sources

取得日時: 2026-07-14T09:40:30+09:00

## data/shelters.geojson

- 元データ名称: 指定緊急避難場所・指定避難所データ（市町村別CSV）
- 提供元: 国土地理院、内閣府、消防庁（市町村が登録した公開同意済みデータ）
- 取得URL:
  - https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/42202_2.csv （佐世保市 指定緊急避難場所）
  - https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/42202_1.csv （佐世保市 指定避難所）
  - https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/42391_2.csv （佐々町 指定緊急避難場所）
  - https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/42391_1.csv （佐々町 指定避難所）
- 参照ページ:
  - https://www.gsi.go.jp/bousaichiri/hinanbasho.html
  - https://hinanmap.gsi.go.jp/index.html
- 利用規約/注意事項の要点:
  - 国土地理院コンテンツ利用規約（公共データ利用規約 PDL1.0）に従い、出典記載が必要。
  - 編集・加工して利用する場合は、加工した旨を国土地理院の出典とは別に記載する。
  - 本データは最新でない場合や未掲載の場合があるため、最新かつ詳細な状況は当該市町村に確認する必要がある。
  - 第三者提供時は、指定緊急避難場所と指定避難所の違い、災害種別ごとの指定、更新されるデータであること等の注意事項が伝わるよう留意する。
- 加工内容: 2自治体のCSVを読み込み、WGS84 Point GeoJSONに変換。指定緊急避難場所は災害種別フラグを hazards 配列へ変換。指定避難所は kind を「指定避難所」、hazards を空配列として統合。

## data/boundaries.geojson

- 元データ名称: japan-topography 市区町村GeoJSON（簡素化1%） N03-21_42_210101.json
- 提供元: SmartNews Media Research Institute / smartnews-smri。原典は国土交通省 国土数値情報（行政区域 N03）。
- 取得URL: https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_42_210101.json
- 参照ページ: https://github.com/smartnews-smri/japan-topography
- 利用規約/注意事項の要点:
  - SmartNews/SMRI の加工者クレジットは不要、商用・非商用とも無償利用可。
  - 市区町村データは国土交通省・国土数値情報由来のため、国土交通省の指示するクレジット記載が必要。
  - README上で当該データは国土数値情報（行政区域）を2021-09-28に取得して加工したものとされている。
- 加工内容: 長崎県ファイルから 42202（佐世保市）と 42391（佐々町）だけを抽出し、properties を name のみに整理。元データは簡素化1%版で、出力ファイルは1MB以下。

## リアルタイムAPI（コードから直接取得。リポジトリにデータは含まない）

以下はブラウザから実行時に取得するもので、静的ファイルとして同梱していない。

### 気象庁（防災情報XML/JSON・タイル）
- 警報・注意報: `https://www.jma.go.jp/bosai/warning/data/warning/{予報区}.json`
- 天気予報: `https://www.jma.go.jp/bosai/forecast/data/forecast/{予報区}.json`
- アメダス: `https://www.jma.go.jp/bosai/amedas/data/map/{時刻}.json`
- 地震: `https://www.jma.go.jp/bosai/quake/data/list.json`
- 危険度分布（キキクル）タイル: `https://www.jma.go.jp/bosai/jmatile/data/risk/...`
- 雨雲ナウキャストタイル: `https://www.jma.go.jp/bosai/jmatile/data/nowc/...`
- 利用条件: 気象庁の情報は出典明記のうえ利用可（政府標準利用規約準拠）。画面フッターと「このサイトについて」に出典を表示している。
- 負荷への配慮: 更新間隔は5〜30分に制限し、ブラウザのタブが非表示の間はリクエストを送らない実装としている。

### ハザードマップポータルサイト（国土交通省）
- 津波浸水想定: `https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png`
- 洪水浸水想定（想定最大規模）: `.../01_flood_l2_shinsuishin_data/...`
- 高潮浸水想定: `.../03_hightide_l2_shinsuishin_data/...`
- 土砂災害警戒区域（土石流・急傾斜地・地滑り）: `.../05_dosekiryukeikaikuiki/`, `.../05_kyukeishakeikaikuiki/`, `.../05_jisuberikeikaikuiki/`
- 出典: ハザードマップポータルサイト（国土交通省）。各想定区域図の作成主体は長崎県・国土交通省等。
- 注意: 本アプリはタイル画像の色を凡例と照合して簡易判定しており、**公式サイトの判定そのものではない**。正式には重ねるハザードマップ（https://disaportal.gsi.go.jp/）で確認すること。

### 国土地理院
- 地理院タイル（淡色地図）: `https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png`
- 標高API: `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php`
- 利用条件: 地理院タイル利用規約に従い、出典を明記して利用。
