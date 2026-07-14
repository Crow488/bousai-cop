/**
 * 防災COP — 判定ロジックのテスト
 *
 * 実行: node --test test/
 *
 * app.js はブラウザ用の1ファイル構成（DOM/Leaflet前提）なので、
 * テスト対象の純関数だけをソースから抽出して評価する。
 * こうすることで「本番と同じコード」を検証しつつ、DOMのモックが不要になる。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../js/app.js"), "utf-8");

/** app.js から関数・定数の定義を切り出して評価する（純関数のみ対象） */
function extract(names) {
  const parts = names.map((name) => {
    const re = new RegExp(`^(?:const ${name} = \\[[\\s\\S]*?^\\];|function ${name}\\([\\s\\S]*?^\\})`, "m");
    const m = SRC.match(re);
    if (!m) throw new Error(`app.js から ${name} を抽出できない（リファクタで名前が変わった可能性）`);
    return m[0];
  });
  return new Function(`${parts.join("\n")}\nreturn {${names.join(",")}};`)();
}

const { wbgtEstimate, WBGT_CLASSES, nearestClass, DEPTH_CLASSES, KIKI_CLASSES, parseCod, haversineKm } =
  extract(["wbgtEstimate", "WBGT_CLASSES", "nearestClass", "DEPTH_CLASSES", "KIKI_CLASSES", "parseCod", "haversineKm"]);

/** WBGT値 → 環境省の区分ラベル（本番の表示ロジックと同じ選び方） */
const wbgtLabel = (w) => WBGT_CLASSES.find((c) => w >= c.min).label;

describe("WBGT（暑さ指数）の簡易推定", () => {
  test("小野・登内(2014)式の係数が正しい", () => {
    // 30℃/70% → 0.735*30 + 0.0374*70 + 0.00292*30*70 - 4.064 = 26.736
    assert.equal(wbgtEstimate(30, 70).toFixed(2), "26.74");
  });

  test("同じ気温でも湿度が高いほどWBGTは上がる（熱中症リスクの本質）", () => {
    assert.ok(wbgtEstimate(30, 90) > wbgtEstimate(30, 50));
  });

  test("環境省の5区分の境界値が正しく分類される", () => {
    assert.equal(wbgtLabel(31.0), "危険");       // 31以上
    assert.equal(wbgtLabel(30.9), "厳重警戒");   // 28以上31未満
    assert.equal(wbgtLabel(28.0), "厳重警戒");
    assert.equal(wbgtLabel(27.9), "警戒");       // 25以上28未満
    assert.equal(wbgtLabel(25.0), "警戒");
    assert.equal(wbgtLabel(24.9), "注意");       // 21以上25未満
    assert.equal(wbgtLabel(21.0), "注意");
    assert.equal(wbgtLabel(20.9), "ほぼ安全");   // 21未満
  });

  test("【既知の限界】日射を考慮しないため炎天下では過小評価になる", () => {
    // 気温35℃・湿度60%（猛暑日）でも、この簡易式では30.0 = 「厳重警戒」止まり。
    // 実際に炎天下で観測すればWBGTは31を超え「危険」になりうる。
    // → UI上で「日射・風は未考慮」と明示し、公式値へのリンクを併記する根拠。
    assert.equal(wbgtEstimate(35, 60).toFixed(1), "30.0");
    assert.equal(wbgtLabel(wbgtEstimate(35, 60)), "厳重警戒");
  });
});

describe("ハザードタイルの色照合", () => {
  test("浸水想定の凡例色が正しい深さ区分に一致する", () => {
    assert.equal(nearestClass([255, 216, 192], DEPTH_CLASSES).label, "0.5〜3m");
    assert.equal(nearestClass([220, 122, 220], DEPTH_CLASSES).label, "20m以上");
  });

  test("PNG圧縮等でわずかにズレた色も同じ区分に吸収される", () => {
    assert.equal(nearestClass([253, 214, 190], DEPTH_CLASSES).label, "0.5〜3m");
  });

  test("無関係な色（地図の背景など）は誤って区分に割り当てない", () => {
    // 防災上の要諦: 判定できない色を「浸水想定あり」と誤認しないこと
    assert.equal(nearestClass([0, 128, 0], DEPTH_CLASSES), null);   // 緑
    assert.equal(nearestClass([255, 255, 255], DEPTH_CLASSES), null); // 白
  });

  test("キキクルの色が国の警戒レベル相当に対応している（気象庁の公式対応）", () => {
    assert.equal(nearestClass([170, 0, 170], KIKI_CLASSES).lv, 4);   // 危険 → レベル4相当
    assert.equal(nearestClass([255, 40, 0], KIKI_CLASSES).lv, 3);    // 警戒 → レベル3相当
    assert.equal(nearestClass([12, 0, 12], KIKI_CLASSES).lv, 5);     // 災害切迫 → レベル5相当
  });
});

describe("地震情報のパース", () => {
  test("気象庁のcod形式から緯度・経度・深さを取り出す", () => {
    assert.deepEqual(parseCod("+33.2+129.7-10000/"), [33.2, 129.7, -10000]);
  });

  test("南半球・西経（負の座標）も扱える", () => {
    const [lat, lon] = parseCod("-33.2-129.7-10000/");
    assert.equal(lat, -33.2);
    assert.equal(lon, -129.7);
  });

  test("不正な形式ではnullを返す（例外で画面を落とさない）", () => {
    assert.equal(parseCod(""), null);
    assert.equal(parseCod(undefined), null);
  });
});

describe("距離計算（最寄り避難所の順位付けに使用）", () => {
  test("佐々町役場〜佐々町公民館は約100m", () => {
    const d = haversineKm(33.237965, 129.65094, 33.238418, 129.651906) * 1000;
    assert.ok(d > 50 && d < 150, `期待: 50〜150m, 実際: ${d.toFixed(0)}m`);
  });

  test("同一地点の距離は0", () => {
    assert.equal(haversineKm(33.2, 129.7, 33.2, 129.7), 0);
  });
});
