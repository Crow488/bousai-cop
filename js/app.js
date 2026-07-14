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

// ---------- 時計 / DTG（日時群: 陸自・米軍式の日付時刻表記） ----------
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function tickClock() {
  const d = new Date();
  // JSTのタイムゾーン符字は "I"
  $("#dtg").textContent =
    `${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}I ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  $("#jst").textContent =
    `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} JST`;
}

// ============================================================
// 地図
// ============================================================
const map = L.map("map", { zoomControl: true }).setView(CONFIG.center, CONFIG.zoom);

L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a> | 危険度分布・雨雲: <a href="https://www.jma.go.jp/" target="_blank">気象庁</a>',
  maxZoom: 18,
}).addTo(map);

// 動的オーバーレイ（basetimeは後で注入するのでプレースホルダで作る）
const overlayRain = L.tileLayer("", { opacity: 0.55, maxNativeZoom: 10, maxZoom: 18 });
const overlayFlood = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });
const overlayLand = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });
const overlayInund = L.tileLayer("", { opacity: 0.7, maxNativeZoom: 10, maxZoom: 18 });

const shelterEmergency = L.layerGroup(); // 指定緊急避難場所
const shelterDesignated = L.layerGroup(); // 指定避難所
const quakeLayer = L.layerGroup().addTo(map);

L.control.layers(null, {
  "雨雲（ナウキャスト）": overlayRain,
  "洪水キキクル": overlayFlood,
  "土砂キキクル": overlayLand,
  "浸水キキクル": overlayInund,
  "指定緊急避難場所": shelterEmergency,
  "指定避難所": shelterDesignated,
  "地震震央": quakeLayer,
}, { collapsed: false, position: "topright" }).addTo(map);
shelterEmergency.addTo(map);

// キキクル凡例（気象庁公式配色）
const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML =
    '<b>危険度分布（キキクル）</b><br>' +
    '<span class="sw" style="background:#0c000c"></span>災害切迫<br>' +
    '<span class="sw" style="background:#aa00aa"></span>危険<br>' +
    '<span class="sw" style="background:#ff2800"></span>警戒<br>' +
    '<span class="sw" style="background:#f2e700"></span>注意<br>' +
    '<span class="sw" style="background:#f2f2ff;border:1px solid #666"></span>今後の情報に留意';
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
async function loadStaticGeo() {
  try {
    const b = await getJSON("data/boundaries.geojson");
    L.geoJSON(b, {
      style: { color: "#c3c2b7", weight: 1.5, dashArray: "4 3", fill: false },
    }).addTo(map);
  } catch (e) { console.error("boundaries load failed", e); }

  try {
    const s = await getJSON("data/shelters.geojson");
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
        `<b>${p.name}</b><br>${p.kind}｜${p.muni}<br>${p.address}` +
        (p.hazards && p.hazards.length
          ? `<div class="popup-hazards">${p.hazards.map((h) => `<span>${h}</span>`).join("")}</div>`
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
      rows.push(`<div class="warn-row"><span class="muni">${muni.name}</span><span class="warn-chips">${chips}</span></div>`);
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
// アメダス実況
// ============================================================
async function updateAmedas() {
  try {
    const latest = (await (await fetch(`${JMA}/amedas/data/latest_time.txt`, { cache: "no-store" })).text()).trim();
    const d = new Date(latest);
    const ts = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}00`;
    const all = await getJSON(`${JMA}/amedas/data/map/${ts}.json`);
    const tiles = CONFIG.amedas.map((st) => {
      const o = all[st.id];
      if (!o) return `<div class="obs-tile"><div class="name">${st.name}</div><div>欠測</div></div>`;
      const v = (key) => (o[key] && o[key][1] === 0 ? o[key][0] : null);
      const temp = v("temp");
      const r1 = v("precipitation1h");
      const r24 = v("precipitation24h");
      const wind = v("wind");
      const wd = v("windDirection");
      const hum = v("humidity");
      return `<div class="obs-tile">
        <div class="name">${st.name}</div>
        <div class="temp">${temp === null ? "--" : temp.toFixed(1)}<span class="unit">℃</span></div>
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
        <div class="wx">${wxIcon(area.weatherCodes[i])} ${area.weathers[i].replace(/　/g, " ")}</div>
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
          <div>${d.getDate()}日${two(d.getHours())}時</div>
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
        <span class="int ${intClass(q.maxi)}">${q.maxi}</span>
        <span>
          <div>${q.anm} M${q.mag}${near ? " ●近傍" : ""}</div>
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
      }).bindPopup(`<b>${q.anm}</b><br>M${q.mag} 最大震度${q.maxi}<br>${q.at.slice(0, 16).replace("T", " ")}`)
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
// 状況判断（警報 + 近傍地震の統合 → 総合レベル）
// ============================================================
const LEVEL_DEFS = [
  { label: "平常", icon: "✓", cls: "lv0" },
  { label: "注意", icon: "△", cls: "lv1" },
  { label: "警戒", icon: "▲", cls: "lv2" },
  { label: "危険", icon: "■", cls: "lv3" },
];
function renderJudge() {
  if (state.warnings === null && state.quakes === null) return;
  let level = 0;
  const reasons = [];

  if (state.warnings) {
    for (const [muni, list] of Object.entries(state.warnings)) {
      for (const w of list) {
        level = Math.max(level, w.level);
        reasons.push({ tag: "気象", text: `${muni}に${w.name}` });
      }
    }
  }
  if (state.quakes) {
    for (const q of state.quakes) {
      const r = INT_RANK[q.maxi] || 0;
      const ql = r >= 5 ? 3 : r >= 4 ? 2 : 1;
      level = Math.max(level, ql);
      reasons.push({ tag: "地震", text: `24時間以内に近傍で地震（${q.anm} M${q.mag} 最大震度${q.maxi}・約${Math.round(q.dist)}km）` });
    }
  }

  const def = LEVEL_DEFS[level];
  const el = $("#cop-level");
  el.className = def.cls;
  el.textContent = `${def.icon} ${def.label}`;

  $("#judge-reasons").innerHTML = reasons.length
    ? reasons.map((r) => `<li><span class="tag">${r.tag}</span><span>${r.text}</span></li>`).join("")
    : '<li><span class="tag">総合</span><span>特段の警戒事項なし（警報・注意報の発表なし、近傍24時間以内の地震なし）</span></li>';

  const hasErr = state.fetchErrors["warn"] || state.fetchErrors["quake"];
  $("#dot-judge").className = `dot ${hasErr ? "stale" : "ok"}`;
  const d = new Date();
  $("#upd-judge").textContent = `判定 ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ============================================================
// 避難所リスト
// ============================================================
let allShelters = [];
function renderShelterList() {
  const q = $("#shelter-q").value.trim();
  const hz = $("#shelter-hazard").value;
  const hits = allShelters.filter((f) => {
    const p = f.properties;
    if (q && !(p.name.includes(q) || (p.address || "").includes(q))) return false;
    if (hz === "_shelter") return p.kind === "指定避難所";
    if (hz) return p.kind === "指定緊急避難場所" && (p.hazards || []).some((h) => h.includes(hz));
    return true;
  });
  $("#shelter-count").textContent = `${hits.length}件 / 全${allShelters.length}件`;
  $("#shelter-list").innerHTML = hits.slice(0, 80).map((f, i) => {
    const p = f.properties;
    const kd = p.kind === "指定緊急避難場所" ? '<span class="kd em">緊急</span>' : '<span class="kd sh">避難所</span>';
    return `<div class="shelter-row" data-i="${allShelters.indexOf(f)}">
      <div class="nm">${kd}${p.name}</div>
      <div class="ad">${p.address || ""}</div>
    </div>`;
  }).join("") + (hits.length > 80 ? `<div class="shelter-count">…他${hits.length - 80}件（検索で絞り込んでください）</div>` : "");
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

setInterval(refreshTiles, CONFIG.refresh.tiles);
setInterval(updateWarnings, CONFIG.refresh.warning);
setInterval(updateAmedas, CONFIG.refresh.amedas);
setInterval(updateForecast, CONFIG.refresh.forecast);
setInterval(updateQuakes, CONFIG.refresh.quake);
