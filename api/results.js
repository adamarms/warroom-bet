// /api/results.js — WAR Room Capital Results Dashboard
// Reads Play Log sheet and returns structured results data

const SHEET_ID  = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
const SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

async function fSheet(range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${SHEET_KEY}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(u, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
  return (await r.json()).values || [];
}

const pn = v => { if (v == null || v === "") return null; const n = parseFloat(String(v)); return isNaN(n) ? null : n; };
const ps = v => String(v || "").trim();

// Column indices matching PLAY_LOG_HEADERS
const PL = {
  Date:0, GameID:1, Away:2, Home:3, AwaySP:4, HomeSP:5,
  OpenMLAway:6, OpenMLHome:7, OpenOULine:8, OpenOUOver:9, OpenRLAway:10, OpenRLHome:11,
  BothConfAt:12, ModelAway:13, ModelHome:14, MLEdge:15,
  EntryMLAway:16, EntryMLHome:17, EntryOULine:18, EntryOUOver:19, EntryRLAway:20, EntryRLHome:21,
  MLTier:22, MLTeam:23, MLOdds:24, MLUnits:25,
  OUTier:26, OUPlay:27, OUJuice:28, OUEV:29,
  RLTier:30, RLTeam:31, RLOdds:32, RLEV:33,
  CloseMLAway:34, CloseMLHome:35, CloseOULine:36, CloseOUOver:37, CloseRLAway:38, CloseRLHome:39,
  MLResult:40, MLPL:41, OUResult:42, OUPL:43, RLResult:44, RLPL:45,
  MLCLV:46, OUCLV:47, RLCLV:48
};

function parseRow(r) {
  return {
    date:        ps(r[PL.Date]),
    gameId:      ps(r[PL.GameID]),
    away:        ps(r[PL.Away]),
    home:        ps(r[PL.Home]),
    awaySP:      ps(r[PL.AwaySP]),
    homeSP:      ps(r[PL.HomeSP]),
    confirmed:   ps(r[PL.BothConfAt]) !== "",
    modelAway:   pn(r[PL.ModelAway]),
    modelHome:   pn(r[PL.ModelHome]),
    mlEdge:      pn(r[PL.MLEdge]),
    // Entry odds
    entryMLAway: pn(r[PL.EntryMLAway]),
    entryMLHome: pn(r[PL.EntryMLHome]),
    entryOULine: pn(r[PL.EntryOULine]),
    entryOUOver: pn(r[PL.EntryOUOver]),
    // Play details
    mlTier:      ps(r[PL.MLTier]),
    mlTeam:      ps(r[PL.MLTeam]),
    mlOdds:      pn(r[PL.MLOdds]),
    mlUnits:     pn(r[PL.MLUnits]),
    ouTier:      ps(r[PL.OUTier]),
    ouPlay:      ps(r[PL.OUPlay]),
    ouJuice:     pn(r[PL.OUJuice]),
    ouEV:        pn(r[PL.OUEV]),
    rlTier:      ps(r[PL.RLTier]),
    rlTeam:      ps(r[PL.RLTeam]),
    rlOdds:      pn(r[PL.RLOdds]),
    rlEV:        pn(r[PL.RLEV]),
    // Close odds
    closeMLAway: pn(r[PL.CloseMLAway]),
    closeMLHome: pn(r[PL.CloseMLHome]),
    closeOULine: pn(r[PL.CloseOULine]),
    // Results
    mlResult:    ps(r[PL.MLResult]),
    mlPL:        pn(r[PL.MLPL]),
    ouResult:    ps(r[PL.OUResult]),
    ouPL:        pn(r[PL.OUPL]),
    rlResult:    ps(r[PL.RLResult]),
    rlPL:        pn(r[PL.RLPL]),
    // CLV
    mlCLV:       pn(r[PL.MLCLV]),
    ouCLV:       pn(r[PL.OUCLV]),
    rlCLV:       pn(r[PL.RLCLV])
  };
}

function calcStats(plays, market) {
  // market = "ml" | "ou" | "rl"
  const tierKey   = market + "Tier";
  const resultKey = market + "Result";
  const plKey     = market + "PL";
  const clvKey    = market + "CLV";
  const oddsKey   = market === "ml" ? "mlOdds" : market === "ou" ? "ouJuice" : "rlOdds";
  const unitsKey  = market === "ml" ? "mlUnits" : null; // only ML tracks units size

  const active = plays.filter(p => {
    const tier = p[tierKey];
    return tier && tier !== "" && tier !== "No Play (final)" && p[resultKey] !== "";
  });

  if (active.length === 0) return { plays: 0, wins: 0, losses: 0, pushes: 0, winPct: null, plUnits: 0, clvAvg: null, roi: null };

  let wins = 0, losses = 0, pushes = 0, plUnits = 0, clvSum = 0, clvCount = 0, riskSum = 0;

  active.forEach(p => {
    const result = p[resultKey].toLowerCase();
    const pl     = p[plKey] || 0;
    const clv    = p[clvKey];
    const odds   = p[oddsKey];
    const units  = unitsKey ? p[unitsKey] : null;

    if (result.includes("win"))        wins++;
    else if (result.includes("loss"))  losses++;
    else if (result.includes("push"))  pushes++;

    plUnits += pl;

    // Units risked:
    // Favorite (-odds): risk = units × (|odds|/100)  e.g. -150 5u = 7.5u risked
    // Underdog (+odds): risk = units flat             e.g. +150 5u = 5u risked
    const u = (units != null && units > 0) ? units : 1;
    if (odds != null) {
      riskSum += odds < 0 ? u * Math.abs(odds / 100) : u;
    } else {
      riskSum += u;
    }

    if (clv != null) { clvSum += clv; clvCount++; }
  });

  const decided = wins + losses;
  // ROI = total P/L / total units risked (flat 1u per play)
  const roi = riskSum > 0 ? Math.round(plUnits / riskSum * 1000) / 10 : null;

  return {
    plays:   active.length,
    wins,
    losses,
    pushes,
    winPct:  decided > 0 ? Math.round(wins / decided * 1000) / 10 : null,
    plUnits: Math.round(plUnits * 100) / 100,
    clvAvg:  clvCount > 0 ? Math.round(clvSum / clvCount * 100) / 100 : null,
    roi
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const rows = await fSheet("Play Log!A1:AW2000");
    if (rows.length <= 1) {
      res.status(200).json({ plays: [], stats: {}, ts: Date.now() });
      return;
    }

    // Skip header row, parse all plays
    const allPlays = rows.slice(1)
      .filter(r => r[0] && r[1])  // must have date + gameId
      .map(parseRow);

    // Only include rows that have at least one play or result
    const scoredPlays = allPlays.filter(p =>
      p.mlTier || p.ouTier || p.rlTier ||
      p.mlResult || p.ouResult || p.rlResult
    );

    // Overall stats
    const mlStats  = calcStats(scoredPlays, "ml");
    const ouStats  = calcStats(scoredPlays, "ou");
    const rlStats  = calcStats(scoredPlays, "rl");

    // Combined P/L
    const totalPL    = Math.round((mlStats.plUnits + ouStats.plUnits + rlStats.plUnits) * 100) / 100;
    const totalPlays = mlStats.plays   + ouStats.plays   + rlStats.plays;
    const totalWins  = mlStats.wins    + ouStats.wins    + rlStats.wins;
    const totalLoss  = mlStats.losses  + ouStats.losses  + rlStats.losses;

    // Chart data: individual ML plays in chronological order (not aggregated by date)
    const mlPlays = scoredPlays
      .filter(p => p.mlTier && p.mlTier !== "No Play (final)" && p.mlResult !== "")
      .slice()
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    let cumML = 0;
    const chartData = mlPlays.map((p, i) => {
      cumML += p.mlPL || 0;
      return {
        i,
        date:    p.date,
        gameId:  p.gameId,
        away:    p.away,
        home:    p.home,
        team:    p.mlTeam,
        odds:    p.mlOdds,
        pl:      Math.round((p.mlPL || 0) * 100) / 100,
        cumML:   Math.round(cumML * 100) / 100,
        result:  p.mlResult
      };
    });

    res.status(200).json({
      plays: scoredPlays.reverse(), // most recent first
      stats: {
        total: { plays: totalPlays, wins: totalWins, losses: totalLoss, plUnits: totalPL },
        ml:    mlStats,
        ou:    ouStats,
        rl:    rlStats
      },
      chartData,
      ts: Date.now()
    });

  } catch (e) {
    res.status(500).json({ error: e.message, plays: [], stats: {} });
  }
};
