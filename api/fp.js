// /api/fp.js — First Pitch Matchup Data
// Reads FP Pitcher, FP Batter, ROTOWIRE, and Today's Games tabs
// Returns structured matchup data for today's games

const SHEET_ID  = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

const TID = {108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",
  115:"COL",116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WAS",121:"NYM",133:"OAK",
  134:"PIT",135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",
  142:"MIN",143:"PHI",144:"ATL",145:"CHW",146:"MIA",147:"NYY",158:"MIL",568:"SAC"};

async function fSheet(range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${SHEET_KEY}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(u, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
  return (await r.json()).values || [];
}

const pn = v => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
};

// ── PARSE FP PITCHER TAB ─────────────────────────────────
// Cols: 0=name 1=team 2=hand 3=split 4=games
//   5=Strike% 6=Ball% 7=Called% 8=SwingMiss% 9=Foul% 10=InPlay%
//   11=FF% 12=SL% 13=CH% 14=CU% 15=SI% 16=FC% 17=Other% 18=AvgVelo

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

    // Pitch mix: top 2 types with >= 5% usage
    const pitchTypes = [
      { n: "FF", v: pn(r[11]) || 0 }, { n: "SL", v: pn(r[12]) || 0 },
      { n: "CH", v: pn(r[13]) || 0 }, { n: "CU", v: pn(r[14]) || 0 },
      { n: "SI", v: pn(r[15]) || 0 }, { n: "FC", v: pn(r[16]) || 0 }
    ].filter(t => t.v >= 5).sort((a, b) => b.v - a.v).slice(0, 2);
    const pitchMix = pitchTypes.map(t => `${t.n} ${Math.round(t.v)}%`).join(" / ");

    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballP   / 100),
      ballPct:    ballP,
      strikesRaw: Math.round(g * strikeP / 100),
      strikePct:  strikeP,
      contStrike: Math.round((foulP + inPlayP) * 10) / 10,  // (foul+inPlay)/strike
      swingMiss:  Math.round(missP * 10) / 10,               // swingMiss/strike
      inPlayGame: Math.round(strikeP * inPlayP) / 100,       // inPlay/game
      hit:        pitchMix || "—"                            // pitch mix for pitcher
    };
  }
  return map;
}

// ── PARSE FP BATTER TAB ──────────────────────────────────
// Cols: 0=name 1=team 2=hand 3=split 4=games
//   5=StrikeFaced% 6=Swing%(per strike) 7=Contact%(per swing)
//   8=Foul%(per contact) 9=InPlay%(per contact)
//   10=Out% 11=Single% 12=XBH%

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

    // inPlay/game = chain: strike% × swing/strike × contact/swing × inPlay/contact / 10^6 × 100
    const inPlayGame = Math.round(strikeFP * swingP * contactP * inPlayP / 1000000 * 10) / 10;

    map[name][split] = {
      g, hand,
      ballsRaw:   Math.round(g * ballFP   / 100),
      ballPct:    Math.round(ballFP * 10) / 10,
      strikesRaw: Math.round(g * strikeFP / 100),
      strikePct:  strikeFP,
      contStrike: Math.round(swingP * contactP) / 100,  // swing/strike × contact/swing = contact/strike
      swingMiss:  swingP,                                // Swing/Strike% (repurposed column)
      inPlayGame,
      hit:        Math.round((singleP + xbhP) * 10) / 10  // hit/inPlay%
    };
  }
  return map;
}

// ── PARSE ROTOWIRE ────────────────────────────────────────
// Row 3=teams, Row 8=SP, Row 10=leadoff batter

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

// ── PARSE TODAY'S GAMES ──────────────────────────────────

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

// ── GET PLAYER STATS ──────────────────────────────────────

function normalizeName(name) {
  return (name || "").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/\./g, "")                                  // remove periods
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, "")              // strip suffix
    .replace(/\s+/g, " ").trim().toUpperCase();
}

function getStats(map, name, split) {
  if (!name || !map) return null;

  // Pass 1: exact match
  if (map[name] && map[name][split]) return map[name][split];

  // Pass 2: normalized match — handles Jr./Sr., accents, periods
  const normTarget = normalizeName(name);
  for (const key of Object.keys(map)) {
    if (normalizeName(key) === normTarget) {
      return map[key][split] || null;
    }
  }

  // Pass 3: prefix match — "Ronald Acuna" matches "Ronald Acuna Jr."
  for (const key of Object.keys(map)) {
    const normKey = normalizeName(key);
    if (normKey.startsWith(normTarget) || normTarget.startsWith(normKey)) {
      return map[key][split] || null;
    }
  }

  return null;
}

// ── COMPUTE PROBABILITY ───────────────────────────────────

function calcProb(pData, bData) {
  if (!pData || !bData) return null;
  const ps    = pData.strikePct;
  const bSwing = bData.swingMiss;   // batter's Swing/Strike
  const bCont  = bData.contStrike;  // batter's Contact/Strike = Swing × Contact/100
  // We need Contact/Swing for the full chain — derive it:
  const bContSwing = bSwing > 0 ? (bCont / bSwing) * 100 : 0;
  const bInPlay = bData.inPlayGame; // already chained

  // Use: pitcher strike% × batter swing/strike × batter contact/swing × batter inPlay/contact
  // But batter inPlayGame is already the full chain. Use it directly as P(in play | pitch):
  // p = batter inPlayGame% / 100
  // Then scale by pitcher strike efficiency (if pitcher throws more strikes, more in-play chances)
  // The matchup probability = pitcher_strike% × batter_swing_on_strike × batter_contact_on_swing × batter_inplay_on_contact
  // Since batter stats are per-strike (swing=swings/strikes, and inPlayGame is the full chain per game/pitch):
  // We need to derive inPlay/contact for the chain
  // inPlayGame = strikeFaced% × swing% × contact% × inPlay% / 10^6 × 100
  // So inPlay/game = strikeFaced × swing × contact × inPlay / 10^6 × 100
  // For the matchup we want:
  // prob = pitcher_strike% × batter_swing/strike × (batter inPlay / batter strikeFaced%)
  // = pStrike/100 × bSwing/100 × (bInPlayGame / bStrikePct × 100)
  const bStrikePct = bData.strikePct;
  if (ps == null || bSwing == null || bInPlay == null || bStrikePct == null) return null;

  // P(in play this pitch) = pitcher throws strike × batter response rate per strike
  const bResponsePerStrike = bStrikePct > 0 ? (bInPlay / bStrikePct) : 0;
  const prob = (ps / 100) * bResponsePerStrike;

  if (prob <= 0) return null;

  const american = prob >= 0.5
    ? "-" + Math.round((prob / (1 - prob)) * 100)
    : "+" + Math.round(((1 - prob) / prob) * 100);

  const label = prob >= 0.18 ? "HOT SPOT"
    : prob >= 0.12 ? "WARM"
    : prob >= 0.07 ? "NEUTRAL"
    : "COLD";

  return { value: Math.round(prob * 1000) / 10, american, label };
}

// ── BUILD HALF ────────────────────────────────────────────

function buildHalf(pitcherName, pitcherTeam, batterName, batterTeam, pMap, bMap) {
  const pAll = getStats(pMap, pitcherName, "All");
  const bAll = getStats(bMap, batterName,  "All");

  // Determine hands
  const pitcherHand = pAll ? pAll.hand : "";
  const batterHand  = bAll ? bAll.hand : "";

  // Switch hitter bats opposite to pitcher
  const effectiveBatterHand = batterHand === "S"
    ? (pitcherHand === "L" ? "R" : "L")
    : batterHand;

  // Pitcher: All + vs [batter effective hand]
  const pSplitKey   = effectiveBatterHand === "L" ? "vsL" : effectiveBatterHand === "R" ? "vsR" : null;
  const pSplitLabel = effectiveBatterHand === "L" ? "vs LHB" : effectiveBatterHand === "R" ? "vs RHB" : null;
  const pSplit      = pSplitKey ? getStats(pMap, pitcherName, pSplitKey) : null;

  // Batter: All + vs [pitcher hand]
  const bSplitKey   = pitcherHand === "L" ? "vsL" : pitcherHand === "R" ? "vsR" : null;
  const bSplitLabel = pitcherHand === "L" ? "vs LHP" : pitcherHand === "R" ? "vs RHP" : null;
  const bSplit      = bSplitKey ? getStats(bMap, batterName, bSplitKey) : null;

  const prob = calcProb(pAll, bAll);

  return {
    pitcher: {
      name: pitcherName || "TBD",
      team: pitcherTeam,
      hand: pitcherHand,
      overall:    pAll,
      split:      pSplit && (pSplit.g || 0) > 0 ? pSplit : null,
      splitLabel: pSplitLabel
    },
    batter: {
      name: batterName || "TBD",
      team: batterTeam,
      hand: batterHand,
      overall:    bAll,
      split:      bSplit && (bSplit.g || 0) > 0 ? bSplit : null,
      splitLabel: bSplitLabel
    },
    prob
  };
}

// ── MAIN HANDLER ─────────────────────────────────────────

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

    // Filter to today ET
    const nowET   = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const todayET = nowET.getUTCFullYear() + "-" +
      String(nowET.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(nowET.getUTCDate()).padStart(2, "0");

    const games = gamesList
      .filter(g => !g.gameDate || g.gameDate === todayET || g.gameDate === "")
      .map(game => {
        const aw = game.away, hm = game.home;
        const awRW = rw[aw] || {}, hmRW = rw[hm] || {};

        // TOP 1ST: home pitches, away bats
        const top = buildHalf(
          hmRW.sp || "TBD", hm,
          awRW.leadoff || "TBD", aw,
          pMap, bMap
        );

        // BOT 1ST: away pitches, home bats
        const bot = buildHalf(
          awRW.sp || "TBD", aw,
          hmRW.leadoff || "TBD", hm,
          pMap, bMap
        );

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
