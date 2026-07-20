/* ============================================================
   防災COP — メインアプリケーション
   気象庁API（CORS開放済み）をブラウザから直接取得し、
   地図（Leaflet + 地理院タイル）と各パネルに統合表示する。
   ============================================================ */
"use strict";

const JMA = "https://www.jma.go.jp/bosai";

// ---------- 警報・注意報コード → 名称/レベル ----------
const WARN_CODES = {
  "02": ["暴風雪警報", 2], "03": ["大雨警報", 2], "04": ["洪水警報", 2],
  "05": ["暴風警報", 2], "06": ["大雪警報", 2], "07": ["波浪警報", 2],
  "08": ["高潮警報", 2],
  "10": ["大雨注意報", 1], "12": ["大雪注意報", 1], "13": ["風雪注意報", 1],
  "14": ["雷注意報", 1], "15": ["強風注意報", 1], "16": ["波浪注意報", 1],
  "17": ["融雪注意報", 1], "18": ["洪水注意報", 1], "19": ["高潮注意報", 1],
  "20": ["濃霧注意報", 1], "21": ["乾燥注意報", 1], "22": ["なだれ注意報", 1],
  "23": ["低温注意報", 1], "24": ["霜注意報", 1], "25": ["着氷注意報", 1],
  "26": ["着雪注意報", 1],
  "32": ["暴風雪特別警報", 3], "33": ["大雨特別警報", 3], "35": ["暴風特別警報", 3],
  "36": ["大雪特別警報", 3], "37": ["波浪特別警報", 3], "38": ["高潮特別警報", 3],
};
const LEVEL_CLASS = { 1: "advisory", 2: "warning", 3: "emergency" };

const WIND_DIR = ["静穏", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
  "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西", "北"];

// アプリ全体の状態（状況判断パネルはここを見て統合する）
const state = {
  warnings: null,   // {muniName: [{name, level}]}
  quakes: null,     // 近傍地震 [{...}]
  fetchErrors: {},  // panel -> bool
};

const $ = (s) => document.querySelector(s);

/**
 * HTMLエスケープ。外部から取得した文字列（気象庁APIの地震名・天気文、
 * 避難所名など）をinnerHTMLへ埋め込む前に必ず通す。
 * データ源は政府の公式APIだが、「信頼できる情報源だから」を理由に
 * サニタイズを省かない（多層防御）。
 */
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function two(n) { return String(n).padStart(2, "0"); }

function setFresh(panel, ok) {
  const dot = $(`#dot-${panel}`);
  const upd = $(`#upd-${panel}`);
  if (dot) dot.className = `dot ${ok ? "ok" : "err"}`;
  if (upd) {
    const d = new Date();
    upd.textContent = ok ? `更新 ${two(d.getHours())}:${two(d.getMinutes())}` : "取得失敗";
  }
  state.fetchErrors[panel] = !ok;
}

// ---------- 時計 ----------
function tickClock() {
  const d = new Date();
  $("#dtg").textContent =
    `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  $("#jst").textContent = "日本時間";
}

// ============================================================
// 地図
// ============================================================
const map = L.map("map", { zoomControl: true }).setView(CONFIG.center, CONFIG.zoom);

L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a> | 危険度分布・雨雲: <a href="https://www.jma.go.jp/" target="_blank" rel="noopener noreferrer">気象庁</a>',
  maxZoom: 18,
}).addTo(map);

// 動的オーバーレイ（basetimeは後で注入するのでプレースホルダで作る）
const overlayRain = L.tileLayer("", { opacity: 0.55, maxNativeZoom: 10, maxZoom: 18 });
const overlayFlood = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });
const overlayLand = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });
const overlayInund = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });

// 静的ハザードマップ（ハザードマップポータルサイト・想定最大規模）
// 空タイルは404が返る＝その場所に想定なし
const DISAPORTAL = "https://disaportaldata.gsi.go.jp/raster";
const hazardOpts = { opacity: 0.65, maxNativeZoom: 17, maxZoom: 18 };
const overlayTsunami = L.tileLayer(`${DISAPORTAL}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`, hazardOpts);
const overlayFloodMax = L.tileLayer(`${DISAPORTAL}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, hazardOpts);
const overlayHightide = L.tileLayer(`${DISAPORTAL}/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png`, hazardOpts);
const overlayDosha = L.layerGroup([
  L.tileLayer(`${DISAPORTAL}/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png`, hazardOpts),
  L.tileLayer(`${DISAPORTAL}/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png`, hazardOpts),
  L.tileLayer(`${DISAPORTAL}/05_jisuberikeikaikuiki/{z}/{x}/{y}.png`, hazardOpts),
]);

const shelterEmergency = L.layerGroup(); // 指定緊急避難場所
const shelterDesignated = L.layerGroup(); // 指定避難所
const quakeLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map); // 現在地マーカー

// 狭い画面（スマホ）では、レイヤー切替と凡例が地図を覆ってしまうため折りたたむ
const isNarrow = window.matchMedia("(max-width: 700px)").matches;

L.control.layers(null, {
  "雨雲（ナウキャスト）": overlayRain,
  "洪水キキクル": overlayFlood,
  "土砂キキクル": overlayLand,
  "浸水キキクル": overlayInund,
  "〔想定〕津波浸水": overlayTsunami,
  "〔想定〕洪水浸水": overlayFloodMax,
  "〔想定〕高潮浸水": overlayHightide,
  "〔想定〕土砂災害警戒区域": overlayDosha,
  "指定緊急避難場所": shelterEmergency,
  "指定避難所": shelterDesignated,
  "地震震央": quakeLayer,
}, { collapsed: isNarrow, position: "topright" }).addTo(map);
shelterEmergency.addTo(map);

// キキクル凡例（気象庁公式配色）
// 凡例。狭い画面では初期状態で閉じ、見出しをタップで開閉する（地図を覆わないため）
const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  if (isNarrow) div.classList.add("collapsed");
  div.innerHTML =
    '<button class="legend-toggle" type="button">凡例<span class="caret"></span></button>' +
    '<div class="legend-body">' +
    '<b>危険度分布（キキクル）</b><br>' +
    '<span class="sw" style="background:#0c000c"></span>災害切迫<br>' +
    '<span class="sw" style="background:#aa00aa"></span>危険<br>' +
    '<span class="sw" style="background:#ff2800"></span>警戒<br>' +
    '<span class="sw" style="background:#f2e700"></span>注意<br>' +
    '<span class="sw" style="background:#f2f2ff;border:1px solid #666"></span>今後の情報に留意' +
    '<hr style="border:none;border-top:1px solid #444;margin:4px 0">' +
    '<b>浸水想定の深さ</b><br>' +
    '<span class="sw" style="background:#f7f5a9"></span>0.5m未満　<span class="sw" style="background:#ffd8c0"></span>0.5〜3m<br>' +
    '<span class="sw" style="background:#ffb7b7"></span>3〜5m　<span class="sw" style="background:#ff9191"></span>5〜10m<br>' +
    '<span class="sw" style="background:#f285c9"></span>10〜20m　<span class="sw" style="background:#dc7adc"></span>20m〜' +
    '</div>';
  // 地図へのイベント伝播を止める（凡例のタップで地図が動かないように）
  L.DomEvent.disableClickPropagation(div);
  div.querySelector(".legend-toggle").addEventListener("click", () => {
    div.classList.toggle("collapsed");
  });
  return div;
};
legend.addTo(map);

// タイルの時刻（basetime）を取得してオーバーレイURLを更新する
async function refreshTiles() {
  try {
    const [risk, nowc] = await Promise.all([
      getJSON(`${JMA}/jmatile/data/risk/targetTimes.json`),
      getJSON(`${JMA}/jmatile/data/nowc/targetTimes_N1.json`),
    ]);
    const r = risk[0]; // 最新（member=immed0）
    state.riskBase = r; // 現在地のキキクル判定でも使う
    const base = `${JMA}/jmatile/data/risk/${r.basetime}/${r.member}/${r.validtime}/surf`;
    overlayFlood.setUrl(`${base}/flood/{z}/{x}/{y}.png`);
    overlayLand.setUrl(`${base}/land/{z}/{x}/{y}.png`);
    overlayInund.setUrl(`${base}/inund/{z}/{x}/{y}.png`);
    const n = nowc[0];
    overlayRain.setUrl(`${JMA}/jmatile/data/nowc/${n.basetime}/none/${n.validtime}/surf/hrpns/{z}/{x}/{y}.png`);
  } catch (e) {
    console.error("tile refresh failed", e);
  }
}

// 行政界と避難所（ローカルの静的GeoJSON。出典: data/SOURCES.md）
// 1ファイル完結版（dist/）では window.INLINE_* に埋め込まれたデータを使う
async function loadStaticGeo() {
  try {
    const b = window.INLINE_BOUNDARIES || await getJSON("data/boundaries.geojson");
    boundariesGeo = b; // 現在地の市町判定で使う
    L.geoJSON(b, {
      style: { color: "#c3c2b7", weight: 1.5, dashArray: "4 3", fill: false },
    }).addTo(map);
  } catch (e) { console.error("boundaries load failed", e); }

  try {
    const s = window.INLINE_SHELTERS || await getJSON("data/shelters.geojson");
    allShelters = s.features;
    for (const f of allShelters) {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      const isEm = p.kind === "指定緊急避難場所";
      const m = L.circleMarker([lat, lon], {
        radius: 5,
        color: "#0d0d0d",
        weight: 1,
        fillColor: isEm ? "#4cd7a4" : "#86b6ef",
        fillOpacity: 0.9,
      });
      m.bindPopup(
        `<b>${esc(p.name)}</b><br>${esc(p.kind)}｜${esc(p.muni)}<br>${esc(p.address)}` +
        (p.hazards && p.hazards.length
          ? `<div class="popup-hazards">${p.hazards.map((h) => `<span>${esc(h)}</span>`).join("")}</div>`
          : "")
      );
      f._marker = m;
      (isEm ? shelterEmergency : shelterDesignated).addLayer(m);
    }
    renderShelterList();
  } catch (e) {
    console.error("shelters load failed", e);
    $("#shelter-list").textContent = "避難所データを読み込めませんでした。";
  }
}

// ============================================================
// 警報・注意報
// ============================================================
async function updateWarnings() {
  try {
    const w = await getJSON(`${JMA}/warning/data/warning/${CONFIG.office}.json`);
    // areaTypes[1] が市町村単位
    const areas = w.areaTypes[1].areas;
    const rows = [];
    state.warnings = {};
    for (const muni of CONFIG.munis) {
      const a = areas.find((x) => x.code === muni.code);
      const active = [];
      if (a) {
        for (const item of a.warnings || []) {
          if (item.status === "発表" || item.status === "継続") {
            const def = WARN_CODES[item.code];
            if (def) active.push({ name: def[0], level: def[1] });
          }
        }
      }
      active.sort((x, y) => y.level - x.level);
      state.warnings[muni.name] = active;
      const chips = active.length
        ? active.map((x) => `<span class="chip ${LEVEL_CLASS[x.level]}">${x.name}</span>`).join("")
        : '<span class="chip none">発表なし</span>';
      rows.push(`<div class="warn-row"><span class="muni">${esc(muni.name)}</span><span class="warn-chips">${chips}</span></div>`);
    }
    $("#warn-rows").innerHTML = rows.join("");
    $("#warn-headline").textContent =
      (w.headlineText ? w.headlineText + "　" : "") +
      `（${w.publishingOffice} ${w.reportDatetime.slice(0, 16).replace("T", " ")} 発表）`;
    setFresh("warn", true);
  } catch (e) {
    console.error(e);
    setFresh("warn", false);
  }
  renderJudge();
}

// ============================================================
// アメダス実況（WBGT簡易推定つき）
// ============================================================
// WBGT区分（環境省 熱中症予防情報サイトの5段階区分）
const WBGT_CLASSES = [
  { min: 31, label: "危険", bg: "#ff2800", fg: "#ffffff" },
  { min: 28, label: "厳重警戒", bg: "#ff9900", fg: "#1a1a00" },
  { min: 25, label: "警戒", bg: "#f2e700", fg: "#1a1a00" },
  { min: 21, label: "注意", bg: "#7ecef4", fg: "#00202e" },
  { min: -Infinity, label: "ほぼ安全", bg: "#2a78d6", fg: "#ffffff" },
];
// 小野・登内(2014)の推定式（気温・湿度のみの簡易形。日射・風は未考慮）
function wbgtEstimate(t, rh) {
  return 0.735 * t + 0.0374 * rh + 0.00292 * t * rh - 4.064;
}

async function updateAmedas() {
  try {
    const latest = (await (await fetch(`${JMA}/amedas/data/latest_time.txt`, { cache: "no-store" })).text()).trim();
    const d = new Date(latest);
    const ts = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}00`;
    const all = await getJSON(`${JMA}/amedas/data/map/${ts}.json`);
    let heavyRain = false;
    let heat = null; // 最大WBGT {w, name}
    const tiles = CONFIG.amedas.map((st) => {
      const o = all[st.id];
      if (!o) return `<div class="obs-tile"><div class="name">${esc(st.name)}</div><div>欠測</div></div>`;
      const v = (key) => (o[key] && o[key][1] === 0 ? o[key][0] : null);
      const temp = v("temp");
      const r1 = v("precipitation1h");
      const r24 = v("precipitation24h");
      const wind = v("wind");
      const wd = v("windDirection");
      const hum = v("humidity");
      if (r1 >= 20 || r24 >= 100) heavyRain = true;
      // WBGT簡易推定（気温・湿度が揃う時のみ）
      let wbgtRow = "";
      if (temp !== null && hum !== null) {
        const w = wbgtEstimate(temp, hum);
        const cls = WBGT_CLASSES.find((c) => w >= c.min);
        if (!heat || w > heat.w) heat = { w, name: st.name };
        wbgtRow = `<div class="row"><span>WBGT</span><span class="v"><span class="wbgt-chip" style="background:${cls.bg};color:${cls.fg}">${w.toFixed(1)} ${cls.label}</span></span></div>`;
      }
      return `<div class="obs-tile">
        <div class="name">${esc(st.name)}</div>
        <div class="temp">${temp === null ? "--" : temp.toFixed(1)}<span class="unit">℃</span></div>
        ${wbgtRow}
        <div class="row"><span>雨1h</span><span class="v ${r1 >= 10 ? "rain-warn" : ""}">${r1 === null ? "--" : r1.toFixed(1)}mm</span></div>
        <div class="row"><span>雨24h</span><span class="v ${r24 >= 80 ? "rain-warn" : ""}">${r24 === null ? "--" : r24.toFixed(1)}mm</span></div>
        <div class="row"><span>風</span><span class="v">${wd === null ? "--" : WIND_DIR[wd] || "--"} ${wind === null ? "--" : wind.toFixed(1)}m/s</span></div>
        <div class="row"><span>湿度</span><span class="v">${hum === null ? "--" : hum}%</span></div>
      </div>`;
    });
    $("#obs-grid").innerHTML = tiles.join("");
    const t = new Date(latest);
    $("#upd-obs").textContent = `観測 ${two(t.getHours())}:${two(t.getMinutes())}`;
    $("#dot-obs").className = "dot ok";
    state.heavyRain = heavyRain;
    state.heat = heat;
    renderJudge(); // 熱中症・強雨を状況判断とパネル優先順位に反映
  } catch (e) {
    console.error(e);
    setFresh("obs", false);
  }
}

// ============================================================
// 天気予報
// ============================================================
function wxIcon(code) {
  const c = String(code)[0];
  return c === "1" ? "☀" : c === "2" ? "☁" : c === "3" ? "🌧" : c === "4" ? "🌨" : "";
}
async function updateForecast() {
  try {
    const fc = await getJSON(`${JMA}/forecast/data/forecast/${CONFIG.office}.json`);
    const short = fc[0];
    const wxSeries = short.timeSeries[0];
    const area = wxSeries.areas.find((a) => a.area.code === CONFIG.class10);
    const days = wxSeries.timeDefines.map((t, i) => {
      const d = new Date(t);
      const label = i === 0 ? "今日" : i === 1 ? "明日" : "明後日";
      return `<div class="fc-day">
        <div class="d">${label} ${d.getMonth() + 1}/${d.getDate()}（${CONFIG.class10Name}）</div>
        <div class="wx">${wxIcon(area.weatherCodes[i])} ${esc(area.weathers[i].replace(/　/g, " "))}</div>
        <div class="tt" id="fc-temp-${i}"></div>
      </div>`;
    });
    $("#fc-days").innerHTML = days.slice(0, 2).join("");

    // 気温（佐世保）
    const tempSeries = short.timeSeries[2];
    const tArea = tempSeries.areas.find((a) => a.area.code === CONFIG.tempStation);
    if (tArea) {
      // timeDefines 4個 = [今日朝, 今日日中, 明日朝, 明日日中] 相当
      const labels = tempSeries.timeDefines.map((t) => new Date(t));
      const byDay = {};
      labels.forEach((d, i) => {
        const k = d.getDate();
        byDay[k] = byDay[k] || [];
        byDay[k].push(Number(tArea.temps[i]));
      });
      const dayKeys = Object.keys(byDay);
      dayKeys.slice(0, 2).forEach((k, di) => {
        const vals = byDay[k];
        const el = $(`#fc-temp-${di}`);
        if (el) el.innerHTML = `佐世保 <span class="min">${Math.min(...vals)}</span> / <span class="max">${Math.max(...vals)}</span> ℃`;
      });
    }

    // 降水確率
    const popSeries = short.timeSeries[1];
    const pArea = popSeries.areas.find((a) => a.area.code === CONFIG.class10);
    if (pArea) {
      $("#fc-pops").innerHTML = popSeries.timeDefines.map((t, i) => {
        const d = new Date(t);
        const v = Number(pArea.pops[i]);
        return `<div class="pop">
          <div class="bar-wrap"><div class="bar" style="height:${Math.max(2, v * 0.36)}px"></div></div>
          <div class="val">${v}%</div>
          <div>${d.getDate()}日${d.getHours()}-${d.getHours() + 6}時</div>
        </div>`;
      }).join("");
    }
    setFresh("fc", true);
  } catch (e) {
    console.error(e);
    setFresh("fc", false);
  }
}

// ============================================================
// 地震
// ============================================================
const INT_RANK = { "1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9 };
function intClass(maxi) {
  const r = INT_RANK[maxi] || 0;
  if (r >= 7) return "i6";
  if (r >= 5) return "i5";
  if (r === 4) return "i4";
  if (r === 3) return "i3";
  return "";
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function parseCod(cod) {
  // 例: "+33.2+129.7-10000/" → [lat, lon, depth_m]
  const m = /^([+-][\d.]+)([+-][\d.]+)(?:([+-]\d+))?/.exec(cod || "");
  return m ? [parseFloat(m[1]), parseFloat(m[2]), m[3] ? parseInt(m[3], 10) : null] : null;
}
async function updateQuakes() {
  try {
    const list = await getJSON(`${JMA}/quake/data/list.json`);
    const quakes = list.filter((q) => q.anm && q.maxi).slice(0, 30);
    const now = Date.now();
    state.quakes = [];
    quakeLayer.clearLayers();
    const rows = [];
    for (const q of quakes.slice(0, 6)) {
      const at = new Date(q.at);
      const pos = parseCod(q.cod);
      let near = false;
      if (pos) {
        const dist = haversineKm(CONFIG.center[0], CONFIG.center[1], pos[0], pos[1]);
        near = dist <= CONFIG.quakeRadiusKm;
        if (near && now - at.getTime() < 24 * 3600 * 1000) {
          state.quakes.push({ ...q, dist });
        }
      }
      rows.push(`<div class="quake-row ${near ? "near" : ""}">
        <span class="int ${intClass(q.maxi)}">${esc(q.maxi)}</span>
        <span>
          <div>${esc(q.anm)} M${esc(q.mag)}${near ? " ●近傍" : ""}</div>
          <div class="meta">${at.getMonth() + 1}/${at.getDate()} ${two(at.getHours())}:${two(at.getMinutes())}</div>
        </span>
      </div>`);
    }
    // 震央プロット（直近10件）
    for (const q of quakes.slice(0, 10)) {
      const pos = parseCod(q.cod);
      if (!pos) continue;
      L.circleMarker([pos[0], pos[1]], {
        radius: Math.max(4, (parseFloat(q.mag) || 3) * 1.8),
        color: "#d95926",
        weight: 1.5,
        fill: true,
        fillColor: "#d95926",
        fillOpacity: 0.25,
      }).bindPopup(`<b>${esc(q.anm)}</b><br>M${esc(q.mag)} 最大震度${esc(q.maxi)}<br>${esc(q.at.slice(0, 16).replace("T", " "))}`)
        .addTo(quakeLayer);
    }
    $("#quake-rows").innerHTML = rows.join("") || "直近の地震情報はありません。";
    setFresh("quake", true);
  } catch (e) {
    console.error(e);
    setFresh("quake", false);
  }
  renderJudge();
}

// ============================================================
// パネル優先順位の自動組み替え（NERV式）
// 状況が動いたパネルを上へ。スコア40以上は「優先」チップ表示。
// ============================================================

// 詳細パネル（気象実況・天気予報・地震）の開閉。
// 既定は閉じておき、「今すぐ見るべき情報」だけを常時表示する（ニールセン⑧対応）。
function setPanelExpanded(el, expanded) {
  el.classList.toggle("expanded", expanded);
  const btn = el.querySelector(".panel-toggle");
  if (!btn) return;
  btn.setAttribute("aria-expanded", String(expanded));
  btn.textContent = expanded ? "詳細を閉じる ▴" : "詳細を表示 ▾";
}
document.querySelectorAll(".panel-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const el = btn.closest(".panel");
    setPanelExpanded(el, !el.classList.contains("expanded"));
  });
});

const PANEL_IDS = ["judge", "loc", "warn", "obs", "fc", "quake", "shelter"];
function reorderPanels() {
  const scores = { judge: 1000, loc: 0, warn: 0, obs: 0, fc: 0, quake: 0, shelter: 0 };
  // 警報・注意報
  let maxW = 0;
  if (state.warnings) {
    for (const list of Object.values(state.warnings)) for (const w of list) maxW = Math.max(maxW, w.level);
  }
  scores.warn = maxW === 3 ? 100 : maxW === 2 ? 80 : maxW === 1 ? 40 : 0;
  // 近傍地震（24時間以内）
  if (state.quakes && state.quakes.length) {
    const r = Math.max(...state.quakes.map((q) => INT_RANK[q.maxi] || 0));
    scores.quake = r >= 5 ? 90 : r >= 4 ? 70 : 50;
  }
  // 現在地のリアルタイム危険度（キキクルの警戒レベル相当）
  const kl = state.locKiki ? state.locKiki.lv : 0;
  scores.loc = kl >= 5 ? 98 : kl >= 4 ? 95 : kl >= 3 ? 75 : kl >= 2 ? 30 : 0;
  // アメダスの強雨
  if (state.heavyRain) scores.obs = 35;

  PANEL_IDS.forEach((id, i) => {
    const el = $(`#panel-${id}`);
    if (!el) return;
    el.style.order = String((1000 - scores[id]) * 10 + i);
    const promoted = id !== "judge" && scores[id] >= 40;
    el.classList.toggle("promoted", promoted);
    const h2 = el.querySelector("h2");
    let chip = h2.querySelector(".prio-chip");
    if (promoted && !chip) {
      chip = document.createElement("span");
      chip.className = "prio-chip";
      chip.textContent = "優先";
      h2.insertBefore(chip, h2.querySelector(".upd"));
    } else if (!promoted && chip) {
      chip.remove();
    }
    // 優先扱いになった詳細パネル（例: 強雨時の気象実況）は自動で開く
    if (promoted && el.classList.contains("collapsible")) setPanelExpanded(el, true);
  });
}

// ============================================================
// 警報連動の避難所サジェスト（Yahoo式）
// 発表中の警報に対応する災害種別のワンタップフィルタを出す
// ============================================================
const WARN_TO_HAZARD = [
  [/大雨/, ["土砂災害", "内水氾濫"]],
  [/洪水/, ["洪水"]],
  [/高潮/, ["高潮"]],
];
function activeHazards() {
  const out = new Set();
  if (state.warnings) {
    for (const list of Object.values(state.warnings)) {
      for (const w of list) {
        for (const [re, hzs] of WARN_TO_HAZARD) if (re.test(w.name)) hzs.forEach((h) => out.add(h));
      }
    }
  }
  return [...out];
}
function renderShelterSuggest() {
  const el = $("#shelter-suggest");
  const hzs = activeHazards();
  el.innerHTML = hzs.length
    ? '<span class="suggest-label">⚠ 発表中の警報に対応:</span>' +
      hzs.map((h) => `<button class="suggest-chip" data-h="${h}">${h}対応を表示</button>`).join("")
    : "";
}
$("#shelter-suggest").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".suggest-chip");
  if (!btn) return;
  $("#shelter-hazard").value = btn.dataset.h;
  renderShelterList();
  $("#panel-shelter").scrollIntoView({ behavior: "smooth" });
});

// ============================================================
// 状況判断（警報 + 近傍地震 + 現在地キキクル の統合 → 総合レベル）
// レベルは国の「警戒レベル」5段階に対応させた「相当」情報（公式配色）。
// 気象庁の公式対応: 注意報=2相当 / 警報=3相当 / キキクル危険・土砂災害警戒情報=4相当 / 特別警報・災害切迫=5相当
// ============================================================
const LEVEL_DEFS = {
  1: { chip: "✓ 平常", label: "平常", action: "特段の警戒事項なし", cls: "lv1" },
  2: { chip: "Lv2相当 注意", label: "警戒レベル2相当", action: "ハザードマップ等で避難行動を確認", cls: "lv2" },
  3: { chip: "Lv3相当 高齢者等避難", label: "警戒レベル3相当", action: "危険な場所から高齢者等は避難", cls: "lv3" },
  4: { chip: "Lv4相当 全員避難", label: "警戒レベル4相当", action: "危険な場所から全員避難", cls: "lv4" },
  5: { chip: "Lv5相当 緊急安全確保", label: "警戒レベル5相当", action: "命の危険 — 直ちに安全確保", cls: "lv5" },
};
function renderJudge() {
  if (state.warnings === null && state.quakes === null) return;
  let level = 1;
  const reasons = [];

  if (state.warnings) {
    for (const [muni, list] of Object.entries(state.warnings)) {
      for (const w of list) {
        // 注意報(1)→Lv2相当、警報(2)→Lv3相当、特別警報(3)→Lv5相当
        level = Math.max(level, w.level === 3 ? 5 : w.level === 2 ? 3 : 2);
        reasons.push({ tag: "気象", text: `${muni}に${w.name}` });
      }
    }
  }
  // 現在地のキキクル（気象庁の警戒レベル相当に公式対応: 注意=2, 警戒=3, 危険=4, 災害切迫=5）
  if (state.locKiki && state.locKiki.lv >= 2) {
    level = Math.max(level, state.locKiki.lv);
    reasons.push({ tag: "現在地", text: `現在地のキキクル: ${state.locKiki.hz}が「${state.locKiki.label}」（レベル${state.locKiki.lv}相当）` });
  }
  if (state.quakes) {
    for (const q of state.quakes) {
      const r = INT_RANK[q.maxi] || 0;
      const ql = r >= 5 ? 4 : r >= 4 ? 3 : 2;
      level = Math.max(level, ql);
      reasons.push({ tag: "地震", text: `24時間以内に近傍で地震（${q.anm} M${q.mag} 最大震度${q.maxi}・約${Math.round(q.dist)}km）` });
    }
  }
  // 熱中症（WBGT簡易推定。33以上=熱中症警戒アラートの発表基準相当）
  if (state.heat && state.heat.w >= 31) {
    level = Math.max(level, state.heat.w >= 33 ? 3 : 2);
    reasons.push({
      tag: "熱中症",
      text: `${state.heat.name}のWBGT簡易推定が${state.heat.w.toFixed(1)}（${state.heat.w >= 33 ? "警戒アラート基準相当" : "危険"}）`,
    });
  }

  const def = LEVEL_DEFS[level];
  const el = $("#cop-level");
  el.className = def.cls;
  el.textContent = def.chip;

  // 大型レベルバナー（切迫感の担い手。レベル3以上は脈動）
  $("#judge-banner-slot").innerHTML = `
    <div class="judge-banner b${level}">
      <span class="num">${level === 1 ? "✓" : level}</span>
      <div>
        <div class="lbl">${def.label}</div>
        <div class="act">${def.action}</div>
      </div>
    </div>`;

  $("#judge-reasons").innerHTML = (reasons.length
    // reasons の text には外部データ（地震名など）が入るため、描画時に一括エスケープする
    ? reasons.map((r) => `<li><span class="tag">${esc(r.tag)}</span><span>${esc(r.text)}</span></li>`).join("")
    : '<li><span class="tag">総合</span><span>特段の警戒事項なし（警報・注意報の発表なし、近傍24時間以内の地震なし）</span></li>')
    + '<div class="panel-note">気象庁発表・キキクルからの自動判定（「相当」情報）。市町が発令する避難情報が最優先です。</div>';

  const hasErr = state.fetchErrors["warn"] || state.fetchErrors["quake"];
  $("#dot-judge").className = `dot ${hasErr ? "stale" : "ok"}`;
  const d = new Date();
  $("#upd-judge").textContent = `判定 ${two(d.getHours())}:${two(d.getMinutes())}`;
  reorderPanels();
  renderShelterSuggest();
}

// ============================================================
// 避難所リスト
// ============================================================
let allShelters = [];
let boundariesGeo = null;
function renderShelterList() {
  const q = $("#shelter-q").value.trim();
  const hz = $("#shelter-hazard").value;
  const hasFilter = !!(q || hz);

  // 現在地未設定・検索条件もない状態では、435件を無条件に出さない。
  // 認識より記憶をさせないため（ニールセン⑥）、次にすべき行動だけを示す。
  if (!hasFilter && !userPos) {
    $("#shelter-count").textContent = `全${allShelters.length}件`;
    $("#shelter-list").innerHTML =
      '<div class="loc-hint">現在地を取得すると近い順に表示されます（上の「📍GPSで現在地取得」）。それまでは施設名・住所で検索してください。</div>';
    return;
  }

  let hits = allShelters.filter((f) => {
    const p = f.properties;
    if (q && !(p.name.includes(q) || (p.address || "").includes(q))) return false;
    if (hz === "_shelter") return p.kind === "指定避難所";
    if (hz) return p.kind === "指定緊急避難場所" && (p.hazards || []).some((h) => h.includes(hz));
    return true;
  });

  // 現在地が分かっていれば距離順に並べ替える（分からなければ従来通りデータ順）
  let dists = null;
  if (userPos) {
    const withDist = hits.map((f) => {
      const [slon, slat] = f.geometry.coordinates;
      return { f, d: haversineKm(userPos.lat, userPos.lon, slat, slon) * 1000 };
    }).sort((a, b) => a.d - b.d);
    hits = withDist.map((x) => x.f);
    dists = withDist.map((x) => x.d);
  }

  const limit = userPos && !hasFilter ? 20 : 80;
  $("#shelter-count").textContent = `${hits.length}件 / 全${allShelters.length}件`;
  $("#shelter-list").innerHTML = hits.slice(0, limit).map((f, i) => {
    const p = f.properties;
    const kd = p.kind === "指定緊急避難場所" ? '<span class="kd em">緊急</span>' : '<span class="kd sh">避難所</span>';
    const dist = dists ? `<span class="dist">${Math.round(dists[i])}m</span>` : "";
    return `<div class="shelter-row" data-i="${allShelters.indexOf(f)}">
      <div class="nm">${kd}${esc(p.name)}${dist}</div>
      <div class="ad">${esc(p.address || "")}</div>
    </div>`;
  }).join("") + (hits.length > limit ? `<div class="shelter-count">…他${hits.length - limit}件（検索で絞り込んでください）</div>` : "");
}
$("#shelter-q").addEventListener("input", renderShelterList);
$("#shelter-hazard").addEventListener("change", renderShelterList);
$("#shelter-list").addEventListener("click", (ev) => {
  const row = ev.target.closest(".shelter-row");
  if (!row) return;
  const f = allShelters[Number(row.dataset.i)];
  if (!f) return;
  const [lon, lat] = f.geometry.coordinates;
  const isEm = f.properties.kind === "指定緊急避難場所";
  const grp = isEm ? shelterEmergency : shelterDesignated;
  if (!map.hasLayer(grp)) grp.addTo(map);
  map.setView([lat, lon], 15);
  if (f._marker) f._marker.openPopup();
});

// ============================================================
// 現在地の状況（GPS / 手動指定 → ハザード判定 + 最寄り避難所）
// ============================================================

// 浸水想定タイルの凡例色 → 深さクラス（ハザードマップポータル標準配色）
const DEPTH_CLASSES = [
  { rgb: [220, 122, 220], label: "20m以上", sev: "extreme" },
  { rgb: [242, 133, 201], label: "10〜20m", sev: "extreme" },
  { rgb: [255, 145, 145], label: "5〜10m", sev: "danger" },
  { rgb: [255, 183, 183], label: "3〜5m", sev: "danger" },
  { rgb: [255, 216, 192], label: "0.5〜3m", sev: "danger" },
  { rgb: [247, 245, 169], label: "0.5m未満", sev: "caution" },
  { rgb: [255, 255, 179], label: "0.3m未満", sev: "caution" }, // 津波・高潮の新凡例のみ
];
// キキクルの凡例色 → 危険度（lv = 国の警戒レベル相当。気象庁の公式対応に準拠）
const KIKI_CLASSES = [
  { rgb: [12, 0, 12], label: "災害切迫", sev: "extreme", lv: 5 },
  { rgb: [170, 0, 170], label: "危険", sev: "extreme", lv: 4 },
  { rgb: [255, 40, 0], label: "警戒", sev: "danger", lv: 3 },
  { rgb: [242, 231, 0], label: "注意", sev: "caution", lv: 2 },
  { rgb: [242, 242, 255], label: "今後の情報に留意", sev: "info", lv: 1 },
];

// maxDist=30: PNG圧縮による数値のブレは吸収しつつ、地図の背景色（白など）を
// 誤って「浸水想定あり」と判定しないための閾値。緩めると偽陽性が出る（テスト参照）。
// 境界のアンチエイリアス色を取りこぼしても、周辺±8pxの走査が拾うため安全側に倒せる。
function nearestClass(rgb, classes, maxDist = 30) {
  let best = null, bestD = Infinity;
  for (const c of classes) {
    const d = Math.hypot(rgb[0] - c.rgb[0], rgb[1] - c.rgb[1], rgb[2] - c.rgb[2]);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= maxDist ? best : null;
}

// タイル画像を読み、該当地点のピクセル色と周辺（±radius px）の色一覧を返す。
// 想定区域の帯は幅数px程度のことがあるため、地点だけでなく周辺も見て安全側に判定する（z16で8px ≒ 約20m）。
// 返り値の意味を厳密に分ける（防災情報として最重要な設計判断）:
//   { nodata: true }  … タイルが404 = その場所に公表データなし（区域外と表示してよい）
//   { nodata: false } … タイルあり。center/colors で色判定
//   null              … 通信失敗・タイムアウト等 = 「判定できず」（区域外と表示してはならない）
async function sampleArea(urlTemplate, lat, lon, z, radius = 0) {
  const n = 2 ** z;
  const xf = (lon + 180) / 360 * n;
  const lr = lat * Math.PI / 180;
  const yf = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  const px = Math.min(255, Math.floor((xf - x) * 256));
  const py = Math.min(255, Math.floor((yf - y) * 256));
  const url = urlTemplate.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const resp = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (resp.status === 404) return { nodata: true, center: null, colors: [] };
    if (!resp.ok) return null;
    const bmp = await createImageBitmap(await resp.blob());
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const cd = ctx.getImageData(px, py, 1, 1).data;
    const center = cd[3] === 0 ? null : [cd[0], cd[1], cd[2]];
    const colors = [];
    if (radius > 0) {
      const x0 = Math.max(0, px - radius), y0 = Math.max(0, py - radius);
      const w = Math.min(255, px + radius) - x0 + 1, h = Math.min(255, py + radius) - y0 + 1;
      const d = ctx.getImageData(x0, y0, w, h).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        if (!seen.has(k)) { seen.add(k); colors.push([d[i], d[i + 1], d[i + 2]]); }
      }
    }
    return { nodata: false, center, colors };
  } catch (e) {
    console.error("sampleArea failed:", url, e);
    return null;
  }
}

const SEV_RANK = { info: 0, caution: 1, danger: 2, extreme: 3 };
// 地点 → 周辺の順で分類。{cls, near} を返す（near=trueは「地点は外だが周辺に想定あり」）
function classifyArea(res, classes) {
  if (!res) return null;
  const c = res.center && nearestClass(res.center, classes);
  if (c) return { cls: c, near: false };
  let best = null;
  for (const rgb of res.colors || []) {
    const k = nearestClass(rgb, classes);
    if (k && (!best || SEV_RANK[k.sev] > SEV_RANK[best.sev])) best = k;
  }
  return best ? { cls: best, near: true } : null;
}

// 点が市町ポリゴンの内側か（ray casting）
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function muniAt(lat, lon) {
  if (!boundariesGeo) return null;
  for (const f of boundariesGeo.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (pointInRing(lat, lon, poly[0]) && !poly.slice(1).some((h) => pointInRing(lat, lon, h))) {
        return f.properties.name;
      }
    }
  }
  return null;
}

function fmtDist(m) { return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`; }

function hzBadge(cls, text) { return `<span class="hz-badge ${cls}">${text}</span>`; }

let userPos = null;

function setUserPos(lat, lon, accuracy, srcLabel) {
  userPos = { lat, lon };
  try { localStorage.setItem("cop_userpos", JSON.stringify({ lat, lon })); } catch (e) { /* file://等では不可 */ }
  userLayer.clearLayers();
  L.circleMarker([lat, lon], {
    radius: 8, color: "#fff", weight: 2, fillColor: "#3987e5", fillOpacity: 1,
  }).bindPopup(`<b>現在地</b>（${srcLabel}）`).addTo(userLayer);
  if (accuracy && accuracy < 3000) {
    L.circle([lat, lon], { radius: accuracy, color: "#3987e5", weight: 1, fillOpacity: 0.08 }).addTo(userLayer);
  }
  map.setView([lat, lon], Math.max(map.getZoom(), 14));
  assessLocation(lat, lon, srcLabel);
  renderShelterList();
}

async function assessLocation(lat, lon, srcLabel) {
  $("#dot-loc").className = "dot stale";
  $("#loc-body").innerHTML = '<div class="loc-hint">この場所のハザードを判定中…</div>';

  const Z = 16, NEAR = 8; // 8px @z16 ≒ 約20mの近傍も判定
  const tasks = {
    elev: getJSON(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`),
    tsunami: sampleArea(`${DISAPORTAL}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
    flood: sampleArea(`${DISAPORTAL}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
    hightide: sampleArea(`${DISAPORTAL}/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
    doseki: sampleArea(`${DISAPORTAL}/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
    kyukeisha: sampleArea(`${DISAPORTAL}/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
    jisuberi: sampleArea(`${DISAPORTAL}/05_jisuberikeikaikuiki/{z}/{x}/{y}.png`, lat, lon, Z, NEAR),
  };
  // リアルタイム危険度（キキクル）
  if (state.riskBase) {
    const r = state.riskBase;
    const base = `${JMA}/jmatile/data/risk/${r.basetime}/${r.member}/${r.validtime}/surf`;
    tasks.kFlood = sampleArea(`${base}/flood/{z}/{x}/{y}.png`, lat, lon, 10);
    tasks.kLand = sampleArea(`${base}/land/{z}/{x}/{y}.png`, lat, lon, 10);
    tasks.kInund = sampleArea(`${base}/inund/{z}/{x}/{y}.png`, lat, lon, 10);
  }

  const keys = Object.keys(tasks);
  const results = await Promise.allSettled(Object.values(tasks));
  const R = {};
  keys.forEach((k, i) => { R[k] = results[i].status === "fulfilled" ? results[i].value : null; });

  // --- 位置情報サマリー
  const muni = muniAt(lat, lon);
  let elevTxt = "不明";
  if (R.elev && typeof R.elev.elevation === "number") elevTxt = `海抜 ${R.elev.elevation.toFixed(1)}m`;
  else if (R.elev && R.elev.elevation && R.elev.elevation !== "-----") elevTxt = `海抜 ${R.elev.elevation}m`;

  // --- 静的ハザード（想定）: 地点判定＋周辺約20mの安全側判定
  // res===null（通信失敗）は「判定できず」。「区域外」は404/透明が確認できた時だけ表示する。
  const staticDefs = [
    ["津波", R.tsunami],
    ["洪水", R.flood],
    ["高潮", R.hightide],
  ].map(([name, res]) => ({ name, unknown: res === null, hit: res ? classifyArea(res, DEPTH_CLASSES) : null }));
  const staticRows = staticDefs.map(({ name, unknown, hit }) => {
    const badge = unknown ? hzBadge("unknown", "判定できず")
      : hit ? hzBadge(hit.cls.sev, `${hit.near ? "周辺≈20mに" : ""}浸水想定 ${hit.cls.label}`)
      : hzBadge("safe", "想定区域外※");
    return `<div class="hz-row"><span class="hz-name">${name}</span>${badge}</div>`;
  });
  // 土砂は区域の有無だけ見る（色は区分ごとに違うため存在判定）
  const doshaHit = (res) => res && (res.center || (res.colors || []).length > 0)
    ? { near: !res.center } : null;
  const doshaUnknown = [R.doseki, R.kyukeisha, R.jisuberi].every((r) => r === null);
  const doshaKinds = [["土石流", doshaHit(R.doseki)], ["急傾斜地", doshaHit(R.kyukeisha)], ["地滑り", doshaHit(R.jisuberi)]]
    .filter(([, h]) => h);
  const doshaAllNear = doshaKinds.length > 0 && doshaKinds.every(([, h]) => h.near);
  if (doshaKinds.length) {
    staticRows.push(`<div class="hz-row"><span class="hz-name">土砂災害</span>${
      hzBadge("danger", `${doshaAllNear ? "周辺≈20mに" : ""}警戒区域（${doshaKinds.map(([k]) => k).join("・")}）`)
    }</div>`);
  } else if (doshaUnknown) {
    staticRows.push(`<div class="hz-row"><span class="hz-name">土砂災害</span>${hzBadge("unknown", "判定できず")}</div>`);
  } else {
    staticRows.push(`<div class="hz-row"><span class="hz-name">土砂災害</span>${hzBadge("safe", "警戒区域外※")}</div>`);
  }

  // --- リアルタイム（キキクル）: こちらも取得失敗を「平常」と混同しない
  const rtDefs = [["洪水（現在）", R.kFlood], ["土砂（現在）", R.kLand], ["浸水（現在）", R.kInund]]
    .map(([name, res]) => ({
      name,
      unknown: res === null || res === undefined,
      cls: res && res.center ? nearestClass(res.center, KIKI_CLASSES) : null,
    }));
  const rtRows = rtDefs.map(({ name, unknown, cls }) => `<div class="hz-row"><span class="hz-name">${name}</span>${
    unknown ? hzBadge("unknown", "判定できず")
      : cls ? hzBadge(cls.sev, cls.label) : hzBadge("safe", "平常")
  }</div>`);
  let rtWorst = null;
  let locKiki = null;
  for (const { name, cls } of rtDefs) {
    if (!cls) continue;
    if (!rtWorst || SEV_RANK[cls.sev] > SEV_RANK[rtWorst.sev]) rtWorst = cls;
    if (cls.lv >= 2 && (!locKiki || cls.lv > locKiki.lv)) {
      locKiki = { lv: cls.lv, label: cls.label, hz: name.replace("（現在）", "") };
    }
  }
  // 状況判断・パネル優先順位に反映（警戒レベル相当）
  state.locKiki = locKiki;
  const anyUnknown = staticDefs.some((s) => s.unknown) || doshaUnknown || rtDefs.some((r) => r.unknown);

  // --- 最寄り避難所
  const sorted = allShelters
    .map((f) => {
      const [slon, slat] = f.geometry.coordinates;
      return { f, d: haversineKm(lat, lon, slat, slon) * 1000 };
    })
    .sort((a, b) => a.d - b.d);
  const nears = sorted.slice(0, 5);

  // --- 一文要約（verdict）
  const hazardParts = staticDefs
    .filter(({ hit }) => hit)
    .map(({ name, hit }) => `${name}${hit.near ? "(周辺)" : ""} ${hit.cls.label}`);
  if (doshaKinds.length) hazardParts.push(`土砂災害警戒区域${doshaAllNear ? "(周辺)" : ""}`);
  // 最重要ハザードに対応した最寄り避難所を推奨（なければ単純に最寄り）
  const sevOf = (s) => (s.hit ? SEV_RANK[s.hit.cls.sev] : -1);
  const worstStatic = [...staticDefs].sort((a, b) => sevOf(b) - sevOf(a))[0];
  const targetHazard = worstStatic && worstStatic.hit ? worstStatic.name
    : doshaKinds.length ? "土砂災害" : null;
  const recommended = (targetHazard
    && sorted.slice(0, 50).find(({ f }) => (f.properties.hazards || []).includes(targetHazard)))
    || sorted[0];
  const vClass = rtWorst && (rtWorst.sev === "danger" || rtWorst.sev === "extreme") ? "v-danger"
    : rtWorst && rtWorst.sev === "caution" ? "v-caution"
    : hazardParts.length ? "v-info" : "v-safe";
  // 「判定できず」がある時は「区域外」「平常」と断定しない（要約とバッジの矛盾防止）
  const staticUnknownAny = staticDefs.some((s) => s.unknown) || doshaUnknown;
  const rtUnknownAny = rtDefs.some((r) => r.unknown);
  const staticText = hazardParts.length
    ? `この場所は<b>${hazardParts.join("・")}</b>の想定区域。`
    : staticUnknownAny
      ? "ハザード想定を確認できませんでした。"
      : "公表ハザードマップ上、この場所は主要ハザード（津波・洪水・高潮・土砂）の想定区域外。";
  const rtText = rtWorst ? `現在の危険度は<b>${rtWorst.label}</b>。`
    : rtUnknownAny ? "現在の危険度は<b>判定できず</b>。"
    : "現在の危険度は<b>平常</b>。";
  const verdict = `
    <div class="loc-verdict ${vClass}">
      ${staticText}
      ${rtText}
      ${recommended
        ? `避難先候補: <b>${esc(recommended.f.properties.name)}</b>（${fmtDist(recommended.d)}${targetHazard ? `・${esc(targetHazard)}対応` : ""}）`
        : ""}
      ${anyUnknown ? '<br>⚠ 一部の項目を判定できませんでした。通信状況を確認し、公式情報も参照してください。' : ""}
    </div>`;
  const nearRows = nears.map(({ f, d }) => {
    const p = f.properties;
    const kd = p.kind === "指定緊急避難場所" ? '<span class="kd em">緊急</span>' : '<span class="kd sh">避難所</span>';
    return `<div class="near-row" data-i="${allShelters.indexOf(f)}">
      <span class="dist">${fmtDist(d)}</span>
      <span>${kd}<span class="nm">${esc(p.name)}</span>${p.hazards && p.hazards.length ? `<span class="ad">（${esc(p.hazards.join("・"))}）</span>` : ""}</span>
    </div>`;
  }).join("");
  // 最寄りへの線
  if (nears.length) {
    const [nlon, nlat] = nears[0].f.geometry.coordinates;
    L.polyline([[lat, lon], [nlat, nlon]], { color: "#4cd7a4", weight: 2, dashArray: "6 4" }).addTo(userLayer);
  }

  $("#loc-body").innerHTML = `
    ${verdict}
    <div class="loc-summary">
      <span class="place">📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}（${srcLabel}）
      ${muni ? `｜${muni}` : "｜対象市町の外"}</span>｜<span class="elev">${elevTxt}</span>
    </div>
    <div class="loc-sec">ハザード想定（最大規模想定・ハザードマップポータル）</div>
    ${staticRows.join("")}
    <div class="panel-note">※「区域外」は公表データ上の判定です。想定外の災害は起こりえます。正式には<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener">重ねるハザードマップ</a>で確認を。</div>
    <div class="loc-sec">現在の危険度（気象庁キキクル）</div>
    ${rtRows.join("")}
    <div class="loc-sec">最寄りの避難所（直線距離）</div>
    ${nearRows || '<div class="loc-hint">避難所データ未読込</div>'}
  `;
  $("#dot-loc").className = "dot ok";
  const d = new Date();
  $("#upd-loc").textContent = `判定 ${two(d.getHours())}:${two(d.getMinutes())}`;
  renderJudge(); // 現在地キキクルを総合レベル・パネル優先順位に反映
}

// 最寄り避難所クリック → 地図ジャンプ
$("#loc-body").addEventListener("click", (ev) => {
  const row = ev.target.closest(".near-row");
  if (!row) return;
  const f = allShelters[Number(row.dataset.i)];
  if (!f) return;
  const [lon, lat] = f.geometry.coordinates;
  const grp = f.properties.kind === "指定緊急避難場所" ? shelterEmergency : shelterDesignated;
  if (!map.hasLayer(grp)) grp.addTo(map);
  map.setView([lat, lon], 15);
  if (f._marker) f._marker.openPopup();
});

// GPS取得
$("#btn-gps").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("#loc-body").innerHTML = '<div class="loc-hint">このブラウザは位置情報に対応していません。「地図クリックで指定」を使ってください。</div>';
    return;
  }
  $("#loc-body").innerHTML = '<div class="loc-hint">GPS取得中…（ブラウザの許可ダイアログが出たら許可してください）</div>';
  navigator.geolocation.getCurrentPosition(
    (pos) => setUserPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, "GPS"),
    (err) => {
      console.error("geolocation", err);
      $("#loc-body").innerHTML = `<div class="loc-hint">GPS取得に失敗しました（${esc(err.message)}）。
        ファイルを直接開いている場合など、位置情報が使えない環境では「🖱 地図クリックで指定」を使ってください。</div>`;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
});

// 地図クリックで手動指定（1回クリックで確定）
let manualMode = false;
$("#btn-manual").addEventListener("click", () => {
  manualMode = !manualMode;
  $("#btn-manual").classList.toggle("active", manualMode);
  map.getContainer().style.cursor = manualMode ? "crosshair" : "";
  if (manualMode) {
    $("#loc-body").innerHTML = '<div class="loc-hint">地図上の任意の場所をクリックすると、その地点を現在地として判定します。</div>';
  }
});
map.on("click", (ev) => {
  if (!manualMode) return;
  manualMode = false;
  $("#btn-manual").classList.remove("active");
  map.getContainer().style.cursor = "";
  setUserPos(ev.latlng.lat, ev.latlng.lng, null, "手動指定");
});

// ============================================================
// 「このサイトについて」モーダル
// ============================================================
$("#btn-about").addEventListener("click", () => { $("#about-overlay").hidden = false; });
$("#about-close").addEventListener("click", () => { $("#about-overlay").hidden = true; });
$("#about-overlay").addEventListener("click", (ev) => {
  if (ev.target === $("#about-overlay")) $("#about-overlay").hidden = true;
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") $("#about-overlay").hidden = true;
});

// 前回位置の復元
try {
  const saved = JSON.parse(localStorage.getItem("cop_userpos") || "null");
  if (saved) {
    // 静的データ読込後に判定させるため少し遅らせる
    setTimeout(() => setUserPos(saved.lat, saved.lon, null, "前回の位置"), 1500);
  }
} catch (e) { /* noop */ }

// ============================================================
// 起動・更新ループ
// ============================================================
tickClock();
setInterval(tickClock, 1000);

refreshTiles();
loadStaticGeo();
updateWarnings();
updateAmedas();
updateForecast();
updateQuakes();

// 定期取得。タブが非表示の間は公的APIを叩かない（開きっぱなしのタブが
// 無駄なリクエストを出し続けるのを防ぐ。表示に戻った時点で即更新する）。
function poll(fn, interval) {
  setInterval(() => {
    if (!document.hidden) fn();
  }, interval);
}
poll(refreshTiles, CONFIG.refresh.tiles);
poll(updateWarnings, CONFIG.refresh.warning);
poll(updateAmedas, CONFIG.refresh.amedas);
poll(updateForecast, CONFIG.refresh.forecast);
poll(updateQuakes, CONFIG.refresh.quake);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  // 復帰時に鮮度を取り戻す
  refreshTiles();
  updateWarnings();
  updateAmedas();
  updateQuakes();
});
