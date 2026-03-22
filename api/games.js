// /api/games.js — Vercel Serverless Function
// All secrets, engine logic, and sheet access live here — never exposed to browser

const SHEET_ID = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

// ══════════ CONSTANTS ══════════
const K = { pythExp: 1.83, runsPerWar: 10, bpWar: 3.47, hfa: 1.07, minEdge: 0.05, minOuEv: 0.03, nbR: 3.15 };
const PF = {ARI:1.04,ATL:0.99,BAL:1.01,BOS:1.04,CHC:1.05,CHW:1.03,CIN:1.08,CLE:0.97,COL:1.18,DET:0.98,HOU:1.00,KC:1.05,LAA:0.97,LAD:0.97,MIA:0.93,MIL:1.01,MIN:1.01,NYM:0.95,NYY:1.06,OAK:0.96,SAC:0.96,PHI:1.03,PIT:0.94,SD:0.95,SF:0.93,SEA:0.95,STL:0.98,TB:0.90,TEX:1.00,TOR:1.02,WAS:1.00};
const ORI = {ARI:0,ATL:150,BAL:22,BOS:45,CHC:45,CHW:112,CIN:112,CLE:0,COL:0,DET:150,HOU:67,KC:45,LAA:45,LAD:22,MIA:112,MIL:135,MIN:90,NYM:22,NYY:67,OAK:45,SAC:45,PHI:22,PIT:112,SD:0,SF:112,SEA:45,STL:45,TB:45,TEX:67,TOR:338,WAS:22};
const STD = {ARI:{lat:33.45,lon:-112.07},ATL:{lat:33.89,lon:-84.47},BAL:{lat:39.28,lon:-76.62},BOS:{lat:42.35,lon:-71.10},CHC:{lat:41.95,lon:-87.66},CHW:{lat:41.83,lon:-87.63},CIN:{lat:39.10,lon:-84.51},CLE:{lat:41.50,lon:-81.69},COL:{lat:39.76,lon:-105.00},DET:{lat:42.34,lon:-83.05},HOU:{lat:29.76,lon:-95.36},KC:{lat:39.05,lon:-94.48},LAA:{lat:33.80,lon:-117.88},LAD:{lat:34.07,lon:-118.24},MIA:{lat:25.78,lon:-80.22},MIL:{lat:43.03,lon:-87.97},MIN:{lat:44.98,lon:-93.28},NYM:{lat:40.76,lon:-73.85},NYY:{lat:40.83,lon:-73.93},OAK:{lat:38.58,lon:-121.49},SAC:{lat:38.58,lon:-121.49},PHI:{lat:39.91,lon:-75.17},PIT:{lat:40.45,lon:-80.01},SD:{lat:32.71,lon:-117.16},SF:{lat:37.78,lon:-122.39},SEA:{lat:47.59,lon:-122.33},STL:{lat:38.62,lon:-90.19},TB:{lat:27.77,lon:-82.65},TEX:{lat:32.75,lon:-97.08},TOR:{lat:43.64,lon:-79.39},WAS:{lat:38.87,lon:-77.01}};
const DOME = new Set(["ARI","HOU","MIA","MIL","TB","TEX","TOR","SEA"]);
const TID = {108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WAS",121:"NYM",133:"OAK",134:"PIT",135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",143:"PHI",144:"ATL",145:"CHW",146:"MIA",147:"NYY",158:"MIL",568:"SAC"};

// ══════════ MATH ══════════
const a2i = o => !o ? null : o < 0 ? (-o) / (-o + 100) : 100 / (o + 100);
const pyth = (rs, ra, e) => { if (!rs || !ra || rs <= 0 || ra <= 0) return null; const a = Math.pow(rs, e), b = Math.pow(ra, e); return a / (a + b); };
const pt = (wA, wB) => { const n = wA * (1 - wB), d = n + wB * (1 - wA); return d === 0 ? 0.5 : n / d; };
const bld = (proj, cur, gp) => { if (proj == null) return cur; if (cur == null || gp == null || gp < 10) return proj; const w = 1 / (1 + Math.exp(-0.05 * (gp - 50))); return proj * (1 - w) + cur * w; };

// ══════════ NEGATIVE BINOMIAL ══════════
function lnGamma(z) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += c[j] / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x); }
function nbPMF(k, mu, r) { if (k < 0 || mu <= 0) return 0; const p = r / (r + mu); const lp = lnGamma(k + r) - lnGamma(k + 1) - lnGamma(r) + r * Math.log(p) + k * Math.log(1 - p); return Math.exp(lp); }
function teamPMF(mu, r, maxR = 20) { const p = []; let s = 0; for (let k = 0; k <= maxR; k++) { p[k] = nbPMF(k, mu, r); s += p[k]; } for (let k = 0; k <= maxR; k++) p[k] /= s; return p; }
function gameConvolve(pmfA, pmfB) {
  const maxR = pmfA.length - 1; const total = new Array(2 * maxR + 1).fill(0);
  let pAwin = 0, pBwin = 0, pTie = 0;
  for (let a = 0; a <= maxR; a++) for (let b = 0; b <= maxR; b++) {
    const p = pmfA[a] * pmfB[b]; total[a + b] += p;
    if (a > b) pAwin += p; else if (b > a) pBwin += p; else pTie += p;
  }
  const pOverN = n => { let s = 0; for (let t = n + 1; t < total.length; t++) s += total[t]; return s; };
  const pUnderN = n => { let s = 0; for (let t = 0; t < n; t++) s += total[t]; return s; };
  const pExactN = n => n >= 0 && n < total.length ? total[n] : 0;
  const margin = {};
  for (let a = 0; a <= maxR; a++) for (let b = 0; b <= maxR; b++) { const mg = a - b; margin[mg] = (margin[mg] || 0) + pmfA[a] * pmfB[b]; }
  let pWinBy2 = 0, pWinBy2H = 0;
  for (const [mg, p] of Object.entries(margin)) { if (parseInt(mg) >= 2) pWinBy2 += p; if (parseInt(mg) <= -2) pWinBy2H += p; }
  return { total, pOverN, pUnderN, pExactN, pAwin, pBwin, pTie, pAwayWinBy2: pWinBy2, pHomeWinBy2: pWinBy2H };
}

function evalOU(conv, line, juice, side, book) {
  const isWhole = line === Math.floor(line); let pWin, pPush = 0;
  if (side === "OVER") { pWin = conv.pOverN(isWhole ? line : line - 0.5); if (isWhole) pPush = conv.pExactN(line); }
  else { pWin = conv.pUnderN(isWhole ? line : line + 0.5); if (isWhole) pPush = conv.pExactN(line); }
  const pLose = 1 - pWin - pPush; const impl = a2i(juice);
  const r1 = juice < 0 ? (-juice) / 100 : 1, p1 = juice < 0 ? 1 : juice / 100;
  const ev = (pWin * p1 + pPush * 0 - pLose * r1) / r1;
  return { line, juice, side, book, pWin, pPush, pLose, ev, impl, edge: pWin - impl, isWhole };
}

// ══════════ WIND ══════════
function calcWind(w, home) {
  if (!w || !w.windSpeed || w.windSpeed < 8 || DOME.has(home)) return { adj: 0, dir: DOME.has(home) ? "DOME" : "CALM", label: DOME.has(home) ? "🏟️ Dome" : "Calm", speed: 0, arrow: "—" };
  const bearing = ORI[home] || 45; const wFrom = w.windDir || 0; const inB = (bearing + 180) % 360;
  const diff = ((wFrom - inB + 540) % 360) - 180; const cos = Math.cos(diff * Math.PI / 180);
  const outMph = w.windSpeed * cos; const wAdj = outMph * 0.05;
  let tAdj = 0; if (w.temp != null) tAdj = (w.temp - 72) * 0.012;
  const adj = Math.round((wAdj + tAdj) * 100) / 100;
  let dir, arrow; if (cos > 0.5) { dir = "OUT"; arrow = "↑"; } else if (cos < -0.5) { dir = "IN"; arrow = "↓"; } else { dir = "CROSS"; arrow = "→"; }
  const parts = []; if (w.temp != null) parts.push(w.temp >= 85 ? `🌡️${Math.round(w.temp)}°` : w.temp <= 55 ? `🥶${Math.round(w.temp)}°` : `${Math.round(w.temp)}°`);
  parts.push(`💨${Math.round(w.windSpeed)}mph ${arrow} ${dir}`); if (w.precipProb >= 40) parts.push(`🌧️${w.precipProb}%`);
  return { adj, dir, label: parts.join(" · "), speed: w.windSpeed, arrow };
}

// ══════════ ENGINE ══════════
function engine(g) {
  const bAW = pyth(g.pRS_a, g.pRA_a, K.pythExp), bHW = pyth(g.pRS_h, g.pRA_h, K.pythExp);
  if (!bAW || !bHW) return { error: "Missing RS/RA" };
  const aLD = (g.tLW_a != null && g.oLW_a != null) ? g.tLW_a - g.oLW_a : 0;
  const hLD = (g.tLW_h != null && g.oLW_h != null) ? g.tLW_h - g.oLW_h : 0;
  const aRS = g.pRS_a + (aLD * K.runsPerWar), hRS = g.pRS_h + (hLD * K.runsPerWar);
  const aSD = (g.spW_a != null && g.s5_a != null) ? ((g.spW_a * 5) + K.bpWar) - (g.s5_a + K.bpWar) : 0;
  const hSD = (g.spW_h != null && g.s5_h != null) ? ((g.spW_h * 5) + K.bpWar) - (g.s5_h + K.bpWar) : 0;
  const aRA = g.pRA_a - (aSD * K.runsPerWar), hRA = g.pRA_h - (hSD * K.runsPerWar);
  const aW = pyth(aRS, aRA, K.pythExp), hW = pyth(hRS, hRA, K.pythExp);
  if (!aW || !hW) return { error: "Calc error" };
  const nAP = pt(aW, hW); let hP = Math.min(.95, Math.max(.05, (1 - nAP) * K.hfa)), aP = 1 - hP;
  const aI = a2i(g.aOdds), hI = a2i(g.hOdds);
  const aE = aI != null ? aP - aI : null, hE = hI != null ? hP - hI : null;
  const best = Math.max(aE || 0, hE || 0);
  const side = best >= K.minEdge ? ((aE || 0) > (hE || 0) ? "away" : "home") : null;
  const wind = calcWind(g.weather, g.home); const pf = PF[g.home] || 1;
  const muA = (aRS / 162) * pf, muH = (hRS / 162) * pf;
  const projTotal = muA + muH + wind.adj;
  const pmfA = teamPMF(muA + wind.adj / 2, K.nbR); const pmfH = teamPMF(muH + wind.adj / 2, K.nbR);
  const conv = gameConvolve(pmfA, pmfH);
  let ouLines = []; if (g.ouData) g.ouData.forEach(ol => { ouLines.push(evalOU(conv, ol.line, ol.juice, ol.side, ol.book)); });
  ouLines.sort((a, b) => (b.ev || 0) - (a.ev || 0));
  const bestOu = ouLines[0]?.ev > K.minOuEv ? ouLines[0] : null;
  let rrl = null; if (side) {
    const isDog = (side === "away" && g.aOdds > 0) || (side === "home" && g.hOdds > 0);
    if (isDog) { const pW2 = side === "away" ? conv.pAwayWinBy2 : conv.pHomeWinBy2; const rrlO = side === "away" ? g.aRrl : g.hRrl;
      if (rrlO) { const impl = a2i(rrlO); const dec = rrlO > 0 ? 1 + rrlO / 100 : 1 + 100 / (-rrlO); const ev = pW2 * dec - 1;
        rrl = { pWin: pW2, impl, edge: pW2 - impl, ev, odds: rrlO }; } } }
  return { aP, hP, aI, hI, aE, hE, side, edge: side === "away" ? aE : side === "home" ? hE : null,
    playTeam: side === "away" ? g.away : side === "home" ? g.home : null,
    playOdds: side === "away" ? g.aOdds : side === "home" ? g.hOdds : null,
    projTotal, pf, wind, ouLines, bestOu, rrl };
}

// ══════════ DATA FETCHING ══════════
async function fSheet(range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${SHEET_KEY}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
  return (await r.json()).values || [];
}

function pTP(rows) {
  const m = {}; const s = rows[0]?.some(c => isNaN(parseFloat(c))) ? 1 : 0;
  for (let i = s; i < rows.length; i++) { const r = rows[i]; if (!r?.[0]) continue;
    const t = (r[0] + "").trim().toUpperCase(); if (t.length > 4) continue;
    m[t] = { pRS: parseFloat(r[1]) || null, pRA: parseFloat(r[2]) || null, oW: parseFloat(r[3]) || null, s5: parseFloat(r[4]) || null }; }
  return m;
}

function pPW(rows) {
  const m = {}; const s = rows[0]?.some(c => isNaN(parseFloat(c)) && (c + "").length > 3) ? 1 : 0;
  for (let i = s; i < rows.length; i++) { const r = rows[i]; if (!r?.[0]) continue;
    const n = (r[0] + "").trim();
    m[n.toUpperCase()] = { name: n, team: (r[1] || "").toString().trim().toUpperCase(), proj: parseFloat(r[2]) || 0, cur: parseFloat(r[3]) || null, gp: parseFloat(r[4]) || null }; }
  return m;
}

function luLW(lineup, bW, gp) {
  if (!lineup || lineup.length < 5) return null;
  let t = 0, f = 0;
  lineup.forEach(n => { const k = n.toUpperCase().trim();
    const p = bW[k] || Object.values(bW).find(b => k.endsWith(b.name.split(" ").pop().toUpperCase()) && b.name[0].toUpperCase() === k[0]);
    if (p) { t += bld(p.proj, p.cur, gp || p.gp); f++; } });
  return f >= 5 ? t : null;
}

function luSP(sp, pW, gp) {
  if (!sp || sp === "TBD") return null;
  const k = sp.toUpperCase().trim();
  const p = pW[k] || Object.values(pW).find(b => k.includes(b.name.split(" ").pop().toUpperCase()) && k[0] === b.name[0].toUpperCase());
  return p ? bld(p.proj, p.cur, gp || p.gp) : null;
}

async function fOdds() {
  try {
    const rows = await fSheet("Odds JSON!A2:X5000");
    if (!rows || rows.length === 0) return { odds: {}, games: [] };
    const latest = {};
    rows.forEach(r => {
      const gid = String(r[3]); const commence = String(r[4] || "");
      const uniqueKey = `${gid}_${commence}`;
      const pullDate = String(r[0]).slice(0, 10); const pullTime = String(r[1]);
      const sortKey = `${pullDate}_${pullTime}`;
      if (!latest[uniqueKey] || sortKey > latest[uniqueKey].sortKey) latest[uniqueKey] = { sortKey, row: r };
    });
    const odds = {}; const gameList = [];
    Object.values(latest).forEach(({ row: r }) => {
      let aw = String(r[5]).trim(), hm = String(r[6]).trim();
      if (aw === "OAK") aw = "SAC"; if (hm === "OAK") hm = "SAC";
      if (aw === "WSH") aw = "WAS"; if (hm === "WSH") hm = "WAS";
      if (aw === "CWS") aw = "CHW"; if (hm === "CWS") hm = "CHW";
      const commence = String(r[4] || "");
      let gameDate = ""; let time = "TBD";
      try { if (commence) { const gt = new Date(commence);
        const etMs = gt.getTime() - 4 * 60 * 60 * 1000; const et = new Date(etMs);
        gameDate = et.getUTCFullYear() + "-" + String(et.getUTCMonth() + 1).padStart(2, "0") + "-" + String(et.getUTCDate()).padStart(2, "0");
        const h = et.getUTCHours(); const m = et.getUTCMinutes(); const ampm = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12;
        time = `${h12}:${String(m).padStart(2, "0")} ${ampm}`; } } catch {}
      const k = `${aw}-${hm}-${gameDate}`;
      if (!odds[k]) odds[k] = { ml: {}, ou: [], rl: {} };
      const pn = v => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).trim()); return isNaN(n) ? null : n; };
      const aDK = pn(r[7]), hDK = pn(r[8]), aFD = pn(r[9]), hFD = pn(r[10]);
      if (aDK !== null) odds[k].ml.aDK = aDK; if (hDK !== null) odds[k].ml.hDK = hDK;
      if (aFD !== null) odds[k].ml.aFD = aFD; if (hFD !== null) odds[k].ml.hFD = hFD;
      const ouLDK = pn(r[11]), ouODK = pn(r[12]), ouUDK = pn(r[13]), ouLFD = pn(r[14]), ouOFD = pn(r[15]), ouUFD = pn(r[16]);
      if (ouLDK !== null && ouODK !== null) { odds[k].ou.push({ line: ouLDK, juice: ouODK, side: "OVER", book: "DK" }); if (ouUDK !== null) odds[k].ou.push({ line: ouLDK, juice: ouUDK, side: "UNDER", book: "DK" }); }
      if (ouLFD !== null && ouOFD !== null) { odds[k].ou.push({ line: ouLFD, juice: ouOFD, side: "OVER", book: "FD" }); if (ouUFD !== null) odds[k].ou.push({ line: ouLFD, juice: ouUFD, side: "UNDER", book: "FD" }); }
      const arlDK = pn(r[17]), hrlDK = pn(r[18]), arlFD = pn(r[19]), hrlFD = pn(r[20]);
      if (arlDK !== null) odds[k].rl.aDog = arlDK; if (hrlDK !== null) odds[k].rl.hDog = hrlDK;
      if (arlFD !== null) odds[k].rl.aFD = arlFD; if (hrlFD !== null) odds[k].rl.hFD = hrlFD;
      const hasML = odds[k].ml.aDK !== undefined || odds[k].ml.aFD !== undefined || odds[k].ml.hDK !== undefined || odds[k].ml.hFD !== undefined;
      const gameKey = `${aw}-${hm}-${gameDate}`;
      if (hasML && !gameList.find(g => g.id === gameKey))
        gameList.push({ id: gameKey, time, away: aw, home: hm, gd: commence, gameDate, aSP: "TBD", hSP: "TBD", aL: [], hL: [], aC: false, hC: false });
    });
    return { odds, games: gameList };
  } catch (e) { return { odds: {}, games: [] }; }
}

async function fMLB(oddsGames) {
  const today = new Date(); const end = new Date(); end.setDate(end.getDate() + 5);
  const d1 = today.toISOString().slice(0, 10), d2 = end.toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${d1}&endDate=${d2}&hydrate=probablePitcher,lineups`);
    if (!r.ok) return oddsGames; const data = await r.json();
    const mlbMap = {};
    (data.dates || []).forEach(dt => { (dt.games || []).forEach(g => {
      const aw = TID[g.teams?.away?.team?.id] || "???", hm = TID[g.teams?.home?.team?.id] || "???";
      const key = `${aw}-${hm}-${dt.date}`;
      const aL = g.lineups?.awayPlayers?.map(p => p.fullName) || [];
      const hL = g.lineups?.homePlayers?.map(p => p.fullName) || [];
      const sp = g.teams?.away?.probablePitcher?.fullName || "TBD";
      if (!mlbMap[key] || sp !== "TBD")
        mlbMap[key] = { aSP: sp, hSP: g.teams?.home?.probablePitcher?.fullName || "TBD",
          aL, hL, aC: aL.length >= 9, hC: hL.length >= 9,
          time: new Date(g.gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) };
    }); });
    return oddsGames.map(g => { const m = mlbMap[g.id]; if (!m) return g;
      return { ...g, aSP: m.aSP || g.aSP, hSP: m.hSP || g.hSP, aL: m.aL.length > 0 ? m.aL : g.aL, hL: m.hL.length > 0 ? m.hL : g.hL, aC: m.aC || g.aC, hC: m.hC || g.hC, time: m.time || g.time }; });
  } catch { return oddsGames; }
}

async function fWeather(team, gd) {
  const s = STD[team]; if (!s) return null;
  try {
    const d = gd?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&start_date=${d}&end_date=${d}`);
    if (!r.ok) return null; const data = await r.json(); if (!data.hourly) return null;
    const h = gd ? new Date(gd).getHours() : 19;
    const i = Math.min(h, (data.hourly.time?.length || 1) - 1);
    return { temp: data.hourly.temperature_2m?.[i], windSpeed: data.hourly.wind_speed_10m?.[i], windDir: data.hourly.wind_direction_10m?.[i], precipProb: data.hourly.precipitation_probability?.[i] };
  } catch { return null; }
}

// ══════════ ASSEMBLE ══════════
function asm(mlb, tp, bW, pW, odds, wm, gp) {
  return mlb.map(g => {
    const th = tp[g.home] || {}, ta = tp[g.away] || {};
    const o = odds[g.id] || { ml: {}, ou: [], rl: {} };
    const aO = o.ml.aDK != null && o.ml.aFD != null ? Math.max(o.ml.aDK, o.ml.aFD) : o.ml.aDK != null ? o.ml.aDK : o.ml.aFD != null ? o.ml.aFD : null;
    const hO = o.ml.hDK != null && o.ml.hFD != null ? Math.max(o.ml.hDK, o.ml.hFD) : o.ml.hDK != null ? o.ml.hDK : o.ml.hFD != null ? o.ml.hFD : null;
    return { ...g, pRS_a: ta.pRS, pRA_a: ta.pRA, pRS_h: th.pRS, pRA_h: th.pRA,
      oLW_a: ta.oW, oLW_h: th.oW, s5_a: ta.s5, s5_h: th.s5,
      tLW_a: luLW(g.aL, bW, gp), tLW_h: luLW(g.hL, bW, gp),
      spW_a: luSP(g.aSP, pW, gp), spW_h: luSP(g.hSP, pW, gp),
      aOdds: aO, hOdds: hO, dkMl: { a: o.ml.aDK, h: o.ml.hDK }, fdMl: { a: o.ml.aFD, h: o.ml.hFD },
      ouData: o.ou, aRrl: o.rl.aDog || null, hRrl: o.rl.hDog || null, weather: wm?.[g.home] || null };
  });
}

// ══════════ HANDLER ══════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  try {
    const [oddsData, tpR, bR, pR] = await Promise.all([
      fOdds().catch(() => ({ odds: {}, games: [] })),
      fSheet("Team Projections!A1:E35").catch(() => []),
      fSheet("Batter WAR!A1:E500").catch(() => []),
      fSheet("Pitcher WAR!A1:E200").catch(() => [])
    ]);
    const odds = oddsData.odds || {}; const oddsGames = oddsData.games || [];
    const mlb = await fMLB(oddsGames).catch(() => oddsGames);
    // Weather — limit to 5 concurrent to avoid rate limits
    const wm = {};
    const homeTeams = [...new Set(mlb.map(g => g.home))];
    for (let i = 0; i < homeTeams.length; i += 5) {
      const batch = homeTeams.slice(i, i + 5);
      await Promise.all(batch.map(async t => { wm[t] = await fWeather(t, mlb.find(g => g.home === t)?.gd).catch(() => null); }));
    }
    const tp = pTP(tpR); const bW = pPW(bR); const pW = pPW(pR);
    const od = new Date("2026-03-25");
    const gp = Math.max(0, Math.floor((new Date() - od) / (1000 * 60 * 60 * 24)));
    const assembled = asm(mlb, tp, bW, pW, odds, wm, gp);
    const results = assembled.map(g => engine(g));

    // Build response — only send what the frontend needs to display
    const games = assembled.map((g, i) => {
      const r = results[i] || {};
      return {
        id: g.id, time: g.time, away: g.away, home: g.home, gameDate: g.gameDate,
        aSP: g.aSP, hSP: g.hSP, aC: g.aC, hC: g.hC,
        aL: g.aL, hL: g.hL,
        dkMl: g.dkMl, fdMl: g.fdMl,
        // Engine results
        aP: r.aP, hP: r.hP, aI: r.aI, hI: r.hI, aE: r.aE, hE: r.hE,
        side: r.side, edge: r.edge, playTeam: r.playTeam, playOdds: r.playOdds,
        projTotal: r.projTotal, pf: r.pf,
        wind: r.wind,
        ouLines: r.ouLines, bestOu: r.bestOu, rrl: r.rrl,
        error: r.error
      };
    });

    res.status(200).json({ games, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
}
