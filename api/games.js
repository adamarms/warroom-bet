// /api/games.js — Vercel Serverless Function
// All secrets, engine logic, and sheet access live here — never exposed to browser

const SHEET_ID = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

// ══════════ CONSTANTS ══════════
const K = { pythExp: 1.83, runsPerWar: 10, bpWar: 3.47, hfa: 1.07, minEdge: 0.05, minOuEv: 0.03, nbR: 3.15 };
const PF = {ARI:1.04,ATL:0.99,BAL:1.01,BOS:1.04,CHC:1.05,CHW:1.03,CIN:1.08,CLE:0.97,COL:1.18,DET:0.98,HOU:1.00,KC:1.05,LAA:0.97,LAD:0.97,MIA:0.93,MIL:1.01,MIN:1.01,NYM:0.95,NYY:1.06,OAK:0.96,SAC:0.96,PHI:1.03,PIT:0.94,SD:0.95,SF:0.93,SEA:0.95,STL:0.98,TB:0.90,TEX:1.00,TOR:1.02,WAS:1.00};
const ORI = {ARI:0,ATL:145,BAL:31,BOS:45,CHC:37,CHW:127,CIN:122,CLE:0,COL:4,DET:150,HOU:343,KC:46,LAA:44,LAD:26,MIA:128,MIL:129,MIN:129,NYM:13,NYY:75,OAK:55,SAC:55,PHI:9,PIT:116,SD:0,SF:85,SEA:49,STL:62,TB:359,TEX:30,TOR:345,WAS:28};
const STD = {ARI:{lat:33.4453,lon:-112.0667},ATL:{lat:33.8911,lon:-84.4682},BAL:{lat:39.2839,lon:-76.6217},BOS:{lat:42.3467,lon:-71.0972},CHC:{lat:41.9484,lon:-87.6553},CHW:{lat:41.8299,lon:-87.6338},CIN:{lat:39.0974,lon:-84.5065},CLE:{lat:41.4962,lon:-81.6852},COL:{lat:39.7559,lon:-104.9942},DET:{lat:42.3390,lon:-83.0485},HOU:{lat:29.7573,lon:-95.3555},KC:{lat:39.0517,lon:-94.4803},LAA:{lat:33.8003,lon:-117.8827},LAD:{lat:34.0739,lon:-118.2400},MIA:{lat:25.7781,lon:-80.2197},MIL:{lat:43.0280,lon:-87.9712},MIN:{lat:44.9818,lon:-93.2775},NYM:{lat:40.7571,lon:-73.8458},NYY:{lat:40.8296,lon:-73.9262},OAK:{lat:37.7516,lon:-122.2005},SAC:{lat:38.5816,lon:-121.5064},PHI:{lat:39.9061,lon:-75.1665},PIT:{lat:40.4469,lon:-80.0058},SD:{lat:32.7076,lon:-117.1570},SF:{lat:37.7786,lon:-122.3893},SEA:{lat:47.5914,lon:-122.3326},STL:{lat:38.6226,lon:-90.1928},TB:{lat:27.7682,lon:-82.6534},TEX:{lat:32.7473,lon:-97.0845},TOR:{lat:43.6414,lon:-79.3894},WAS:{lat:38.8730,lon:-77.0074}};
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
  // RL: always follows the ML edge side (never contradict the ML)
  // If ML play exists, use that side. Otherwise use best edge side.
  let rrl = null;
  const rlSide = side || (aE != null && hE != null ? (aE > hE ? "away" : "home") : null);
  if (rlSide) {
    let pW2 = rlSide === "away" ? conv.pAwayWinBy2 : conv.pHomeWinBy2;
    // Home team walkoff discount: if home is ahead by 1 after top 9, they don't bat
    // in the bottom of the 9th — model overestimates P(home wins by 2+)
    if (rlSide === "home") pW2 *= 0.94;
    const rrlO = rlSide === "away" ? g.aRrl : g.hRrl;
    const rlTeam = rlSide === "away" ? g.away : g.home;
    if (rrlO) {
      const impl = a2i(rrlO); const dec = rrlO > 0 ? 1 + rrlO / 100 : 1 + 100 / (-rrlO);
      const ev = pW2 * dec - 1;
      rrl = { pWin: pW2, impl, edge: pW2 - impl, ev, odds: rrlO, rlSide, rlTeam };
    }
  }
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

// Name normalization: strips accents, Jr/Sr suffixes, middle initials, periods, extra whitespace
function normName(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "")              // strip Jr. Sr. II III IV
    .replace(/\./g, "")                                        // strip periods (J.P. -> JP)
    .replace(/\s+/g, " ").trim().toUpperCase();
}

// Extract first name and last name, stripping middle initials
function firstLast(norm) {
  var parts = norm.split(" ");
  if (parts.length <= 2) return { first: parts[0] || "", last: parts[parts.length - 1] || "" };
  // 3+ parts: first and last, skip middle (handles "Michael A Taylor" -> Michael, Taylor)
  return { first: parts[0], last: parts[parts.length - 1] };
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
    const team = (r[1] || "").toString().trim().toUpperCase();
    const entry = { name: n, team: team, proj: parseFloat(r[2]) || 0, cur: parseFloat(r[3]) || null, gp: parseFloat(r[4]) || null };
    const norm = normName(n);
    m[n.toUpperCase()] = entry;
    if (norm !== n.toUpperCase()) m[norm] = entry;
  }
  return m;
}

function findPlayer(name, warMap, team) {
  var k = name.toUpperCase().trim();
  var norm = normName(name);
  var fl = firstLast(norm);
  // 1. Exact match on original
  if (warMap[k]) return warMap[k];
  // 2. Exact match on normalized (handles accents, Jr., periods)
  if (warMap[norm]) return warMap[norm];
  // 3. First name + last name + team (handles middle initials, Max Muncy situation)
  var teamMatch = Object.values(warMap).find(function(b) {
    if (team && b.team && b.team !== team) return false;
    var bNorm = normName(b.name);
    var bFL = firstLast(bNorm);
    return bFL.first === fl.first && bFL.last === fl.last;
  });
  if (teamMatch) return teamMatch;
  // 4. First name + last name WITHOUT team filter (if team didn't help)
  if (team) {
    var noTeamMatch = Object.values(warMap).find(function(b) {
      var bNorm = normName(b.name);
      var bFL = firstLast(bNorm);
      return bFL.first === fl.first && bFL.last === fl.last;
    });
    if (noTeamMatch) return noTeamMatch;
  }
  // 5. Handle "T. Grisham" / "S Schwellenbach" style (initial + last name) with team
  if (fl.first.length <= 2) {
    var initial = fl.first[0];
    var abbrMatch = Object.values(warMap).find(function(b) {
      if (team && b.team && b.team !== team) return false;
      var bNorm = normName(b.name);
      var bFL = firstLast(bNorm);
      return bFL.last === fl.last && bNorm[0] === initial;
    });
    if (abbrMatch) return abbrMatch;
    // Without team filter
    var abbrNoTeam = Object.values(warMap).find(function(b) {
      var bNorm = normName(b.name);
      var bFL = firstLast(bNorm);
      return bFL.last === fl.last && bNorm[0] === initial;
    });
    if (abbrNoTeam) return abbrNoTeam;
  }
  // 6. Last resort: last name + first initial (original fuzzy logic)
  var lastResort = Object.values(warMap).find(function(b) {
    var bNorm = normName(b.name);
    var bFL = firstLast(bNorm);
    return bFL.last === fl.last && bNorm[0] === norm[0];
  });
  return lastResort || null;
}

function luLW(lineup, bW, gp, team) {
  if (!lineup || lineup.length < 5) return null;
  let t = 0, f = 0;
  lineup.forEach(n => {
    const p = findPlayer(n, bW, team);
    if (p) { t += bld(p.proj, p.cur, gp || p.gp); f++; } });
  return f >= 5 ? t : null;
}

function luSP(sp, pW, gp, team) {
  if (!sp || sp === "TBD") return null;
  const p = findPlayer(sp, pW, team);
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
          var gt = new Date(g.gameDate); var etMs = gt.getTime() - 4*60*60*1000; var etD = new Date(etMs);
          var hh = etD.getUTCHours(); var mm = etD.getUTCMinutes(); var ap = hh >= 12 ? "PM" : "AM"; var h12 = hh % 12 || 12;
          mlbMap[key] = { aSP: sp, hSP: g.teams?.home?.probablePitcher?.fullName || "TBD",
          aL, hL, aC: aL.length >= 9, hC: hL.length >= 9,
          time: h12 + ":" + String(mm).padStart(2, "0") + " " + ap };
    }); });
    return oddsGames.map(g => { const m = mlbMap[g.id]; if (!m) return g;
      return { ...g, aSP: m.aSP || g.aSP, hSP: m.hSP || g.hSP, aL: m.aL.length > 0 ? m.aL : g.aL, hL: m.hL.length > 0 ? m.hL : g.hL, aC: m.aC || g.aC, hC: m.hC || g.hC, time: m.time || g.time }; });
  } catch { return oddsGames; }
}

// ══════════ ROTOWIRE PROJECTED LINEUPS ══════════
// Reads ROTOWIRE (today) and ROTOWIRE (tomorrow) tabs
// Row layout (fixed):
//   Row 3: Team abbreviations (pairs: away, home across columns)
//   Row 5: Game time (e.g. "8:05 PM ET")
//   Row 7: Lineup status ("Expected Lineup", "Confirmed Lineup", "Unknown Lineup")
//   Row 8: Starting pitcher name
//   Rows 10-18: Batting order (9 batters)
// Columns expand in pairs for each game, sorted by time

function parseRotoWireTab(rows, dateTag) {
  const rwGames = []; // array of { key, time, aSP, hSP, aL, hL, aC, hC, aProjected, hProjected }
  if (!rows || rows.length < 18) return rwGames;

  const row3 = rows[2] || [];   // team abbreviations
  const row5 = rows[4] || [];   // game times
  const row7 = rows[6] || [];   // lineup status
  const row8 = rows[7] || [];   // starting pitchers

  for (let c = 1; c < row3.length; c += 2) {
    const awRaw = String(row3[c] || "").trim().toUpperCase();
    const hmRaw = String(row3[c + 1] || "").trim().toUpperCase();
    if (!awRaw || !hmRaw || awRaw.length > 4 || hmRaw.length > 4) continue;

    let aw = awRaw, hm = hmRaw;
    if (aw === "OAK") aw = "SAC"; if (hm === "OAK") hm = "SAC";
    if (aw === "WSH") aw = "WAS"; if (hm === "WSH") hm = "WAS";
    if (aw === "CWS") aw = "CHW"; if (hm === "CWS") hm = "CHW";

    const gameTime = String(row5[c] || "").trim();
    const awStatus = String(row7[c] || "").trim();
    const hmStatus = String(row7[c + 1] || "").trim();
    const awSP = String(row8[c] || "").trim();
    const hmSP = String(row8[c + 1] || "").trim();

    const awHasLineup = awStatus && !awStatus.toLowerCase().includes("unknown");
    const hmHasLineup = hmStatus && !hmStatus.toLowerCase().includes("unknown");
    if (!awHasLineup && !hmHasLineup) continue;

    const aL = [], hL = [];
    for (let r = 9; r <= 17; r++) {
      if (rows[r]) {
        const awBatter = String(rows[r][c] || "").trim();
        const hmBatter = String(rows[r][c + 1] || "").trim();
        if (awBatter && awHasLineup) aL.push(awBatter);
        if (hmBatter && hmHasLineup) hL.push(hmBatter);
      }
    }

    const awConfirmed = awStatus.toLowerCase().includes("confirmed");
    const hmConfirmed = hmStatus.toLowerCase().includes("confirmed");

    // Key matches odds game ID format: "AWAY-HOME-YYYY-MM-DD"
    const key = `${aw}-${hm}-${dateTag}`;

    rwGames.push({
      key, gameTime, aw, hm,
      aSP: awSP || "TBD", hSP: hmSP || "TBD",
      aL, hL,
      aC: awConfirmed && aL.length >= 9,
      hC: hmConfirmed && hL.length >= 9
    });
  }
  return rwGames;
}

async function fRotoWire(oddsGames) {
  try {
    // Determine today and tomorrow date strings
    const now = new Date();
    const todayET = new Date(now.getTime() - 4 * 60 * 60 * 1000); // EDT offset
    const todayStr = todayET.getUTCFullYear() + "-" + String(todayET.getUTCMonth() + 1).padStart(2, "0") + "-" + String(todayET.getUTCDate()).padStart(2, "0");
    const tomorrowET = new Date(todayET.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrowET.getUTCFullYear() + "-" + String(tomorrowET.getUTCMonth() + 1).padStart(2, "0") + "-" + String(tomorrowET.getUTCDate()).padStart(2, "0");

    // Read both tabs in parallel
    const [todayRows, tomorrowRows] = await Promise.all([
      fSheet("ROTOWIRE!A1:AZ20").catch(() => []),
      fSheet("'ROTOWIRE (tomorrow)'!A1:AZ20").catch(() => [])
    ]);

    // Parse both tabs with their respective dates
    const todayGames = parseRotoWireTab(todayRows, todayStr);
    const tomorrowGames = parseRotoWireTab(tomorrowRows, tomorrowStr);
    const allRW = [...todayGames, ...tomorrowGames];

    if (allRW.length === 0) return oddsGames;

    // Build lookup map — for doubleheaders (same key), sort by game time
    // and match to odds games which are also sorted by time
    const rwByKey = {};
    allRW.forEach(rw => {
      if (!rwByKey[rw.key]) rwByKey[rw.key] = [];
      rwByKey[rw.key].push(rw);
    });
    // Sort each key's games by time
    for (const k in rwByKey) {
      rwByKey[k].sort((a, b) => (a.gameTime || "").localeCompare(b.gameTime || ""));
    }

    // Track how many times we've seen each key in odds games (for doubleheader matching)
    const seenCount = {};

    return oddsGames.map(g => {
      const rwList = rwByKey[g.id];
      if (!rwList || rwList.length === 0) return g;

      // For doubleheaders: first odds game with this key gets first RW entry, second gets second
      if (!seenCount[g.id]) seenCount[g.id] = 0;
      const idx = Math.min(seenCount[g.id], rwList.length - 1);
      seenCount[g.id]++;
      const m = rwList[idx];

      return {
        ...g,
        aSP: g.aSP === "TBD" && m.aSP !== "TBD" ? m.aSP : g.aSP,
        hSP: g.hSP === "TBD" && m.hSP !== "TBD" ? m.hSP : g.hSP,
        aL: g.aL.length >= 9 ? g.aL : m.aL.length >= 9 ? m.aL : g.aL,
        hL: g.hL.length >= 9 ? g.hL : m.hL.length >= 9 ? m.hL : g.hL,
        aC: g.aC || m.aC,
        hC: g.hC || m.hC
      };
    });
  } catch (e) {
    return oddsGames;
  }
}

async function fWeather(team, gd) {
  const s = STD[team]; if (!s) return null;
  try {
    const d = gd?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&start_date=${d}&end_date=${d}`);
    if (!r.ok) return null; const data = await r.json(); if (!data.hourly) return null;
    // Convert commence time to ET hour for correct forecast slot
    let h = 19; // default 7pm
    if (gd) { const gt = new Date(gd); const etMs = gt.getTime() - 4 * 60 * 60 * 1000; h = new Date(etMs).getUTCHours(); }
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
      tLW_a: luLW(g.aL, bW, gp, g.away), tLW_h: luLW(g.hL, bW, gp, g.home),
      spW_a: luSP(g.aSP, pW, gp, g.away), spW_h: luSP(g.hSP, pW, gp, g.home),
      aOdds: aO, hOdds: hO, dkMl: { a: o.ml.aDK, h: o.ml.hDK }, fdMl: { a: o.ml.aFD, h: o.ml.hFD },
      ouData: o.ou,
      aRrl: o.rl.aDog != null && o.rl.aFD != null ? Math.max(o.rl.aDog, o.rl.aFD) : o.rl.aDog != null ? o.rl.aDog : o.rl.aFD != null ? o.rl.aFD : null,
      hRrl: o.rl.hDog != null && o.rl.hFD != null ? Math.max(o.rl.hDog, o.rl.hFD) : o.rl.hDog != null ? o.rl.hDog : o.rl.hFD != null ? o.rl.hFD : null,
      weather: wm?.[g.home] || null };
  });
}

// ══════════ HANDLER ══════════
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  try {
    const [oddsData, tpR, bR, pR] = await Promise.all([
      fOdds().catch(() => ({ odds: {}, games: [] })),
      fSheet("Team Projections!A1:E35").catch(() => []),
      fSheet("Batter WAR!A1:E4000").catch(() => []),
      fSheet("Pitcher WAR!A1:E5000").catch(() => [])
    ]);
    const odds = oddsData.odds || {}; const oddsGames = oddsData.games || [];
    // Enrichment chain: RotoWire projected lineups first, then MLB confirmed overwrites
    const rwEnriched = await fRotoWire(oddsGames).catch(() => oddsGames);
    const mlb = await fMLB(rwEnriched).catch(() => rwEnriched);
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
