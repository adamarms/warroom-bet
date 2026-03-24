// /api/audit.js — One-time name audit tool
// Hit warroom-bett.vercel.app/api/audit to run the cross-reference
// Delete this file after you've reviewed the results

var SHEET_ID = "1M7xHG_IgczBJULHbabsq4qDJilF2VWetarV_DyuGdDE";
var SHEET_KEY = "AIzaSyCI4PAjwne4YhcRKHWz17JSTeMLP7h6vMU";

var TID = {108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WAS",121:"NYM",133:"OAK",134:"PIT",135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",143:"PHI",144:"ATL",145:"CHW",146:"MIA",147:"NYY",158:"MIL",568:"SAC"};

async function fSheet(range) {
  var u = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + "/values/" + encodeURIComponent(range) + "?key=" + SHEET_KEY + "&valueRenderOption=UNFORMATTED_VALUE";
  var r = await fetch(u);
  if (!r.ok) throw new Error("Sheet " + r.status);
  return (await r.json()).values || [];
}

// Name normalization (same as engine)
function normName(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ").trim().toUpperCase();
}

function fuzzyMatch(name, warMap) {
  var k = name.toUpperCase().trim();
  var norm = normName(name);
  // Exact match
  if (warMap[k]) return { match: "EXACT", warName: warMap[k].name };
  // Normalized exact (accents, Jr., periods)
  var normMatch = null;
  for (var wk in warMap) {
    if (normName(warMap[wk].name) === norm) {
      return { match: "NORM", warName: warMap[wk].name, reason: "normalized match (accent/Jr/period)" };
    }
  }
  // Fuzzy: normalized last name + first initial
  var normParts = norm.split(" ");
  var normLast = normParts[normParts.length - 1];
  var normFirst = norm[0];
  for (var wk in warMap) {
    var w = warMap[wk];
    var bNorm = normName(w.name);
    var bParts = bNorm.split(" ");
    var bLast = bParts[bParts.length - 1];
    if (bLast === normLast && bNorm[0] === normFirst) {
      return { match: "FUZZY", warName: w.name, reason: "last name + first initial" };
    }
  }
  // Handle "T. Grisham" style
  if (normParts.length === 2 && normParts[0].length <= 2) {
    var initial = normParts[0][0];
    var last = normParts[1];
    for (var wk in warMap) {
      var w = warMap[wk];
      var bNorm = normName(w.name);
      var bParts = bNorm.split(" ");
      if (bParts[bParts.length - 1] === last && bNorm[0] === initial) {
        return { match: "FUZZY", warName: w.name, reason: "initial + last name abbreviation" };
      }
    }
  }
  return { match: "NONE", warName: null };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // 1. Load Batter WAR and Pitcher WAR from sheet
    var [bRows, pRows, rwToday, rwTomorrow] = await Promise.all([
      fSheet("Batter WAR!A1:E500").catch(function() { return []; }),
      fSheet("Pitcher WAR!A1:E200").catch(function() { return []; }),
      fSheet("ROTOWIRE!A1:AZ20").catch(function() { return []; }),
      fSheet("'ROTOWIRE (tomorrow)'!A1:AZ20").catch(function() { return []; })
    ]);

    // Parse WAR names into lookup maps
    var batterWAR = {};
    var s = bRows[0] && bRows[0].some(function(c) { return isNaN(parseFloat(c)); }) ? 1 : 0;
    for (var i = s; i < bRows.length; i++) {
      var r = bRows[i];
      if (!r || !r[0]) continue;
      var n = (r[0] + "").trim();
      batterWAR[n.toUpperCase()] = { name: n, team: (r[1] || "").toString().trim().toUpperCase() };
    }

    var pitcherWAR = {};
    s = pRows[0] && pRows[0].some(function(c) { return isNaN(parseFloat(c)) && (c + "").length > 3; }) ? 1 : 0;
    for (var i = s; i < pRows.length; i++) {
      var r = pRows[i];
      if (!r || !r[0]) continue;
      var n = (r[0] + "").trim();
      pitcherWAR[n.toUpperCase()] = { name: n, team: (r[1] || "").toString().trim().toUpperCase() };
    }

    // 2. Get MLB StatsAPI 40-man rosters for all teams
    var mlbNames = [];
    var mlbResp = await fetch("https://statsapi.mlb.com/api/v1/teams?sportId=1&season=2026&hydrate=roster(rosterType(fullRoster))");
    if (mlbResp.ok) {
      var mlbData = await mlbResp.json();
      (mlbData.teams || []).forEach(function(team) {
        var abbr = TID[team.id] || team.abbreviation;
        (team.roster && team.roster.roster || []).forEach(function(p) {
          var name = p.person && p.person.fullName;
          var pos = p.position && p.position.abbreviation;
          if (name) {
            mlbNames.push({ name: name, team: abbr, pos: pos, source: "MLB" });
          }
        });
      });
    }

    // 3. Get RotoWire names
    var rwNames = [];
    function parseRW(rows, label) {
      if (!rows || rows.length < 18) return;
      var row3 = rows[2] || [];
      var row8 = rows[7] || [];
      for (var c = 1; c < row3.length; c += 2) {
        var aw = String(row3[c] || "").trim();
        var hm = String(row3[c + 1] || "").trim();
        if (!aw || !hm) continue;
        // SP
        var awSP = String(row8[c] || "").trim();
        var hmSP = String(row8[c + 1] || "").trim();
        if (awSP) rwNames.push({ name: awSP, team: aw, pos: "SP", source: "RW-" + label });
        if (hmSP) rwNames.push({ name: hmSP, team: hm, pos: "SP", source: "RW-" + label });
        // Batters
        for (var r = 9; r <= 17; r++) {
          if (rows[r]) {
            var ab = String(rows[r][c] || "").trim();
            var hb = String(rows[r][c + 1] || "").trim();
            if (ab) rwNames.push({ name: ab, team: aw, pos: "BAT", source: "RW-" + label });
            if (hb) rwNames.push({ name: hb, team: hm, pos: "BAT", source: "RW-" + label });
          }
        }
      }
    }
    parseRW(rwToday, "today");
    parseRW(rwTomorrow, "tomorrow");

    // 4. Cross-reference ALL names against WAR databases
    var allNames = [].concat(mlbNames, rwNames);
    
    // Deduplicate by name
    var seen = {};
    var unique = [];
    allNames.forEach(function(p) {
      var k = p.name.toUpperCase() + "_" + p.team;
      if (!seen[k]) {
        seen[k] = true;
        unique.push(p);
      }
    });

    // Check each name against batter and pitcher WAR
    var mismatches = [];
    var exactMatches = 0;
    var fuzzyMatches = 0;
    var noMatches = 0;

    unique.forEach(function(p) {
      var warMap = (p.pos === "SP" || p.pos === "P" || p.pos === "RP" || p.pos === "CL") ? pitcherWAR : batterWAR;
      // Also check the other map as fallback (two-way players)
      var result = fuzzyMatch(p.name, warMap);
      if (result.match === "NONE") {
        // Try the other map
        var otherMap = warMap === batterWAR ? pitcherWAR : batterWAR;
        var result2 = fuzzyMatch(p.name, otherMap);
        if (result2.match !== "NONE") {
          result = result2;
          result.reason = (result.reason || "") + " (found in other WAR table)";
        }
      }

      if (result.match === "EXACT") {
        exactMatches++;
      } else if (result.match === "FUZZY") {
        fuzzyMatches++;
        mismatches.push({
          externalName: p.name,
          warName: result.warName,
          team: p.team,
          source: p.source,
          pos: p.pos,
          matchType: "FUZZY",
          reason: result.reason
        });
      } else {
        noMatches++;
        mismatches.push({
          externalName: p.name,
          warName: null,
          team: p.team,
          source: p.source,
          pos: p.pos,
          matchType: "NO MATCH",
          reason: "Not found in Batter WAR or Pitcher WAR"
        });
      }
    });

    // 5. Sort mismatches: NO MATCH first, then FUZZY
    mismatches.sort(function(a, b) {
      if (a.matchType === "NO MATCH" && b.matchType !== "NO MATCH") return -1;
      if (a.matchType !== "NO MATCH" && b.matchType === "NO MATCH") return 1;
      return a.team.localeCompare(b.team) || a.externalName.localeCompare(b.externalName);
    });

    res.status(200).json({
      summary: {
        totalPlayersChecked: unique.length,
        exactMatches: exactMatches,
        fuzzyMatches: fuzzyMatches,
        noMatches: noMatches,
        batterWAREntries: Object.keys(batterWAR).length,
        pitcherWAREntries: Object.keys(pitcherWAR).length,
        mlbRosterNames: mlbNames.length,
        rotowireNames: rwNames.length
      },
      mismatches: mismatches
    });

  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
