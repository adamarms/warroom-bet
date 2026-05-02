// /api/fp.js — First Pitch Matchup Data v2
const SHEET_ID  = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

async function fSheet(range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${SHEET_KEY}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(u, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
  return (await r.json()).values || [];
}

const pn = v => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
};

// ── NAME NORMALIZATION + FUZZY MATCH ─────────────────────────────────────────

function normalizeName(name) {
  return (name || "").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getStats(map, name, split) {
  if (!name || !map) return null;

  // 1. Exact match
  if (map[name] && map[name][split]) return map[name][split];

  const normTarget = normalizeName(name);
  const keys = Object.keys(map);

  // 2. Normalized exact match
  for (const key of keys) {
    if (normalizeName(key) === normTarget) {
      return map[key][split] || null;
    }
  }

  // 3. Abbreviated first name — last name must match exactly,
  //    one side's first name is a single initial of the other
  const tParts = normTarget.split(" ");
  for (const key of keys) {
    const kParts = normalizeName(key).split(" ");
    if (tParts.length >= 2 && kParts.length >= 2) {
      const tLast = tParts[tParts.length - 1];
      const kLast = kParts[kParts.length - 1];
      if (tLast === kLast) {
        const tFirst = tParts[0];
        const kFirst = kParts[0];
        if (
          (tFirst.length === 1 && kFirst.charAt(0) === tFirst) ||
          (kFirst.length === 1 && tFirst.charAt(0) === kFirst)
        ) {
          return map[key][split] || null;
        }
      }
    }
  }

  return null;
}

// ── FAIR ODDS HELPERS ─────────────────────────────────────────────────────────

// Convert probability (0–1) to American odds integer
function toAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

// Format American odds as string with sign
function fmtAmerican(p) {
  const v = toAmerican(p);
  if (v === null) return null;
  return v > 0 ? `+${v}` : `${v}`;
}

// FD split prior: 65% out, 20% single, 15% xbh
const FD_OUT    = 0.65;
const FD_SINGLE = 0.20;
const FD_XBH    = 0.15;
const FD_MIN_PROB = 0.15; // minimum P(inPlay) to show split lines

function calcFairOdds(pInPlay) {
  if (!pInPlay || pInPlay <= 0) return null;

  const flat    = fmtAmerican(pInPlay);
  const showFd  = pInPlay >= FD_MIN_PROB;
  const pOut    = pInPlay * FD_OUT;
  const pSingle = pInPlay * FD_SINGLE;
  const pXbh    = pInPlay * FD_XBH;

  const label = pInPlay >= 0.18 ? "HOT SPOT"
    : pInPlay >= 0.12 ? "WARM"
    : pInPlay >= 0.07 ? "NEUTRAL"
    : "COLD";

  return {
    pInPlay: Math.round(pInPlay * 1000) / 10,
    label,
    flat,
    showFd,
    fd: showFd ? {
      out:    { odds: fmtAmerican(pOut),    pct: Math.round(pOut    * 1000) / 10 },
      single: { odds: fmtAmerican(pSingle), pct: Math.round(pSingle * 1000) / 10 },
      xbh:    { odds: fmtAmerican(pXbh),    pct: Math.round(pXbh    * 1000) / 10 },
    } : null
  };
}

// ── PROBABILITY CHAIN ─────────────────────────────────────────────────────────
// P(in play) = pitcherStk% × batterSwg/Stk × batterCon/Swg × batterIp/Con
// All values are stored as percentages (0–100) in the sheets

function calcProb(pData, bData) {
  if (!pData || !bData) return null;

  const pStk  = pData.strikePct;   // pitcher strike %
  const bSwg  = bData.swingPct;    // batter swing per strike %
  const bCon  = bData.contactPct;  // batter contact per swing %
  const bIp   = bData.inPlayPct;   // batter in play per contact %

  if (pStk == null || bSwg == null || bCon == null || bIp == null) return null;
  if (pStk <= 0 || bSwg <= 0 || bCon <= 0 || bIp <= 0) return null;

  const p = (pStk / 100) * (bSwg / 100) * (bCon / 100) * (bIp / 100);
  if (p <= 0) return null;

  return calcFairOdds(p);
}

// ── SHEET PARSERS ─────────────────────────────────────────────────────────────

// FP Pitcher tab columns (0-based):
// 0=name 1=team 2=hand 3=split 4=games
// 5=Strike% 6=Ball% 7=Called% 8=SwingMiss% 9=Foul% 10=InPlay%
// 11=FF% 12=SL% 13=CH% 14=CU% 15=SI% 16=FC% 17=Other% 18=AvgVelo

function parsePitcherTab(rows) {
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const name  = String(r[0] || "").trim();
    const split = String(r[3] || "").trim();
    if (!name) continue;
    if (!map[name]) map[name] = {};

    const g        = pn(r[4])  || 0;
    const strikeP  = pn(r[5])  || 0;
    const ballP    = pn(r[6])  || 0;
    const missP    = pn(r[8])  || 0;
    const foulP    = pn(r[9])  || 0;
    const inPlayP  = pn(r[10]) || 0;
    const hand     = String(r[2] || "").trim().toUpperCase();

    const pitchTypes = [
      { n: "FF", v: pn(r[11]) || 0 }, { n: "SL", v: pn(r[12]) || 0 },
      { n: "CH", v: pn(r[13]) || 0 }, { n: "CU", v: pn(r[14]) || 0 },
      { n: "SI", v: pn(r[15]) || 0 }, { n: "FC", v: pn(r[16]) || 0 }
    ].filter(t => t.v >= 5).sort((a, b) => b.v - a.v).slice(0, 2);

    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballP   / 100),
      ballPct:    Math.round(ballP   * 10) / 10,
      strikesRaw: Math.round(g * strikeP / 100),
      strikePct:  Math.round(strikeP * 10) / 10,
      // derived display values
      contStrike: Math.round((foulP + inPlayP) * 10) / 10,
      swingMiss:  Math.round(missP   * 10) / 10,
      inPlayGame: Math.round(strikeP * inPlayP) / 100,
      mix:        pitchTypes.map(t => `${t.n} ${Math.round(t.v)}%`).join(" / ") || "—"
    };
  }
  return map;
}

// FP Batter tab columns (0-based):
// 0=name 1=team 2=hand 3=split 4=games
// 5=StrikeFaced% 6=Swing%(per strike) 7=Contact%(per swing)
// 8=Foul%(per contact) 9=InPlay%(per contact)
// 10=Out% 11=Single% 12=XBH%

function parseBatterTab(rows) {
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const name  = String(r[0] || "").trim();
    const split = String(r[3] || "").trim();
    if (!name) continue;
    if (!map[name]) map[name] = {};

    const g        = pn(r[4])  || 0;
    const strikeFP = pn(r[5])  || 0;  // strike faced %
    const swingP   = pn(r[6])  || 0;  // swing per strike %
    const contactP = pn(r[7])  || 0;  // contact per swing %
    const inPlayP  = pn(r[9])  || 0;  // in play per contact %
    const singleP  = pn(r[11]) || 0;
    const xbhP     = pn(r[12]) || 0;
    const hand     = String(r[2] || "").trim().toUpperCase();
    const ballFP   = 100 - strikeFP;

    // full chain display value (for reference)
    const inPlayGame = Math.round(strikeFP * swingP * contactP * inPlayP / 1000000 * 100) / 100;

    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballFP   / 100),
      ballPct:    Math.round(ballFP  * 10) / 10,
      strikesRaw: Math.round(g * strikeFP / 100),
      strikePct:  Math.round(strikeFP * 10) / 10,
      // raw chain components — used for calcProb
      swingPct:   Math.round(swingP   * 10) / 10,
      contactPct: Math.round(contactP * 10) / 10,
      inPlayPct:  Math.round(inPlayP  * 10) / 10,
      // derived display
      inPlayGame,
      hitInPlay:  Math.round((singleP + xbhP) * 10) / 10,
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
    games.push({
      away, home,
      time:     timeCol >= 0 ? String(rows[i][timeCol] || "").trim() : "",
      gameDate: dateCol >= 0 ? String(rows[i][dateCol] || "").trim() : ""
    });
  }
  return games;
}

// ── HALF BUILDER ──────────────────────────────────────────────────────────────

function buildHalf(pitcherName, pitcherTeam, batterName, batterTeam, pMap, bMap) {
  const pAll = getStats(pMap, pitcherName, "All");
  const bAll = getStats(bMap, batterName,  "All");

  const pitcherHand = pAll ? pAll.hand : "";
  const batterHand  = bAll ? bAll.hand : "";

  // Switch hitters bat opposite to pitcher hand
  const effectiveBatterHand = batterHand === "S"
    ? (pitcherHand === "L" ? "R" : "L") : batterHand;

  const pSplitKey   = effectiveBatterHand === "L" ? "vsL" : effectiveBatterHand === "R" ? "vsR" : null;
  const pSplitLabel = effectiveBatterHand === "L" ? "vs LHB" : effectiveBatterHand === "R" ? "vs RHB" : null;
  const pSplit      = pSplitKey ? getStats(pMap, pitcherName, pSplitKey) : null;

  const bSplitKey   = pitcherHand === "L" ? "vsL" : pitcherHand === "R" ? "vsR" : null;
  const bSplitLabel = pitcherHand === "L" ? "vs LHP" : pitcherHand === "R" ? "vs RHP" : null;
  const bSplit      = bSplitKey ? getStats(bMap, batterName, bSplitKey) : null;

  // Use split pitcher data for prob if available and has enough sample, else overall
  const pForCalc = (pSplit && (pSplit.g || 0) >= 5) ? pSplit : pAll;
  const bForCalc = (bSplit && (bSplit.g || 0) >= 5) ? bSplit : bAll;

  const prob = calcProb(pForCalc, bForCalc);

  return {
    pitcher: {
      name:       pitcherName || "TBD",
      team:       pitcherTeam,
      hand:       pitcherHand,
      overall:    pAll,
      split:      pSplit && (pSplit.g || 0) > 0 ? pSplit : null,
      splitLabel: pSplitLabel
    },
    batter: {
      name:       batterName || "TBD",
      team:       batterTeam,
      hand:       batterHand,
      overall:    bAll,
      split:      bSplit && (bSplit.g || 0) > 0 ? bSplit : null,
      splitLabel: bSplitLabel
    },
    prob  // { pInPlay, label, flat, showFd, fd: { out, single, xbh } } | null
  };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

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

    // Derive today's ET date
    const nowET   = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const todayET = nowET.getUTCFullYear() + "-" +
      String(nowET.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(nowET.getUTCDate()).padStart(2, "0");

    const games = gamesList
      .filter(g => !g.gameDate || g.gameDate === todayET || g.gameDate === "")
      .map(game => {
        const aw  = game.away, hm = game.home;
        const awRW = rw[aw] || {}, hmRW = rw[hm] || {};

        const top = buildHalf(hmRW.sp || "TBD", hm, awRW.leadoff || "TBD", aw, pMap, bMap);
        const bot = buildHalf(awRW.sp || "TBD", aw, hmRW.leadoff || "TBD", hm, pMap, bMap);

        return {
          id:       `${aw}-${hm}-${game.gameDate || todayET}`,
          away:     aw,
          home:     hm,
          time:     game.time,
          gameDate: game.gameDate || todayET,
          top,
          bot
        };
      });

    res.status(200).json({ games, ts: Date.now() });

  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
};
