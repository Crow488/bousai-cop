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
