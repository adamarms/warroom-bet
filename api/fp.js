// /api/fp.js — First Pitch Matchup Data
const SHEET_ID  = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

async function fSheet(range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${SHEET_KEY}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(u, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
  return (await r.json()).values || [];
}

const pn = v => { if (v == null || v === "") return null; const n = parseFloat(String(v).trim()); return isNaN(n) ? null : n; };

function parsePitcherTab(rows) {
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name  = String(r[0] || "").trim();
    const split = String(r[3] || "").trim();
    if (!name) continue;
    if (!map[name]) map[name] = {};
    const g       = pn(r[4]) || 0;
    const strikeP = pn(r[5]) || 0;
    const ballP   = pn(r[6]) || 0;
    const missP   = pn(r[8]) || 0;
    const foulP   = pn(r[9]) || 0;
    const inPlayP = pn(r[10]) || 0;
    const hand    = String(r[2] || "").trim().toUpperCase();
    const pitchTypes = [
      { n: "FF", v: pn(r[11]) || 0 }, { n: "SL", v: pn(r[12]) || 0 },
      { n: "CH", v: pn(r[13]) || 0 }, { n: "CU", v: pn(r[14]) || 0 },
      { n: "SI", v: pn(r[15]) || 0 }, { n: "FC", v: pn(r[16]) || 0 }
    ].filter(t => t.v >= 5).sort((a, b) => b.v - a.v).slice(0, 2);
    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballP   / 100),
      ballPct:    ballP,
      strikesRaw: Math.round(g * strikeP / 100),
      strikePct:  strikeP,
      contStrike: Math.round((foulP + inPlayP) * 10) / 10,
      swingMiss:  Math.round(missP * 10) / 10,
      inPlayGame: Math.round(strikeP * inPlayP) / 100,
      hit:        pitchTypes.map(t => `${t.n} ${Math.round(t.v)}%`).join(" / ") || "—"
    };
  }
  return map;
}

function parseBatterTab(rows) {
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name  = String(r[0] || "").trim();
    const split = String(r[3] || "").trim();
    if (!name) continue;
    if (!map[name]) map[name] = {};
    const g        = pn(r[4]) || 0;
    const strikeFP = pn(r[5]) || 0;
    const swingP   = pn(r[6]) || 0;
    const contactP = pn(r[7]) || 0;
    const inPlayP  = pn(r[9]) || 0;
    const singleP  = pn(r[11]) || 0;
    const xbhP     = pn(r[12]) || 0;
    const hand     = String(r[2] || "").trim().toUpperCase();
    const ballFP   = 100 - strikeFP;
    const inPlayGame = Math.round(strikeFP * swingP * contactP * inPlayP / 1000000 * 10) / 10;
    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballFP   / 100),
      ballPct:    Math.round(ballFP * 10) / 10,
      strikesRaw: Math.round(g * strikeFP / 100),
      strikePct:  strikeFP,
      contStrike: Math.round(swingP * contactP) / 100,
      swingMiss:  swingP,
      inPlayGame,
      hit:        Math.round((singleP + xbhP) * 10) / 10
    };
  }
  return map;
}

function parseRotoWire(rows) {
  const result = {};
  if (!rows || rows.length < 10) return result;
  const teamRow    = rows[2] || [];
  const spRow      = rows[7] || [];
  const leadoffRow = rows[9] || [];
  for (let c = 0; c < teamRow.length; c++) {
    let team = String(teamRow[c] || "").trim().toUpperCase();
    if (!team || team.length > 4) continue;
    if (team === "OAK") team = "SAC";
    if (team === "WSH" || team === "WSN") team = "WAS";
    if (team === "CWS") team = "CHW";
    const sp      = String(spRow[c]      || "").trim();
    const leadoff = String(leadoffRow[c] || "").trim();
    if (sp || leadoff) result[team] = { sp, leadoff };
  }
  return result;
}

function parseTodaysGames(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const awayCol = headers.indexOf("away");
  const homeCol = headers.indexOf("home");
  const timeCol = headers.indexOf("time");
  const dateCol = headers.indexOf("date");
  if (awayCol < 0 || homeCol < 0) return [];
  const games = [];
  for (let i = 1; i < rows.length; i++) {
    const away = String(rows[i][awayCol] || "").trim().toUpperCase();
    const home = String(rows[i][homeCol] || "").trim().toUpperCase();
    if (!away || !home) continue;
    games.push({ away, home,
      time:     timeCol >= 0 ? String(rows[i][timeCol] || "").trim() : "",
      gameDate: dateCol >= 0 ? String(rows[i][dateCol] || "").trim() : ""
    });
  }
  return games;
}

function normalizeName(name) {
  return (name || "").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "").replace(/\s+(jr|sr|ii|iii|iv)$/i, "")
    .replace(/\s+/g, " ").trim().toUpperCase();
}

function getStats(map, name, split) {
  if (!name || !map) return null;
  if (map[name] && map[name][split]) return map[name][split];
  const normTarget = normalizeName(name);
  for (const key of Object.keys(map)) {
    if (normalizeName(key) === normTarget) return map[key][split] || null;
  }
  for (const key of Object.keys(map)) {
    const normKey = normalizeName(key);
    if (normKey.startsWith(normTarget) || normTarget.startsWith(normKey)) return map[key][split] || null;
  }
  return null;
}

// ── PROBABILITY: P(first pitch in play) ───────────────────────────────────
// = pitcherStrike% × batter(InPlay/Strike%)
// InPlay/Strike = inPlayGame / (batterStrike/100) — removes batter's own strike rate
// so we can apply the pitcher's strike rate cleanly
// Example: pitcher 60% strikes, batter 20% InPlay/Strike → 60% × 20% = 12%
function calcProb(pData, bData) {
  if (!pData || !bData) return null;
  const pStrike = pData.strikePct;   // pitcher strike%
  const bStrike = bData.strikePct;   // batter strike faced%
  const bInPlay = bData.inPlayGame;  // batter full chain per pitch (already includes batter strike rate)
  const bSwing  = bData.swingMiss;   // batter swing/strike% (Swing/Stk column)

  if (!pStrike || !bStrike || bStrike <= 0 || bInPlay == null) return null;

  // InPlay per strike = remove batter's own strike rate from inPlayGame
  const inPlayPerStrike = bInPlay / (bStrike / 100);
  // P(in play | first pitch) = pitcher throws strike × batter puts it in play per strike
  const prob = Math.min(0.5, Math.max(0, (pStrike / 100) * (inPlayPerStrike / 100)));

  if (prob <= 0) return null;

  // SWINGER flag: batter swings at 50%+ of strikes — actively attacking
  const isSwinger = bSwing != null && bSwing >= 50;

  const american = prob >= 0.5
    ? "-" + Math.round((prob / (1 - prob)) * 100)
    : "+" + Math.round(((1 - prob) / prob) * 100);

  const label = prob >= 0.18 ? "HOT SPOT"
    : prob >= 0.12 ? "WARM"
    : prob >= 0.07 ? "NEUTRAL"
    : "COLD";

  return { value: Math.round(prob * 1000) / 10, american, label, swinger: isSwinger };
}

function buildHalf(pitcherName, pitcherTeam, batterName, batterTeam, pMap, bMap) {
  const pAll = getStats(pMap, pitcherName, "All");
  const bAll = getStats(bMap, batterName,  "All");
  const pitcherHand = pAll ? pAll.hand : "";
  const batterHand  = bAll ? bAll.hand : "";
  const effectiveBatterHand = batterHand === "S"
    ? (pitcherHand === "L" ? "R" : "L") : batterHand;
  const pSplitKey   = effectiveBatterHand === "L" ? "vsL" : effectiveBatterHand === "R" ? "vsR" : null;
  const pSplitLabel = effectiveBatterHand === "L" ? "vs LHB" : effectiveBatterHand === "R" ? "vs RHB" : null;
  const pSplit      = pSplitKey ? getStats(pMap, pitcherName, pSplitKey) : null;
  const bSplitKey   = pitcherHand === "L" ? "vsL" : pitcherHand === "R" ? "vsR" : null;
  const bSplitLabel = pitcherHand === "L" ? "vs LHP" : pitcherHand === "R" ? "vs RHP" : null;
  const bSplit      = bSplitKey ? getStats(bMap, batterName, bSplitKey) : null;
  const prob = calcProb(pAll, bAll);
  return {
    pitcher: { name: pitcherName || "TBD", team: pitcherTeam, hand: pitcherHand,
      overall: pAll, split: pSplit && (pSplit.g||0)>0 ? pSplit : null, splitLabel: pSplitLabel },
    batter:  { name: batterName  || "TBD", team: batterTeam,  hand: batterHand,
      overall: bAll, split: bSplit && (bSplit.g||0)>0 ? bSplit : null, splitLabel: bSplitLabel },
    prob
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  try {
    const [gamesRows, rwRows, fpPRows, fpBRows] = await Promise.all([
      fSheet("Today's Games!A1:E200").catch(() => []),
      fSheet("ROTOWIRE!A1:AZ20").catch(() => []),
      fSheet("FP Pitcher!A1:T5000").catch(() => []),
      fSheet("FP Batter!A1:O5000").catch(() => [])
    ]);
    const gamesList = parseTodaysGames(gamesRows);
    const rw        = parseRotoWire(rwRows);
    const pMap      = parsePitcherTab(fpPRows);
    const bMap      = parseBatterTab(fpBRows);
    const nowET     = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const todayET   = nowET.getUTCFullYear() + "-" +
      String(nowET.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(nowET.getUTCDate()).padStart(2, "0");
    const games = gamesList
      .filter(g => !g.gameDate || g.gameDate === todayET || g.gameDate === "")
      .map(game => {
        const aw = game.away, hm = game.home;
        const awRW = rw[aw] || {}, hmRW = rw[hm] || {};
        const top = buildHalf(hmRW.sp || "TBD", hm, awRW.leadoff || "TBD", aw, pMap, bMap);
        const bot = buildHalf(awRW.sp || "TBD", aw, hmRW.leadoff || "TBD", hm, pMap, bMap);
        return { id: `${aw}-${hm}-${game.gameDate||todayET}`, away: aw, home: hm,
          time: game.time, gameDate: game.gameDate||todayET, top, bot };
      });
    res.status(200).json({ games, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
};
