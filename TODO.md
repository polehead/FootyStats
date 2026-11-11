## Completed Fixes

- [x] **Selected-Season `2+ W` Badges on `Wins 2+ Goals` Tab**:
  - Extended `computeWins2PlusStats()` in `app.js` to track per-season/league (`byLeague`) `Home 2+ W` and `Away 2+ W` stats alongside overall historical totals.
  - Updated `formatWin2VenuePill()` and `renderTeam()` (passing `lg` from both initial `render()` and lazy `.season-tab-btn` switches) so `.team-win2-badges` renders identical `.team-win2-pill` badges for both overall stats and the currently selected season.
  - Bumped Service Worker cache version to `footystats-v13` in `sw.js`.

- [x] **Cache-First Historical CSV Loading (`export_data.py`)**:
  - Updated `fetch_csv_text()` and `build_all_data()` in `export_data.py` so only `26/27` (`CURRENT_SEASON = "2627"`) URLs are refreshed from `football-data.co.uk` on each run.
  - Historical seasons (`19/20`–`25/26`) read directly from `./csv_cache` whenever a non-empty cached file already exists, downloading only if missing or empty on disk while continuing to export all seasons into `data.js`.

- [x] **Decoupled Overall 2+ Win Logic (`Wins 2+ Goals` Isolation)**:
  - Removed `w2h` and `w2a` tracking from `TEAM_STATS` (`computeTeamStats()`), keeping the predictive engine (`predictMatchOutright()`) focused purely on neutral venue attack/defense rates and H2H records.
  - Added a dedicated `WINS_2PLUS_STATS` store and `computeWins2PlusStats()` aggregator scoped exclusively to the **Wins 2+ Goals** tab, surfacing overall `Home 2+ W` and `Away 2+ W` percentage pills inside `.team-name-header` only when viewing `Wins 2+ Goals`.
  - Updated **Upcoming Fixtures** cards (`renderFixtureCard` -> `renderVenueFormHint`) to display predictive-aligned venue form (`Home Win: X% · Y.YY GF/g` / `Away Win: X% · Y.YY GF/g`) instead of `2+ W` rates.
  - Bumped Service Worker cache version to `footystats-v12` and updated `index.html` metadata.

- [x] **Complete Separation of Concerns (JavaScript Extraction)**:
  - Extracted all inline JavaScript (~96,000 characters) from `index.html` into a dedicated, modular `app.js`.
  - Re-organized `app.js` into structured sections: Compact Match Schema (`M`), State & Datasets, Historical Team Aggregator, Predictive Math Engine (Bivariate Poisson + H2H), Utilities, Coupon & Bet Builder, View Renderers, Event Delegation, Application Bootstrap (`init`), and PWA Lifecycle (`initPWA`).
  - Streamlined `index.html` from ~2,890 lines down to 308 lines of pure markup with clean external script tags (`data.js`, `fixtures.js`, `app.js`).
  - Updated `sw.js` service worker to pre-cache `./app.js` and incremented cache version to `footystats-v9` for offline integrity.

- [x] **Data-Driven Coupon & Bet Builder**:
  - **Today Only Mobile Toggle Polish**:
    - Replaced the nested unstyled wrapper (`<div class="stat-chip stat-chip-toggle"><label class="today-toggle-wrap">...`) with a unified, direct `<label class="stat-chip stat-chip-toggle coupon-toggle" for="filter-today-only">`.
    - Shortened the verbose `Today Only (DD/MM/YYYY)` string (~235px) to a compact, non-wrapping `Today Only` label (~115px), eliminating mobile line collisions.
    - Added `position: relative;`, `flex-shrink: 0;`, and vertical centering to `.stat-chip-toggle` and responsive `width: 28px; height: 16px;` track scaling on mobile ($le 480$px).
    - Added theme-synchronized neon blue active glow (`.coupon-toggle:has(input:checked)`) for the toggle when in the Coupon tab.
  - Added new **Coupon** tab in the main tab-bar with active **Neon Blue** styling (`#00b4ff` and `var(--glow-blue)`) and live selection count badge.
  - Implemented mathematical match prediction engine using **bivariate Poisson goal distributions** ($lambda$ home, $mu$ away) calibrated against historical venue attack/defense rates and empirical Head-to-Head records.
  - Interactive 1X2 outcome buttons (Home Win, Draw, Away Win) with live model win probabilities, fair decimal odds ($1/P$), market odds comparison, and positive Value Edge indicators.
  - Built sticky Bet Builder / Accumulator slip on desktop and responsive stack on mobile.
  - Multi-bet accumulator calculations: cumulative win probability ($prod P_i$), color-graded likelihood meter, combined fair odds, combined bookmaker odds, and real-time stake calculator with potential payout and profit.
  - Integrated quick-add 1X2 chip bar directly into the **Upcoming Fixtures** cards.
  - One-click "Copy Accumulator Summary" with clipboard integration and `localStorage` persistence (`footystats_coupon_slip`).
  - **Mobile Refinements & Bottom Sheet Drawer**:
    - Replaced the single-column buried bet slip with a floating sticky bottom pill bar (`.coupon-mobile-bar`) displaying active selection count, cumulative win probability, and combined odds.
    - Integrated smooth slide-up bottom sheet modal (`.coupon-slip-column.drawer-open`) with drawer drag handle, explicit "✕ Close" button, and darkened blur backdrop (`.coupon-drawer-backdrop`).
    - Eliminated redundant horizontal container padding on `.coupon-container` to prevent lateral squishing on narrow devices.
    - Added responsive outcome pick labels: desktop shows full ("1 · Home Win", "X · Draw", "2 · Away Win"), mobile automatically condenses to ("1 · Home", "X · Draw", "2 · Away").
    - Added flex-wrap and overflow protection to team names, expected goals (`.coupon-xg-labels`), and fixture chips to eliminate horizontal collisions.
- [x] **PWA Install Banner Cleanup**: Removed duplicate `#pwa-install-banner` markup in `index.html`.
- [x] **Install Prompt Diagnostic**: Documented that `Banner not shown: beforeinstallpromptevent.preventDefault() called...` is Chromium's expected diagnostic when custom in-app banners suppress the browser's default bar via `e.preventDefault()`.
- [x] **Standalone Mode Guard**: Suppressed install banner automatically if the app is already running in standalone PWA mode (`display-mode: standalone`).
- [x] **iOS Safari Fallback**: Added fallback instructions ("Tap Share ⎋ then 'Add to Home Screen' ⊞") for WebKit where `beforeinstallprompt` is unsupported.
- [x] **7-Day Dismissal Cooldown**: Added `localStorage` tracking so dismissed banners don't persistently prompt on reload.

## Helpful Queries

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

```
(async function analyzeHighGoalAndCornerTeams() {
  // ── 1. Configuration ──────────────────────────────────────────
  const MIN_MATCHES = 5;          // Minimum games played to qualify
  const GOAL_THRESHOLD = 2;       // At least 2 goals scored by the team
  const CORNER_THRESHOLD = 10;    // Over 10 corners
  // Choose corner mode: 'team' (team took >10) or 'match' (total corners in game >10)
  const CORNER_MODE = 'match';    // 'match' is standard betting market; switch to 'team' if preferred

  // ── 2. Locate or Fetch Match Data ─────────────────────────────
  let matches = [];

  // Check common in-memory match stores in the FootyStats workspace
  if (typeof MATCHES !== 'undefined' && Array.isArray(MATCHES)) {
    matches = MATCHES;
  } else if (typeof allMatches !== 'undefined' && Array.isArray(allMatches)) {
    matches = allMatches;
  } else if (window.MATCHES && Array.isArray(window.MATCHES)) {
    matches = window.MATCHES;
  } else if (window.allMatches && Array.isArray(window.allMatches)) {
    matches = window.allMatches;
  } else if (typeof TEST_DATA !== 'undefined' && TEST_DATA?.fixtures) {
    matches = TEST_DATA.fixtures;
  }

  // Fallback: If matches aren't stored globally, fetch active season CSVs directly
  if (!matches || matches.length === 0) {
    console.log('%c[FootyStats]%c Fetching 26/27 season CSV data...', 'color:#00ff88;font-weight:bold', 'color:#aaa');
    const leagues = ['E0', 'E1', 'E2', 'E3', 'SP1', 'SP2', 'D1', 'D2', 'I1', 'I2', 'F1', 'F2', 'B1', 'N1', 'P1', 'SC0', 'SC1', 'T1', 'G1'];
    const csvPromises = leagues.map(code =>
      fetch(`./csv_cache/2627_${code}.csv`)
        .then(r => r.ok ? r.text() : '')
        .then(txt => parseCSVMatches(txt))
        .catch(() => [])
    );
    const results = await Promise.all(csvPromises);
    matches = results.flat();
  }

  function parseCSVMatches(csvText) {
    if (!csvText || !csvText.trim()) return [];
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ? vals[i].trim() : ''; });
      return obj;
    });
  }

  if (!matches || matches.length === 0) {
    console.error('No match records found. Make sure you are on the FootyStats page and the data has loaded.');
    return;
  }

  // ── 3. Aggregate Team Performance ─────────────────────────────
  const stats = {};

  matches.forEach(m => {
    // Harmonize keys across raw CSV headers and normalized objects
    const home = m.HomeTeam || m.home || m.Home;
    const away = m.AwayTeam || m.away || m.Away;
    const hg = parseInt(m.FTHG ?? m.home_goals ?? m.homeGoals, 10);
    const ag = parseInt(m.FTAG ?? m.away_goals ?? m.awayGoals, 10);
    const hc = parseInt(m.HC ?? m.home_corners ?? m.homeCorners, 10);
    const ac = parseInt(m.AC ?? m.away_corners ?? m.awayCorners, 10);

    // Skip games without valid scores and corner statistics
    if (!home || !away || isNaN(hg) || isNaN(ag) || isNaN(hc) || isNaN(ac)) return;

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
          bothQualify: 0
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
      const cornerCheck = (CORNER_MODE === 'team') ? teamCornersOver10 : matchCornersOver10;
      if (scored2Plus && cornerCheck) {
        t.bothQualify += 1;
      }
    }

    record(home, hg, hc);
    record(away, ag, ac);
  });

  // ── 4. Format & Rank Results ──────────────────────────────────
  const summary = Object.values(stats)
    .filter(t => t.played >= MIN_MATCHES)
    .map(t => {
      const consistencyPct = ((t.bothQualify / t.played) * 100).toFixed(1);
      const goals2PlusPct = ((t.goals2Plus / t.played) * 100).toFixed(1);
      const cornersOver10Pct = (
        CORNER_MODE === 'team'
          ? (t.teamCorners10Plus / t.played) * 100
          : (t.matchCorners10Plus / t.played) * 100
      ).toFixed(1);

      return {
        'Team': t.team,
        'P': t.played,
        'Both Hit (Hits/P)': `${t.bothQualify}/${t.played}`,
        'Consistency %': parseFloat(consistencyPct),
        '2+ Goals %': `${goals2PlusPct}%`,
        [`Corners >10 % (${CORNER_MODE})`]: `${cornersOver10Pct}%`,
        'Avg Goals': (t.goalsScored / t.played).toFixed(2),
        'Avg Team Corners': (t.teamCornersTotal / t.played).toFixed(1),
        'Avg Match Corners': (t.matchCornersTotal / t.played).toFixed(1)
      };
    })
    // Sort descending by consistency percentage, then by total matches
    .sort((a, b) => b['Consistency %'] - a['Consistency %'] || b['P'] - a['P']);

  // ── 5. Output Display ─────────────────────────────────────────
  console.clear();
  console.log(
    `%c[FootyStats Analytics]%c Teams scoring >= ${GOAL_THRESHOLD} goals & over ${CORNER_THRESHOLD} corners (${CORNER_MODE} mode) | Min ${MIN_MATCHES} games:`,
    'background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;',
    'color:#ffffff;font-weight:bold;'
  );

  if (summary.length === 0) {
    console.warn(`No teams found meeting the criteria with >= ${MIN_MATCHES} matches.`);
  } else {
    console.table(summary);
  }

  return summary;
})();
```

```
(async function analyzeAllSeasonsGoalsAndCorners() {
  // ── 1. Configuration ──────────────────────────────────────────
  const MIN_MATCHES = 20;         // Minimum all-time matches to qualify (adjust as needed)
  const GOAL_THRESHOLD = 2;       // At least 2 goals scored by the team
  const CORNER_THRESHOLD = 10;    // Over 10 corners
  // 'match' = Total match corners > 10 (standard betting market)
  // 'team'  = The individual team took > 10 corners alone
  const CORNER_MODE = 'match';

  // Historical season prefixes available in csv_cache/
  const SEASONS = ['2021', '2122', '2223', '2324', '2425', '2526', '2627'];
  const LEAGUES = [
    'E0', 'E1', 'E2', 'E3',      // England (Prem, Champ, L1, L2)
    'SP1', 'SP2',                // Spain (La Liga, Segunda)
    'D1', 'D2',                  // Germany (Bundesliga 1 & 2)
    'I1', 'I2',                  // Italy (Serie A & B)
    'F1', 'F2',                  // France (Ligue 1 & 2)
    'B1', 'N1', 'P1',            // Belgium, Netherlands, Portugal
    'SC0', 'SC1',                // Scotland (Prem, Champ)
    'T1', 'G1'                   // Turkey, Greece
  ];

  console.log(
    `%c[FootyStats Analytics]%c Scanning historical data across seasons: ${SEASONS.join(', ')}...`,
    'background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;',
    'color:#aaa;'
  );

  // ── 2. Fetch & Parse All Season CSVs ──────────────────────────
  function parseCSV(text, seasonCode) {
    if (!text || !text.trim()) return [];
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj = { _season: seasonCode };
      headers.forEach((h, i) => { obj[h] = vals[i] ? vals[i].trim() : ''; });
      return obj;
    });
  }

  // Generate fetch requests for all season + league combinations
  const fetchTasks = [];
  for (const s of SEASONS) {
    for (const l of LEAGUES) {
      fetchTasks.push(
        fetch(`./csv_cache/${s}_${l}.csv`)
          .then(r => r.ok ? r.text() : '')
          .then(txt => parseCSV(txt, s))
          .catch(() => [])
      );
    }
  }

  const chunks = await Promise.all(fetchTasks);
  const allMatches = chunks.flat();

  if (allMatches.length === 0) {
    console.error('No match records could be loaded from ./csv_cache/. Ensure files exist in this path.');
    return;
  }

  console.log(`%c[FootyStats]%c Loaded ${allMatches.length.toLocaleString()} total historical matches. Aggregating stats...`, 'color:#00ff88;font-weight:bold', 'color:#aaa');

  // ── 3. Aggregate Performance Across All Seasons ───────────────
  const stats = {};

  allMatches.forEach(m => {
    const home = m.HomeTeam || m.home;
    const away = m.AwayTeam || m.away;
    const hg = parseInt(m.FTHG ?? m.home_goals, 10);
    const ag = parseInt(m.FTAG ?? m.away_goals, 10);
    const hc = parseInt(m.HC ?? m.home_corners, 10);
    const ac = parseInt(m.AC ?? m.away_corners, 10);
    const season = m._season;

    if (!home || !away || isNaN(hg) || isNaN(ag) || isNaN(hc) || isNaN(ac)) return;

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
          seasons: new Set()
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

      const cornerHit = (CORNER_MODE === 'team') ? teamCornersOver10 : matchCornersOver10;
      if (scored2Plus && cornerHit) {
        t.bothQualify += 1;
      }
    }

    record(home, hg, hc);
    record(away, ag, ac);
  });

  // ── 4. Format & Sort Results ──────────────────────────────────
  const summary = Object.values(stats)
    .filter(t => t.played >= MIN_MATCHES)
    .map(t => {
      const consistencyPct = ((t.bothQualify / t.played) * 100).toFixed(1);
      const goals2PlusPct = ((t.goals2Plus / t.played) * 100).toFixed(1);
      const cornersOver10Pct = (
        CORNER_MODE === 'team'
          ? (t.teamCorners10Plus / t.played) * 100
          : (t.matchCorners10Plus / t.played) * 100
      ).toFixed(1);

      return {
        'Team': t.team,
        'Seasons Active': t.seasons.size,
        'Played (P)': t.played,
        'Both Hit (Hits/P)': `${t.bothQualify}/${t.played}`,
        'Consistency %': parseFloat(consistencyPct),
        '2+ Goals %': `${goals2PlusPct}%`,
        [`Corners >10 % (${CORNER_MODE})`]: `${cornersOver10Pct}%`,
        'Avg Goals': (t.goalsScored / t.played).toFixed(2),
        'Avg Team Corners': (t.teamCornersTotal / t.played).toFixed(1),
        'Avg Match Corners': (t.matchCornersTotal / t.played).toFixed(1)
      };
    })
    .sort((a, b) => b['Consistency %'] - a['Consistency %'] || b['Played (P)'] - a['Played (P)']);

  // ── 5. Render Output ──────────────────────────────────────────
  console.clear();
  console.log(
    `%c[All-Time Analysis]%c Teams scoring >= ${GOAL_THRESHOLD} goals & over ${CORNER_THRESHOLD} corners (${CORNER_MODE} mode) across ${SEASONS.length} seasons | Min ${MIN_MATCHES} games:`,
    'background:#00ff88;color:#0b0e14;font-weight:bold;padding:3px 6px;border-radius:3px;',
    'color:#ffffff;font-weight:bold;'
  );

  console.table(summary);

  // Expose results on window so you can query or export as CSV
  window.allTimeHighGoalCornerStats = summary;
  console.log('%c[Tip]%c Stored full results in %cwindow.allTimeHighGoalCornerStats%c for further filtering.', 'color:#00e5ff', 'color:#aaa', 'color:#ffb800;font-family:monospace', 'color:#aaa');

  return summary;
})();
```

## First-Half goals @ 70%+

```
(() => {
  const THRESHOLD = 70;     // Minimum 1st Half Goal %
  const TODAY_ONLY = false; // Set to true to filter to today's fixtures only

  const D = FOOTYDATA;
  const F = FOOTYFIXTURES;
  const team = (t) => (typeof t === "number" ? D.t[t] : t);

  const now = new Date();
  const todayStr =
    String(now.getDate()).padStart(2, "0") + "/" +
    String(now.getMonth() + 1).padStart(2, "0") + "/" +
    now.getFullYear();

  const hits = (F.fixtures || [])
    .filter((fix) => !TODAY_ONLY || fix.date === todayStr)
    .map((fix) => {
      let hTot = 0, hHit = 0;
      let aTot = 0, aHit = 0;
      let h2hTot = 0, h2hHit = 0;

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
        "Home HT": hTot >= 3 ? `${Math.round((hHit / hTot) * 100)}% (${hHit}/${hTot})` : "—",
        "Away HT": aTot >= 3 ? `${Math.round((aHit / aTot) * 100)}% (${aHit}/${aTot})` : "—",
        "H2H HT": h2hTot >= 2 ? `${Math.round((h2hHit / h2hTot) * 100)}% (${h2hHit}/${h2hTot})` : "—",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b["1st Half %"] - a["1st Half %"]);

  console.log(`Found ${hits.length} fixtures with >= ${THRESHOLD}% 1st Half Goal probability:`);
  console.table(hits);
  return hits;
})();
```

## First-Half goals team consistency across all seasons

```
(() => {
  // ── 1. Configuration ──────────────────────────────────────────
  const MIN_MATCHES = 20;         // Minimum matches played across seasons to qualify
  const MIN_SEASONS = 1;          // Set to 2+ to require multi-season history
  const SEASON_HIT_BENCH = 70;    // Benchmark % for counting consistent 70%+ seasons
  const SORT_BY = "overall";      // "overall" (% hit rate) or "consistency" (highest floor across seasons)

  const D = FOOTYDATA;
  const teamName = (t) => (typeof t === "number" ? D.t[t] : t);
  const splitLg = (lgName) => {
    const m = (lgName || "").match(/\s+(\d{2}\/\d{2})$/);
    return {
      league: m ? lgName.slice(0, m.index) : (lgName || "Unknown"),
      season: m ? m[1] : "All",
    };
  };

  const teams = {};
  const leagues = {};

  // ── 2. Aggregate Every Match Across All Leagues & Seasons ─────
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

  // ── 3. Format & Rank Teams ────────────────────────────────────
  const teamRows = Object.values(teams)
    .filter((t) => t.played >= MIN_MATCHES && Object.keys(t.seasons).length >= MIN_SEASONS)
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
      const highSeasons = seasonList.filter((s) => s.pct >= SEASON_HIT_BENCH).length;

      return {
        Team: t.name,
        Leagues: [...t.leagues].join(", "),
        Seasons: Object.keys(t.seasons).length,
        Played: t.played,
        "1st Half %": Number(overallPct.toFixed(1)),
        "Hits/P": `${t.hits}/${t.played}`,
        "Home HT %": t.hPlayed ? `${Math.round((t.hHits / t.hPlayed) * 100)}%` : "—",
        "Away HT %": t.aPlayed ? `${Math.round((t.aHits / t.aPlayed) * 100)}%` : "—",
        "Avg HT Goals": Number((t.htGoals / t.played).toFixed(2)),
        [`Seasons ≥${SEASON_HIT_BENCH}%`]: seasonList.length ? `${highSeasons}/${seasonList.length}` : "—",
        "Lowest Season %": Number(minSeasonPct.toFixed(1)),
      };
    })
    .sort((a, b) =>
      SORT_BY === "consistency"
        ? b["Lowest Season %"] - a["Lowest Season %"] || b["1st Half %"] - a["1st Half %"]
        : b["1st Half %"] - a["1st Half %"] || b["Lowest Season %"] - a["Lowest Season %"] || b.Played - a.Played
    );

  // ── 4. Format & Rank Leagues ──────────────────────────────────
  const leagueRows = Object.values(leagues)
    .map((l) => {
      const seasonPcts = Object.values(l.seasons).map((s) => (s.hits / s.played) * 100);
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

  // ── 5. Display Tables & Export Helper ─────────────────────────
  console.clear();
  console.log(
    `%c[FootyStats 1st Half Goals]%c Most consistent Leagues across all seasons (${leagueRows.length} competitions):`,
    "background:#39ff14;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;"
  );
  console.table(leagueRows);

  console.log(
    `%c[FootyStats 1st Half Goals]%c Top 50 most consistent Teams (from ${teamRows.length} qualifying with ≥${MIN_MATCHES} games):`,
    "background:#00f0ff;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;"
  );
  console.table(teamRows.slice(0, 50));

  window.htConsistency = { teams: teamRows, leagues: leagueRows };
  console.log(
    "%c[Tip]%c Full results stored in %cwindow.htConsistency%c — e.g. filter by league: %cwindow.htConsistency.teams.filter(t => t.Leagues.includes('Bundesliga'))",
    "color:#00f0ff", "color:#aaa", "color:#ffe600;font-family:monospace", "color:#aaa", "color:#39ff14;font-family:monospace"
  );

  return window.htConsistency;
})();
```

## 1+ HT goals, BTTS and 9+ corners

```
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
    const year = p[2].length === 2 ? 2000 + parseInt(p[2], 10) : parseInt(p[2], 10);
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
    "color:#fff;font-weight:bold;"
  );
  console.table(consistentMatchups);

  console.log(
    `%c[Complete Match List]%c ${allQualifyingMatches.length.toLocaleString()} total matches meeting all 3 criteria across all seasons:`,
    "background:#00f0ff;color:#06080d;font-weight:bold;padding:3px 6px;border-radius:3px;",
    "color:#fff;font-weight:bold;"
  );
  console.table(allQualifyingMatches);

  console.log(
    "%c[Saved Globals]%c window.comboMatchups (matchup rankings) & window.comboMatches (all qualifying games). Re-run anytime with findComboMatchups({ minMeetings: 6, byVenue: true }).",
    "color:#ffe600",
    "color:#aaa"
  );

  return { consistentMatchups, allQualifyingMatches };
};

// Run immediately with defaults
findComboMatchups();
```
