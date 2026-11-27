# Football Match Analytics

## WIP - README STILL IN PROGRESS.

## Data sources

| Season                                        | Source                                                | How it is generated                                             |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| 26/27 results, stats, xG                      | [Bzzoiro Sports Data API](https://sports.bzzoiro.com) | `python footyapi.py --export-results` → `data.js`, `bsd_cache/` |
| 26/27 upcoming fixtures, odds, AI predictions | Bzzoiro Sports Data API                               | `python footyapi.py --export-fixtures` → `fixtures.js`          |
| 19/20 – 25/26 history                         | football-data.co.uk (static cached CSVs)              | `./csv_cache/` (read by `footyapi.py`)                          |

## Automation

The [Update Match Data](.github/workflows/update_data.yml) GitHub Action refreshes `data.js`, `fixtures.js` and `bsd_cache/` from the API at **09:00 and 22:00 UK time** (cron runs in UTC, so hours shift by one across GMT/BST) and commits any changes. It needs the `BZZOIRO_API_KEY` repository secret and Actions read/write permission. Trigger it manually from the Actions tab (`workflow_dispatch`) to choose `all` / `results` / `fixtures` or force a `full_refresh`.

## Useful JavaScript console commands below 👍

```js
// Total team corners calculation snippet
const team = "Arsenal";
let hc = 0,
  ac = 0,
  n = 0;
FOOTYDATA.m.forEach((m) => {
  const D = FOOTYDATA;
  const h = typeof m[1] === "number" ? D.t[m[1]] : m[1];
  const a = typeof m[2] === "number" ? D.t[m[2]] : m[2];
  if (h === team) {
    hc += m[8];
    n++;
  }
  if (a === team) {
    ac += m[9];
    n++;
  }
});
console.log(
  `${team}: ${n} matches | Home: ${hc} | Away: ${ac} | Total: ${hc + ac} | Avg per game: ${((hc + ac) / n).toFixed(1)}`,
);
```

```js
(async function analyzeHighGoalAndCornerTeams() {
  // ── 1. Configuration ──────────────────────────────────────────
  const MIN_MATCHES = 5; // Minimum games played to qualify
  const GOAL_THRESHOLD = 2; // At least 2 goals scored by the team
  const CORNER_THRESHOLD = 10; // Over 10 corners
  // Choose corner mode: 'team' (team took >10) or 'match' (total corners in game >10)
  const CORNER_MODE = "match"; // 'match' is standard betting market; switch to 'team' if preferred

  // ── 2. Locate or Fetch Match Data ─────────────────────────────
  let matches = [];

  // Check common in-memory match stores in the FootyStats workspace
  if (typeof MATCHES !== "undefined" && Array.isArray(MATCHES)) {
    matches = MATCHES;
  } else if (typeof allMatches !== "undefined" && Array.isArray(allMatches)) {
    matches = allMatches;
  } else if (window.MATCHES && Array.isArray(window.MATCHES)) {
    matches = window.MATCHES;
  } else if (window.allMatches && Array.isArray(window.allMatches)) {
    matches = window.allMatches;
  } else if (typeof TEST_DATA !== "undefined" && TEST_DATA?.fixtures) {
    matches = TEST_DATA.fixtures;
  }

  // Fallback: If matches aren't stored globally, this snippet needs the app page loaded
  // (26/27 data comes from the Bzzoiro Sports Data API via footyapi.py, not CSV files).
  if (!matches || matches.length === 0) {
    console.log(
      "%c[FootyStats]%c No in-memory matches found; falling back to historical CSVs...",
      "color:#00ff88;font-weight:bold",
      "color:#aaa",
    );
    const leagues = [
      "E0",
      "E1",
      "E2",
      "E3",
      "SP1",
      "SP2",
      "D1",
      "D2",
      "I1",
      "I2",
      "F1",
      "F2",
      "B1",
      "N1",
      "P1",
      "SC0",
      "SC1",
      "T1",
      "G1",
    ];
    const csvPromises = leagues.map((code) =>
      fetch(`./csv_cache/2526_${code}.csv`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => parseCSVMatches(txt))
        .catch(() => []),
    );
    const results = await Promise.all(csvPromises);
    matches = results.flat();
  }

  function parseCSVMatches(csvText) {
    if (!csvText || !csvText.trim()) return [];
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] ? vals[i].trim() : "";
      });
      return obj;
    });
  }

  if (!matches || matches.length === 0) {
    console.error(
      "No match records found. Make sure you are on the FootyStats page and the data has loaded.",
    );
    return;
  }

  // ── 3. Aggregate Team Performance ─────────────────────────────
  const stats = {};

  matches.forEach((m) => {
    // Harmonize keys across raw CSV headers and normalized objects
    const home = m.HomeTeam || m.home || m.Home;
    const away = m.AwayTeam || m.away || m.Away;
    const hg = parseInt(m.FTHG ?? m.home_goals ?? m.homeGoals, 10);
    const ag = parseInt(m.FTAG ?? m.away_goals ?? m.awayGoals, 10);
    const hc = parseInt(m.HC ?? m.home_corners ?? m.homeCorners, 10);
    const ac = parseInt(m.AC ?? m.away_corners ?? m.awayCorners, 10);

    // Skip games without valid scores and corner statistics
    if (!home || !away || isNaN(hg) || isNaN(ag) || isNaN(hc) || isNaN(ac))
      return;

    const totalCorners = hc + ac;

    // Helper to log a team's single appearance
    function record(team, goalsScored, teamCorners) {
      if (!stats[team]) {
        stats[team] = {
          team,
          played: 0,
          goalsScored: 0,
          teamCornersTotal: 0,
          matchCornersTotal: 0,
          goals2Plus: 0,
          teamCorners10Plus: 0,
          matchCorners10Plus: 0,
          bothQualify: 0,
        };
      }
      const t = stats[team];
      t.played += 1;
      t.goalsScored += goalsScored;
      t.teamCornersTotal += teamCorners;
      t.matchCornersTotal += totalCorners;

      const scored2Plus = goalsScored >= GOAL_THRESHOLD;
      const teamCornersOver10 = teamCorners > CORNER_THRESHOLD;
      const matchCornersOver10 = totalCorners > CORNER_THRESHOLD;

      if (scored2Plus) t.goals2Plus += 1;
      if (teamCornersOver10) t.teamCorners10Plus += 1;
      if (matchCornersOver10) t.matchCorners10Plus += 1;

      // Determine match meeting both criteria based on selected mode
      const cornerCheck =
        CORNER_MODE === "team" ? teamCornersOver10 : matchCornersOver10;
      if (scored2Plus && cornerCheck) {
        t.bothQualify += 1;
      }
    }

    record(home, hg, hc);
    record(away, ag, ac);
  });

  // ── 4. Format & Rank Results ──────────────────────────────────
  const summary = Object.values(stats)
    .filter((t) => t.played >= MIN_MATCHES)
    .map((t) => {
      const consistencyPct = ((t.bothQualify / t.played) * 100).toFixed(1);
      const goals2PlusPct = ((t.goals2Plus / t.played) * 100).toFixed(1);
      const cornersOver10Pct = (
        CORNER_MODE === "team"
          ? (t.teamCorners10Plus / t.played) * 100
          : (t.matchCorners10Plus / t.played) * 100
      ).toFixed(1);

      return {
        Team: t.team,
        P: t.played,
        "Both Hit (Hits/P)": `${t.bothQualify}/${t.played}`,
        "Consistency %": parseFloat(consistencyPct),
        "2+ Goals %": `${goals2PlusPct}%`,
        [`Corners >10 % (${CORNER_MODE})`]: `${cornersOver10Pct}%`,
        "Avg Goals": (t.goalsScored / t.played).toFixed(2),
        "Avg Team Corners": (t.teamCornersTotal / t.played).toFixed(1),
        "Avg Match Corners": (t.matchCornersTotal / t.played).toFixed(1),
      };
    })
    // Sort descending by consistency percentage, then by total matches
    .sort((a, b) => b["Consistency %"] - a["Consistency %"] || b["P"] - a["P"]);

  // ── 5. Output Display ─────────────────────────────────────────
  console.clear();
  console.log(
    `%c[FootyStats Analytics]%c Teams scoring >= ${GOAL_THRESHOLD} goals & over ${CORNER_THRESHOLD} corners (${CORNER_MODE} mode) | Min ${MIN_MATCHES} games:`,
    "background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#ffffff;font-weight:bold;",
  );

  if (summary.length === 0) {
    console.warn(
      `No teams found meeting the criteria with >= ${MIN_MATCHES} matches.`,
    );
  } else {
    console.table(summary);
  }

  return summary;
})();
```

```js
(async function analyzeAllSeasonsGoalsAndCorners() {
  // ── 1. Configuration ──────────────────────────────────────────
  const MIN_MATCHES = 20; // Minimum all-time matches to qualify (adjust as needed)
  const GOAL_THRESHOLD = 2; // At least 2 goals scored by the team
  const CORNER_THRESHOLD = 10; // Over 10 corners
  // 'match' = Total match corners > 10 (standard betting market)
  // 'team'  = The individual team took > 10 corners alone
  const CORNER_MODE = "match";

  // Historical season prefixes available in csv_cache/ (26/27 is API-only, see footyapi.py)
  const SEASONS = ["2021", "2122", "2223", "2324", "2425", "2526"];
  const LEAGUES = [
    "E0",
    "E1",
    "E2",
    "E3", // England (Prem, Champ, L1, L2)
    "SP1",
    "SP2", // Spain (La Liga, Segunda)
    "D1",
    "D2", // Germany (Bundesliga 1 & 2)
    "I1",
    "I2", // Italy (Serie A & B)
    "F1",
    "F2", // France (Ligue 1 & 2)
    "B1",
    "N1",
    "P1", // Belgium, Netherlands, Portugal
    "SC0",
    "SC1", // Scotland (Prem, Champ)
    "T1",
    "G1", // Turkey, Greece
  ];

  console.log(
    `%c[FootyStats Analytics]%c Scanning historical data across seasons: ${SEASONS.join(", ")}...`,
    "background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#aaa;",
  );

  // ── 2. Fetch & Parse All Season CSVs ──────────────────────────
  function parseCSV(text, seasonCode) {
    if (!text || !text.trim()) return [];
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = { _season: seasonCode };
      headers.forEach((h, i) => {
        obj[h] = vals[i] ? vals[i].trim() : "";
      });
      return obj;
    });
  }

  // Generate fetch requests for all season + league combinations
  const fetchTasks = [];
  for (const s of SEASONS) {
    for (const l of LEAGUES) {
      fetchTasks.push(
        fetch(`./csv_cache/${s}_${l}.csv`)
          .then((r) => (r.ok ? r.text() : ""))
          .then((txt) => parseCSV(txt, s))
          .catch(() => []),
      );
    }
  }

  const chunks = await Promise.all(fetchTasks);
  const allMatches = chunks.flat();

  if (allMatches.length === 0) {
    console.error(
      "No match records could be loaded from ./csv_cache/. Ensure files exist in this path.",
    );
    return;
  }

  console.log(
    `%c[FootyStats]%c Loaded ${allMatches.length.toLocaleString()} total historical matches. Aggregating stats...`,
    "color:#00ff88;font-weight:bold",
    "color:#aaa",
  );

  // ── 3. Aggregate Performance Across All Seasons ───────────────
  const stats = {};

  allMatches.forEach((m) => {
    const home = m.HomeTeam || m.home;
    const away = m.AwayTeam || m.away;
    const hg = parseInt(m.FTHG ?? m.home_goals, 10);
    const ag = parseInt(m.FTAG ?? m.away_goals, 10);
    const hc = parseInt(m.HC ?? m.home_corners, 10);
    const ac = parseInt(m.AC ?? m.away_corners, 10);
    const season = m._season;

    if (!home || !away || isNaN(hg) || isNaN(ag) || isNaN(hc) || isNaN(ac))
      return;

    const totalCorners = hc + ac;

    function record(team, goalsScored, teamCorners) {
      if (!stats[team]) {
        stats[team] = {
          team,
          played: 0,
          goalsScored: 0,
          teamCornersTotal: 0,
          matchCornersTotal: 0,
          goals2Plus: 0,
          teamCorners10Plus: 0,
          matchCorners10Plus: 0,
          bothQualify: 0,
          seasons: new Set(),
        };
      }
      const t = stats[team];
      t.played += 1;
      t.goalsScored += goalsScored;
      t.teamCornersTotal += teamCorners;
      t.matchCornersTotal += totalCorners;
      if (season) t.seasons.add(season);

      const scored2Plus = goalsScored >= GOAL_THRESHOLD;
      const teamCornersOver10 = teamCorners > CORNER_THRESHOLD;
      const matchCornersOver10 = totalCorners > CORNER_THRESHOLD;

      if (scored2Plus) t.goals2Plus += 1;
      if (teamCornersOver10) t.teamCorners10Plus += 1;
      if (matchCornersOver10) t.matchCorners10Plus += 1;

      const cornerHit =
        CORNER_MODE === "team" ? teamCornersOver10 : matchCornersOver10;
      if (scored2Plus && cornerHit) {
        t.bothQualify += 1;
      }
    }

    record(home, hg, hc);
    record(away, ag, ac);
  });

  // ── 4. Format & Sort Results ──────────────────────────────────
  const summary = Object.values(stats)
    .filter((t) => t.played >= MIN_MATCHES)
    .map((t) => {
      const consistencyPct = ((t.bothQualify / t.played) * 100).toFixed(1);
      const goals2PlusPct = ((t.goals2Plus / t.played) * 100).toFixed(1);
      const cornersOver10Pct = (
        CORNER_MODE === "team"
          ? (t.teamCorners10Plus / t.played) * 100
          : (t.matchCorners10Plus / t.played) * 100
      ).toFixed(1);

      return {
        Team: t.team,
        "Seasons Active": t.seasons.size,
        "Played (P)": t.played,
        "Both Hit (Hits/P)": `${t.bothQualify}/${t.played}`,
        "Consistency %": parseFloat(consistencyPct),
        "2+ Goals %": `${goals2PlusPct}%`,
        [`Corners >10 % (${CORNER_MODE})`]: `${cornersOver10Pct}%`,
        "Avg Goals": (t.goalsScored / t.played).toFixed(2),
        "Avg Team Corners": (t.teamCornersTotal / t.played).toFixed(1),
        "Avg Match Corners": (t.matchCornersTotal / t.played).toFixed(1),
      };
    })
    .sort(
      (a, b) =>
        b["Consistency %"] - a["Consistency %"] ||
        b["Played (P)"] - a["Played (P)"],
    );

  // ── 5. Render Output ──────────────────────────────────────────
  console.clear();
  console.log(
    `%c[All-Time Analysis]%c Teams scoring >= ${GOAL_THRESHOLD} goals & over ${CORNER_THRESHOLD} corners (${CORNER_MODE} mode) across ${SEASONS.length} seasons | Min ${MIN_MATCHES} games:`,
    "background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#ffffff;font-weight:bold;",
  );

  console.table(summary);

  // Expose results on window so you can query or export as CSV
  window.allTimeHighGoalCornerStats = summary;
  console.log(
    "%c[Tip]%c Stored full results in %cwindow.allTimeHighGoalCornerStats%c for further filtering.",
    "color:#00e5ff",
    "color:#aaa",
    "color:#ffb800;font-family:monospace",
    "color:#aaa",
  );

  return summary;
})();
```

## First-Half goals @ 70%+

```js
(() => {
  const THRESHOLD = 70; // Minimum 1st Half Goal %
  const TODAY_ONLY = false; // Set to true to filter to today's fixtures only

  const D = FOOTYDATA;
  const F = FOOTYFIXTURES;
  const team = (t) => (typeof t === "number" ? D.t[t] : t);

  const now = new Date();
  const todayStr =
    String(now.getDate()).padStart(2, "0") +
    "/" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "/" +
    now.getFullYear();

  const hits = (F.fixtures || [])
    .filter((fix) => !TODAY_ONLY || fix.date === todayStr)
    .map((fix) => {
      let hTot = 0,
        hHit = 0;
      let aTot = 0,
        aHit = 0;
      let h2hTot = 0,
        h2hHit = 0;

      for (let i = 0; i < D.m.length; i++) {
        const m = D.m[i];
        const h = team(m[1]);
        const a = team(m[2]);
        const hasHtGoal = (m[6] || 0) + (m[7] || 0) > 0;

        if (h === fix.home) {
          hTot++;
          if (hasHtGoal) hHit++;
        }
        if (a === fix.away) {
          aTot++;
          if (hasHtGoal) aHit++;
        }
        if (h === fix.home && a === fix.away) {
          h2hTot++;
          if (hasHtGoal) h2hHit++;
        }
      }

      const signals = [];
      if (hTot >= 3) signals.push(hHit / hTot);
      if (aTot >= 3) signals.push(aHit / aTot);
      if (h2hTot >= 2) signals.push(h2hHit / h2hTot);
      if (!signals.length) return null;

      const avg = signals.reduce((s, v) => s + v, 0) / signals.length;
      const pct = Math.round(avg * 100);
      if (pct < THRESHOLD) return null;

      return {
        Date: `${fix.date} ${fix.time}`,
        League: fix.league,
        Match: `${fix.home} vs ${fix.away}`,
        "1st Half %": pct,
        "Home HT":
          hTot >= 3
            ? `${Math.round((hHit / hTot) * 100)}% (${hHit}/${hTot})`
            : "—",
        "Away HT":
          aTot >= 3
            ? `${Math.round((aHit / aTot) * 100)}% (${aHit}/${aTot})`
            : "—",
        "H2H HT":
          h2hTot >= 2
            ? `${Math.round((h2hHit / h2hTot) * 100)}% (${h2hHit}/${h2hTot})`
            : "—",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b["1st Half %"] - a["1st Half %"]);

  console.log(
    `Found ${hits.length} fixtures with >= ${THRESHOLD}% 1st Half Goal probability:`,
  );
  console.table(hits);
  return hits;
})();
```

## First-Half goals - Team consistency across all seasons

```js
(() => {
  // 1. Configuration
  const MIN_MATCHES = 20; // Minimum matches played across seasons to qualify
  const MIN_SEASONS = 1; // Set to 2+ to require multi-season history
  const SEASON_HIT_BENCH = 70; // Benchmark % for counting consistent 70%+ seasons
  const SORT_BY = "overall"; // "overall" (% hit rate) or "consistency" (highest floor across seasons)

  const D = FOOTYDATA;
  const teamName = (t) => (typeof t === "number" ? D.t[t] : t);
  const splitLg = (lgName) => {
    const m = (lgName || "").match(/\s+(\d{2}\/\d{2})$/);
    return {
      league: m ? lgName.slice(0, m.index) : lgName || "Unknown",
      season: m ? m[1] : "All",
    };
  };

  const teams = {};
  const leagues = {};

  // 2. Aggregate Every Match Across All Leagues & Seasons
  for (let i = 0; i < D.m.length; i++) {
    const m = D.m[i];
    const h = teamName(m[1]);
    const a = teamName(m[2]);
    const htGoals = (m[6] || 0) + (m[7] || 0);
    const hasHtGoal = htGoals > 0 ? 1 : 0;
    const { league, season } = splitLg(D.l[m[14]]);

    // Aggregate per-league stats
    if (!leagues[league]) {
      leagues[league] = { league, played: 0, hits: 0, htGoals: 0, seasons: {} };
    }
    const lgRec = leagues[league];
    lgRec.played++;
    lgRec.hits += hasHtGoal;
    lgRec.htGoals += htGoals;
    if (!lgRec.seasons[season]) lgRec.seasons[season] = { played: 0, hits: 0 };
    lgRec.seasons[season].played++;
    lgRec.seasons[season].hits += hasHtGoal;

    // Helper for Home & Away team aggregation
    function recordTeam(name, isHome) {
      if (!teams[name]) {
        teams[name] = {
          name,
          leagues: new Set(),
          played: 0,
          hits: 0,
          htGoals: 0,
          hPlayed: 0,
          hHits: 0,
          aPlayed: 0,
          aHits: 0,
          seasons: {},
        };
      }
      const t = teams[name];
      t.leagues.add(league);
      t.played++;
      t.hits += hasHtGoal;
      t.htGoals += htGoals;
      if (isHome) {
        t.hPlayed++;
        t.hHits += hasHtGoal;
      } else {
        t.aPlayed++;
        t.aHits += hasHtGoal;
      }
      if (!t.seasons[season]) t.seasons[season] = { played: 0, hits: 0 };
      t.seasons[season].played++;
      t.seasons[season].hits += hasHtGoal;
    }

    recordTeam(h, true);
    recordTeam(a, false);
  }

  // 3. Format & Rank Teams
  const teamRows = Object.values(teams)
    .filter(
      (t) =>
        t.played >= MIN_MATCHES && Object.keys(t.seasons).length >= MIN_SEASONS,
    )
    .map((t) => {
      const seasonList = Object.entries(t.seasons)
        .filter(([, s]) => s.played >= 5) // Ignore partial 1-4 game fragments
        .map(([sName, s]) => ({
          season: sName,
          pct: (s.hits / s.played) * 100,
        }));

      const overallPct = (t.hits / t.played) * 100;
      const minSeasonPct = seasonList.length
        ? Math.min(...seasonList.map((s) => s.pct))
        : overallPct;
      const highSeasons = seasonList.filter(
        (s) => s.pct >= SEASON_HIT_BENCH,
      ).length;

      return {
        Team: t.name,
        Leagues: [...t.leagues].join(", "),
        Seasons: Object.keys(t.seasons).length,
        Played: t.played,
        "1st Half %": Number(overallPct.toFixed(1)),
        "Hits/P": `${t.hits}/${t.played}`,
        "Home HT %": t.hPlayed
          ? `${Math.round((t.hHits / t.hPlayed) * 100)}%`
          : "—",
        "Away HT %": t.aPlayed
          ? `${Math.round((t.aHits / t.aPlayed) * 100)}%`
          : "—",
        "Avg HT Goals": Number((t.htGoals / t.played).toFixed(2)),
        [`Seasons ≥${SEASON_HIT_BENCH}%`]: seasonList.length
          ? `${highSeasons}/${seasonList.length}`
          : "—",
        "Lowest Season %": Number(minSeasonPct.toFixed(1)),
      };
    })
    .sort((a, b) =>
      SORT_BY === "consistency"
        ? b["Lowest Season %"] - a["Lowest Season %"] ||
          b["1st Half %"] - a["1st Half %"]
        : b["1st Half %"] - a["1st Half %"] ||
          b["Lowest Season %"] - a["Lowest Season %"] ||
          b.Played - a.Played,
    );

  // 4. Format & Rank Leagues
  const leagueRows = Object.values(leagues)
    .map((l) => {
      const seasonPcts = Object.values(l.seasons).map(
        (s) => (s.hits / s.played) * 100,
      );
      const overallPct = (l.hits / l.played) * 100;
      return {
        League: l.league,
        Seasons: Object.keys(l.seasons).length,
        Matches: l.played,
        "1st Half %": Number(overallPct.toFixed(1)),
        "Avg HT Goals": Number((l.htGoals / l.played).toFixed(2)),
        "Lowest Season %": Number(Math.min(...seasonPcts).toFixed(1)),
        "Highest Season %": Number(Math.max(...seasonPcts).toFixed(1)),
      };
    })
    .sort((a, b) => b["1st Half %"] - a["1st Half %"]);

  // 5. Display Tables & Export Helper ─────────────────────────
  console.clear();
  console.log(
    `%c[FootyStats 1st Half Goals]%c Most consistent Leagues across all seasons (${leagueRows.length} competitions):`,
    "background:#39ff14;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;",
  );
  console.table(leagueRows);

  console.log(
    `%c[FootyStats 1st Half Goals]%c Top 50 most consistent Teams (from ${teamRows.length} qualifying with ≥${MIN_MATCHES} games):`,
    "background:#00f0ff;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;",
  );
  console.table(teamRows.slice(0, 50));

  window.htConsistency = { teams: teamRows, leagues: leagueRows };
  console.log(
    "%c[Tip]%c Full results stored in %cwindow.htConsistency%c — e.g. filter by league: %cwindow.htConsistency.teams.filter(t => t.Leagues.includes('Bundesliga'))",
    "color:#00f0ff",
    "color:#aaa",
    "color:#ffe600;font-family:monospace",
    "color:#aaa",
    "color:#39ff14;font-family:monospace",
  );

  return window.htConsistency;
})();
```

## 1+ HT goals, BTTS and 9+ corners

```js
window.findComboMatchups = function ({
  minMeetings = 4, // Minimum H2H meetings across all seasons to rank consistency
  byVenue = false, // false = combine both home/away legs of a pairing; true = exact Home vs Away venue only
} = {}) {
  const D = FOOTYDATA;
  const teamName = (t) => (typeof t === "number" ? D.t[t] : t);

  const parseDateTs = (dStr) => {
    if (!dStr) return 0;
    const p = dStr.split("/");
    if (p.length !== 3) return 0;
    const year =
      p[2].length === 2 ? 2000 + parseInt(p[2], 10) : parseInt(p[2], 10);
    return new Date(year, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
  };

  const matchupsMap = {};
  const qualifyingMatches = [];

  for (let i = 0; i < D.m.length; i++) {
    const m = D.m[i];
    if (!m[5]) continue; // Skip unfinished fixtures

    const date = m[0] || "";
    const home = teamName(m[1]);
    const away = teamName(m[2]);
    const fthg = m[3] || 0;
    const ftag = m[4] || 0;
    const hthg = m[6] || 0;
    const htag = m[7] || 0;
    const hc = m[8] || 0;
    const ac = m[9] || 0;
    const tc = m[10] != null ? m[10] : hc + ac;
    const league = D.l[m[14]] || "Unknown";

    const hasHtGoal = hthg + htag >= 1;
    const has9Corners = tc >= 9;
    const isBtts = fthg >= 1 && ftag >= 1;
    const allHit = hasHtGoal && has9Corners && isBtts;

    // 1. Collect complete list of qualifying matches
    if (allHit) {
      qualifyingMatches.push({
        Date: date,
        _ts: parseDateTs(date),
        League: league,
        Home: home,
        Away: away,
        FT: `${fthg}-${ftag}`,
        HT: `${hthg}-${htag}`,
        TotalGoals: fthg + ftag,
        Corners: tc,
        "Corners Split": `${hc}-${ac}`,
      });
    }

    // 2. Aggregate per-matchup consistency across all seasons
    const pairKey = byVenue
      ? `${home} (H) vs ${away} (A)`
      : [home, away].sort().join(" vs ");

    if (!matchupsMap[pairKey]) {
      matchupsMap[pairKey] = {
        matchup: pairKey,
        leagues: new Set(),
        meetings: 0,
        comboHits: 0,
        htHits: 0,
        c9Hits: 0,
        bttsHits: 0,
        totalGoals: 0,
        totalCorners: 0,
      };
    }

    const rec = matchupsMap[pairKey];
    rec.leagues.add(league.replace(/\s+\d{2}\/\d{2}$/, ""));
    rec.meetings++;
    if (hasHtGoal) rec.htHits++;
    if (has9Corners) rec.c9Hits++;
    if (isBtts) rec.bttsHits++;
    if (allHit) rec.comboHits++;
    rec.totalGoals += fthg + ftag;
    rec.totalCorners += tc;
  }

  // Sort qualifying matches newest first and strip internal timestamp key
  qualifyingMatches.sort((a, b) => b._ts - a._ts);
  const allQualifyingMatches = qualifyingMatches.map(({ _ts, ...row }) => row);

  // Rank matchups by Combo Hit %, then total Combo Hits / Meetings
  const consistentMatchups = Object.values(matchupsMap)
    .filter((r) => r.meetings >= minMeetings && r.comboHits > 0)
    .map((r) => ({
      Matchup: r.matchup,
      League: [...r.leagues].join(", "),
      Meetings: r.meetings,
      "All 3 Hits": `${r.comboHits}/${r.meetings}`,
      "Consistency %": Number(((r.comboHits / r.meetings) * 100).toFixed(1)),
      "1st Half %": `${Math.round((r.htHits / r.meetings) * 100)}%`,
      "9+ Corners %": `${Math.round((r.c9Hits / r.meetings) * 100)}%`,
      "BTTS %": `${Math.round((r.bttsHits / r.meetings) * 100)}%`,
      "Avg Goals": Number((r.totalGoals / r.meetings).toFixed(2)),
      "Avg Corners": Number((r.totalCorners / r.meetings).toFixed(1)),
    }))
    .sort((a, b) => {
      if (b["Consistency %"] !== a["Consistency %"]) {
        return b["Consistency %"] - a["Consistency %"];
      }
      return b.Meetings - a.Meetings;
    });

  // Expose full outputs globally for further inspection or export
  window.comboMatchups = consistentMatchups;
  window.comboMatches = allQualifyingMatches;

  console.clear();
  console.log(
    `%c[1+ HT Goal · 9+ Corners · BTTS]%c ${consistentMatchups.length} consistent matchups (min ${minMeetings} meetings, mode: ${byVenue ? "Exact Venue" : "Combined Home/Away"}):`,
    "background:#39ff14;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;",
  );
  console.table(consistentMatchups);

  console.log(
    `%c[Complete Match List]%c ${allQualifyingMatches.length.toLocaleString()} total matches meeting all 3 criteria across all seasons:`,
    "background:#00f0ff;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;",
  );
  console.table(allQualifyingMatches);

  console.log(
    "%c[Saved Globals]%c window.comboMatchups (matchup rankings) & window.comboMatches (all qualifying games). Re-run anytime with findComboMatchups({ minMeetings: 6, byVenue: true }).",
    "color:#ffe600",
    "color:#aaa",
  );

  return { consistentMatchups, allQualifyingMatches };
};
// Run immediately with defaults
findComboMatchups();
```

## Quick Commands After Pasting

Export ALL matches across all seasons to CSV

```js
downloadComboCSV("matches");
```

Export ALL consistent matchups to CSV

```js
downloadComboCSV('matchups')
Filter for 5+ seasons of consistency: console.table(window.comboMatchups.filter(m => parseInt(m.Seasons, 10) >= 5))
```

## All fixtures 80%+ HT goals

```js
(() => {
  const D = typeof FOOTYDATA !== "undefined" ? FOOTYDATA : null;
  const F = typeof FOOTYFIXTURES !== "undefined" ? FOOTYFIXTURES : null;

  const fixturesList = F ? F.fixtures || F.matches : null;

  if (!D || !fixturesList) {
    return console.error(
      "FOOTYDATA or FOOTYFIXTURES not found in the global scope. Make sure DevTools context is set to 'top' on the FootyStats tab.",
    );
  }

  const teamName = (id) => D.t[id];

  // Replicates the 1st half goal probability model in app.js
  function calcFirstHalfGoal(homeTeam, awayTeam) {
    let hTot = 0,
      hHit = 0;
    let aTot = 0,
      aHit = 0;
    let h2hTot = 0,
      h2hHit = 0;

    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const h = teamName(m[1]);
      const a = teamName(m[2]);
      const hadHtGoal = (m[6] || 0) + (m[7] || 0) > 0;

      if (h === homeTeam) {
        hTot++;
        if (hadHtGoal) hHit++;
      }
      if (a === awayTeam) {
        aTot++;
        if (hadHtGoal) aHit++;
      }
      if (h === homeTeam && a === awayTeam) {
        h2hTot++;
        if (hadHtGoal) h2hHit++;
      }
    }

    const signals = [];
    if (hTot >= 3) signals.push(hHit / hTot);
    if (aTot >= 3) signals.push(aHit / aTot);
    if (h2hTot >= 2) signals.push(h2hHit / h2hTot);

    if (!signals.length) return null;
    const avg = signals.reduce((sum, s) => sum + s, 0) / signals.length;
    const pct = Math.round(avg * 100);

    return {
      pct,
      homeForm: `${Math.round((hHit / (hTot || 1)) * 100)}% (${hHit}/${hTot})`,
      awayForm: `${Math.round((aHit / (aTot || 1)) * 100)}% (${aHit}/${aTot})`,
      h2h:
        h2hTot >= 2
          ? `${Math.round((h2hHit / h2hTot) * 100)}% (${h2hHit}/${h2hTot})`
          : "N/A",
    };
  }

  const results = fixturesList
    .map((fix) => {
      const stats = calcFirstHalfGoal(fix.home, fix.away);
      if (!stats || stats.pct < 80) return null;
      return {
        Date: fix.date,
        Time: fix.time || "-",
        League: fix.league,
        Match: `${fix.home} vs ${fix.away}`,
        "1st Half Goal %": `${stats.pct}%`,
        "Home Venue Rate": stats.homeForm,
        "Away Venue Rate": stats.awayForm,
        "H2H Rate": stats.h2h,
        _sortPct: stats.pct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b._sortPct - a._sortPct)
    .map(({ _sortPct, ...row }) => row);

  console.log(
    `%c Found ${results.length} fixtures with ≥ 80% 1st Half Goal Chance:`,
    "color:#00f0ff; font-weight:bold; font-size:14px;",
  );
  console.table(results);
  return results;
})();
```

## Fixtures with a 60+ percent of having 10 or more corners

```js
(() => {
  const D = window.FOOTYDATA;
  const F = window.FOOTYFIXTURES;
  const fixtures = F && (F.fixtures || F.matches);
  if (!D || !D.m || !fixtures) {
    console.error(
      "FOOTYDATA or FOOTYFIXTURES not loaded. Make sure you are on the FootyStats page.",
    );
    return;
  }

  const teamName = (t) => (typeof t === "number" ? D.t[t] : t);
  const stats = {};
  const ensure = (n) =>
    stats[n] || (stats[n] = { hg: 0, hh: 0, htc: 0, ag: 0, ah: 0, atc: 0 });

  for (const m of D.m) {
    const hc = m[8],
      ac = m[9],
      tc = m[10],
      c10 = m[13];
    if (hc == null || ac == null || tc == null || tc <= 0) continue; // skip matches without corner data
    const hit = c10 === 1 || c10 === true || tc >= 10 ? 1 : 0;
    const hs = ensure(teamName(m[1]));
    hs.hg++;
    hs.hh += hit;
    hs.htc += tc;
    const as = ensure(teamName(m[2]));
    as.ag++;
    as.ah += hit;
    as.atc += tc;
  }

  const results = [];
  for (const fx of fixtures) {
    const hs = stats[fx.home];
    const as = stats[fx.away];
    if (!hs || !as || hs.hg === 0 || as.ag === 0) continue;

    const homePct = (hs.hh / hs.hg) * 100;
    const awayPct = (as.ah / as.ag) * 100;
    const combinedPct = (homePct + awayPct) / 2;

    if (combinedPct > 60) {
      results.push({
        Date: fx.date + (fx.time ? " " + fx.time : ""),
        League: fx.league || "",
        Fixture: `${fx.home} vs ${fx.away}`,
        "10+ Corners %": Number(combinedPct.toFixed(1)),
        "Home 10+%": `${homePct.toFixed(0)}% (${hs.hh}/${hs.hg})`,
        "Away 10+%": `${awayPct.toFixed(0)}% (${as.ah}/${as.ag})`,
        "Avg Corners": Number(
          ((hs.htc / hs.hg + as.atc / as.ag) / 2).toFixed(2),
        ),
      });
    }
  }

  results.sort((a, b) => b["10+ Corners %"] - a["10+ Corners %"]);
  console.log(`Found ${results.length} fixtures with >60% 10+ corners rate:`);
  console.table(results);
})();
```

> Change combinedPct > 60 to combinedPct >= 60 if you want to include fixtures at exactly 60.0%.
> If you want both teams individually over 60% instead of the combined average, replace if (combinedPct > 60) with if (homePct > 60 && awayPct > 60).

## All positive value edge fixtures (Model % > bookmaker-implied %)

```js
(() => {
  const btns = document.querySelectorAll(
    '[data-action="toggle-leg"], [data-action="quick-coupon"]',
  );
  if (!btns.length) {
    console.warn(
      "Switch to the 'Upcoming Fixtures' or 'Coupon' tab first, then re-run this command.",
    );
    return;
  }

  const seen = new Set();
  const edges = [];

  for (const btn of btns) {
    const mid = btn.getAttribute("data-mid") || "";
    const pick = btn.getAttribute("data-pick") || "";
    const key = `${mid}|${pick}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const prob = parseFloat(btn.getAttribute("data-prob"));
    const odds = parseFloat(btn.getAttribute("data-odds"));
    if (!prob || !odds || odds <= 1) continue;

    const impliedPct = (1 / odds) * 100;
    const edgePct = prob - impliedPct;
    const evPct = ((prob / 100) * odds - 1) * 100;

    if (edgePct > 0) {
      const home = btn.getAttribute("data-home") || "";
      const away = btn.getAttribute("data-away") || "";
      const pickLabel =
        pick === "1"
          ? `1 (${home})`
          : pick === "2"
            ? `2 (${away})`
            : "X (Draw)";
      edges.push({
        Date: `${btn.getAttribute("data-date") || ""} ${btn.getAttribute("data-time") || ""}`.trim(),
        League: btn.getAttribute("data-lg") || "",
        Fixture: `${home} vs ${away}`,
        Pick: pickLabel,
        "Model %": Number(prob.toFixed(1)),
        "Implied %": Number(impliedPct.toFixed(1)),
        "Edge %": Number(edgePct.toFixed(1)),
        "Book Odds": Number(odds.toFixed(2)),
        "Fair Odds": btn.getAttribute("data-fair") || "—",
        "EV %": Number(evPct.toFixed(1)),
      });
    }
  }

  edges.sort((a, b) => b["Edge %"] - a["Edge %"]);
  console.log(`Found ${edges.length} positive Value Edge picks:`);
  console.table(edges);
})();
```

> Change if (edgePct > 0) to if (edgePct >= 5) if you only want strong edges of +5% or higher.

## Flag any upcoming fixtures with incomplete or very little historical data

```js
(() => {
  const D = window.FOOTYDATA;
  const F = window.FOOTYFIXTURES;
  const fixtures = F && (F.fixtures || F.matches);
  if (!D || !D.m || !fixtures) {
    console.error(
      "FOOTYDATA or FOOTYFIXTURES not loaded. Make sure you are on the FootyStats page.",
    );
    return;
  }

  const teamName = (t) => (typeof t === "number" ? D.t[t] : t);
  const counts = {};
  const ensure = (n) => counts[n] || (counts[n] = { h: 0, a: 0, ch: 0, ca: 0 });

  for (const m of D.m) {
    const hs = ensure(teamName(m[1]));
    const as = ensure(teamName(m[2]));
    hs.h++;
    as.a++;
    if (m[8] != null && m[9] != null && m[10] != null && m[10] > 0) {
      hs.ch++;
      as.ca++;
    }
  }

  const issues = [];
  for (const fx of fixtures) {
    const hs = counts[fx.home] || { h: 0, a: 0, ch: 0, ca: 0 };
    const as = counts[fx.away] || { h: 0, a: 0, ch: 0, ca: 0 };
    const flags = [];
    if (hs.h === 0) flags.push("No home history");
    else if (hs.h < 5) flags.push(`Low home sample (${hs.h})`);
    if (as.a === 0) flags.push("No away history");
    else if (as.a < 5) flags.push(`Low away sample (${as.a})`);
    if (hs.ch === 0 || as.ca === 0) flags.push("Missing corner stats");

    if (flags.length) {
      issues.push({
        Date: `${fx.date || ""} ${fx.time || ""}`.trim(),
        League: fx.league || "",
        Fixture: `${fx.home} vs ${fx.away}`,
        "Home Games": hs.h,
        "Away Games": as.a,
        "Edge Case(s)": flags.join(", "),
      });
    }
  }

  console.log(`Found ${issues.length} fixture data edge cases:`);
  console.table(issues);
})();
```
## Random corner picks

```js
(() => {
  const MIN_PCT = 60; // set your minimum percentage
  const PICK_COUNT = 6; // set the amount of fixtures you want to display
  const TODAY_ONLY = false; // set to true to limit picks to today's fixtures

  if (typeof FOOTYDATA === "undefined" || typeof FOOTYFIXTURES === "undefined") {
    console.error("FOOTYDATA or FOOTYFIXTURES not found — run this on the FootyStats page.");
    return;
  }

  const D = FOOTYDATA;
  const teams = D.t;
  const homeStats = {};
  const awayStats = {};
  const h2hStats = {};

  for (const m of D.m) {
    const h = teams[m[1]];
    const a = teams[m[2]];
    const c10 = m[13] === 1 || (m[8] || 0) + (m[9] || 0) >= 10 ? 1 : 0;

    (homeStats[h] ||= { n: 0, c10: 0 }).n++;
    homeStats[h].c10 += c10;

    (awayStats[a] ||= { n: 0, c10: 0 }).n++;
    awayStats[a].c10 += c10;

    const k = `${h}|${a}`;
    (h2hStats[k] ||= { n: 0, c10: 0 }).n++;
    h2hStats[k].c10 += c10;
  }

  const now = new Date();
  const todayStr =
    String(now.getDate()).padStart(2, "0") +
    "/" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "/" +
    now.getFullYear();

  const qualifying = [];
  for (const fix of FOOTYFIXTURES.fixtures || []) {
    if (TODAY_ONLY && fix.date !== todayStr) continue;

    const hs = homeStats[fix.home];
    const as = awayStats[fix.away];
    const h2h = h2hStats[`${fix.home}|${fix.away}`];

    let wSum = 0;
    let valSum = 0;
    if (hs && hs.n >= 3) {
      valSum += (hs.c10 / hs.n) * 0.4;
      wSum += 0.4;
    }
    if (as && as.n >= 3) {
      valSum += (as.c10 / as.n) * 0.4;
      wSum += 0.4;
    }
    if (h2h && h2h.n >= 2) {
      valSum += (h2h.c10 / h2h.n) * 0.2;
      wSum += 0.2;
    }
    if (!wSum) continue;

    const pct = Math.round((valSum / wSum) * 100);
    if (pct >= MIN_PCT) {
      qualifying.push({
        League: fix.league,
        Date: fix.date,
        Time: fix.time || "TBD",
        Match: `${fix.home} vs ${fix.away}`,
        "10+ Corners %": `${pct}%`,
        "Data (H / A / H2H)": `${hs?.n || 0} / ${as?.n || 0} / ${h2h?.n || 0}`,
      });
    }
  }

  // Fisher-Yates shuffle for uniform random picks
  for (let i = qualifying.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qualifying[i], qualifying[j]] = [qualifying[j], qualifying[i]];
  }

  const picks = qualifying.slice(0, PICK_COUNT);
  console.log(
    `Found ${qualifying.length} upcoming fixtures >= ${MIN_PCT}% for 10+ corners — showing ${picks.length} random picks:`,
  );
  console.table(picks);
})();
```

## First-Half goals 6 random picks 80% plus

```js
(() => {
  const MIN_PCT = 80; // set your minimum percentage
  const PICK_COUNT = 6; // set the amount of fixtures you want to display
  const TODAY_ONLY = false; // set to true to limit picks to today's fixtures

  if (typeof FOOTYDATA === "undefined" || typeof FOOTYFIXTURES === "undefined") {
    console.error("FOOTYDATA or FOOTYFIXTURES not found — run this on the FootyStats page.");
    return;
  }

  const D = FOOTYDATA;
  const teams = D.t;
  const homeStats = {};
  const awayStats = {};
  const h2hStats = {};

  for (const m of D.m) {
    const h = teams[m[1]];
    const a = teams[m[2]];
    const htGoal = (m[6] || 0) + (m[7] || 0) > 0 ? 1 : 0;

    (homeStats[h] ||= { n: 0, ht: 0 }).n++;
    homeStats[h].ht += htGoal;

    (awayStats[a] ||= { n: 0, ht: 0 }).n++;
    awayStats[a].ht += htGoal;

    const k = `${h}|${a}`;
    (h2hStats[k] ||= { n: 0, ht: 0 }).n++;
    h2hStats[k].ht += htGoal;
  }

  const now = new Date();
  const todayStr =
    String(now.getDate()).padStart(2, "0") +
    "/" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "/" +
    now.getFullYear();

  const qualifying = [];
  for (const fix of FOOTYFIXTURES.fixtures || []) {
    if (TODAY_ONLY && fix.date !== todayStr) continue;

    const hs = homeStats[fix.home];
    const as = awayStats[fix.away];
    const h2h = h2hStats[`${fix.home}|${fix.away}`];

    let wSum = 0;
    let valSum = 0;
    if (hs && hs.n >= 3) {
      valSum += (hs.ht / hs.n) * 0.4;
      wSum += 0.4;
    }
    if (as && as.n >= 3) {
      valSum += (as.ht / as.n) * 0.4;
      wSum += 0.4;
    }
    if (h2h && h2h.n >= 2) {
      valSum += (h2h.ht / h2h.n) * 0.2;
      wSum += 0.2;
    }
    if (!wSum) continue;

    const pct = Math.round((valSum / wSum) * 100);
    if (pct >= MIN_PCT) {
      qualifying.push({
        League: fix.league,
        Date: fix.date,
        Time: fix.time || "TBD",
        Match: `${fix.home} vs ${fix.away}`,
        "1st Half Goal %": `${pct}%`,
        "Data (H / A / H2H)": `${hs?.n || 0} / ${as?.n || 0} / ${h2h?.n || 0}`,
      });
    }
  }

  // Fisher-Yates shuffle for uniform random picks
  for (let i = qualifying.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qualifying[i], qualifying[j]] = [qualifying[j], qualifying[i]];
  }

  const picks = qualifying.slice(0, PICK_COUNT);
  console.log(
    `Found ${qualifying.length} upcoming fixtures >= ${MIN_PCT}% for a 1st half goal — showing ${picks.length} random picks:`,
  );
  console.table(picks);
})();
```
