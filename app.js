/* ═══════════════════════════════════════════════════════════════════
   FootyStats Analyser — Main Application Script (app.js)
   ═══════════════════════════════════════════════════════════════════
   Table of Contents:
   1. Compact Match Schema & Index Constants (M)
   2. Global State & Dataset References (D, F, TEAM_STATS, COUPON_SLIP)
   3. Historical Team Stats & Performance Engine (computeTeamStats)
   4. Predictive Math & Goal Expectancy Model (Bivariate Poisson + H2H)
   5. Odds & Formatting Utilities (decimalToFractional, esc)
   6. Coupon & Bet Builder State Management
   7. View Renderers:
      - Wins 2+ Goals / 10+ Corners / Custom Scorelines
      - Upcoming Fixtures View
      - Coupon & Bet Builder View
   8. Main Dispatcher (render)
   9. Event Handlers & User Interaction Delegation (bindEvents)
   10. Application Bootstrap (init)
   11. PWA Service Worker & Install/Update Management
   ═══════════════════════════════════════════════════════════════════ */

// ── Application Engine ─────────────────────────────────────────────
(function () {
  "use strict";

  /* ────────────────────────────────────────────────────────────────
           Compact match array indices:
             0=date  1=home  2=away  3=fthg  4=ftag  5=ftr
             6=hthg  7=htag  8=hc    9=ac    10=tc
             11=win2plus_home  12=win2plus_away  13=corners10plus
             14=league_idx
        ──────────────────────────────────────────────────────────────── */
  const M = {
    DATE: 0,
    HOME: 1,
    AWAY: 2,
    FTHG: 3,
    FTAG: 4,
    FTR: 5,
    HTHG: 6,
    HTAG: 7,
    HC: 8,
    AC: 9,
    TC: 10,
    W2H: 11,
    W2A: 12,
    C10: 13,
    LG: 14,
  };

  // ── State ─────────────────────────────────────────────────────
  const D = typeof FOOTYDATA !== "undefined" ? FOOTYDATA : null;
  const F = typeof FOOTYFIXTURES !== "undefined" ? FOOTYFIXTURES : null;
  const TEAM_STATS = {};
  let TEST_DATA = null;
  let testDataLoading = false;
  const TEAM_LOGOS_MAP = {};

  async function loadTestFixtures() {
    if (TEST_DATA) return TEST_DATA;
    testDataLoading = true;
    try {
      const resp = await fetch("./api_test.json");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      TEST_DATA = await resp.json();
      if (TEST_DATA && Array.isArray(TEST_DATA.fixtures)) {
        TEST_DATA.fixtures.forEach((fix) => {
          if (fix.home && fix.home_logo) TEAM_LOGOS_MAP[fix.home] = fix.home_logo;
          if (fix.away && fix.away_logo) TEAM_LOGOS_MAP[fix.away] = fix.away_logo;
        });
      }
    } catch (err) {
      console.warn("Could not load api_test.json:", err);
      TEST_DATA = null;
    } finally {
      testDataLoading = false;
    }
    return TEST_DATA;
  }
  let activeTab = "wins";
  let fTeam = "",
    fOpp = "",
    fLeague = "";
  let fShowHT00Only = false;
  let fHtHome = null; // null = any, number = exact HT home goals
  let fHtAway = null; // null = any, number = exact HT away goals
  let fFtHome = null; // null = any, number = exact FT home goals
  let fFtAway = null; // null = any, number = exact FT away goals
  let fTodayOnly = false; // filter fixtures to today only
  let currentViewData = null;

  // ── Results View State ─────────────────────────────────────────
  let rLeague = ""; // "" = all 26/27 leagues
  let rTimeframe = "gameweek"; // "gameweek" (latest 7 days), "month" (last 30 days), "season" (all 26/27)
  let rFilter = "all"; // "all", "hits", "misses", "high_conf"
  let rSearch = ""; // search team filter

  // ── DOM ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $main = $("main-content");
  const $stats = $("stats-strip");
  const $team = $("search-team");
  const $opp = $("search-opponent");
  const $lg = $("filter-league");
  const $reset = $("btn-reset");
  const $ht00 = $("filter-ht-00");
  const $htHomeIn = $("ht-home-goals");
  const $htAwayIn = $("ht-away-goals");
  const $htPreview = $("ht-score-preview");
  const $clearHt = $("btn-clear-ht");
  const $ftHomeIn = $("ft-home-goals");
  const $ftAwayIn = $("ft-away-goals");
  const $ftPreview = $("ft-score-preview");
  const $clearFt = $("btn-clear-ft");
  const $filterBar = $("filter-bar");
  const $filterCount = $("filter-active-count");
  const $customBanner = $("custom-result-banner");
  const $customCount = $("custom-result-count");
  const $customBadge = $("custom-match-badge");

  if (!D) {
    $main.innerHTML =
      '<div class="empty-state"><h2>DATA NOT LOADED</h2><p>Could not find data.js. Run export_data.py first.</p></div>';
    return;
  }

  // ── Helpers ────────────────────────────────────────────────────
  // Strip season suffix: "Premier League 25/26" → "Premier League"
  function baseLeague(name) {
    return name.replace(/\s+\d{2}\/\d{2}$/, "");
  }

  // Resolve dictionary-encoded team index to team name (supports both int & string)
  function teamName(t) {
    return typeof t === "number" ? D.t[t] : t;
  }

  // Precompute historical performance rates for instant upcoming fixture insights
  function computeTeamStats() {
    if (!D || !D.m) return;
    D.t.forEach((name) => {
      TEAM_STATS[name] = {
        total: 0,
        homeMatches: 0,
        awayMatches: 0,
        w2h: 0,
        w2a: 0,
        c10: 0,
        hW: 0,
        hD: 0,
        hL: 0,
        hGF: 0,
        hGA: 0,
        aW: 0,
        aD: 0,
        aL: 0,
        aGF: 0,
        aGA: 0,
        hHtGoal: 0,
        aHtGoal: 0,
        hC10: 0,
        aC10: 0,
      };
    });
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const h = teamName(m[M.HOME]);
      const a = teamName(m[M.AWAY]);
      const fthg = m[M.FTHG] || 0;
      const ftag = m[M.FTAG] || 0;
      const ftr = m[M.FTR];
      const htGoal = ((m[M.HTHG] || 0) + (m[M.HTAG] || 0)) > 0;
      const c10Hit = m[M.C10] === 1 || (((m[M.HC] || 0) + (m[M.AC] || 0)) >= 10);
      if (TEAM_STATS[h]) {
        const tsH = TEAM_STATS[h];
        tsH.total++;
        tsH.homeMatches++;
        if (m[M.W2H]) tsH.w2h++;
        if (m[M.C10]) tsH.c10++;
        tsH.hGF += fthg;
        tsH.hGA += ftag;
        if (htGoal) tsH.hHtGoal++;
        if (c10Hit) tsH.hC10++;
        if (ftr === "H") tsH.hW++;
        else if (ftr === "D") tsH.hD++;
        else if (ftr === "A") tsH.hL++;
      }
      if (TEAM_STATS[a]) {
        const tsA = TEAM_STATS[a];
        tsA.total++;
        tsA.awayMatches++;
        if (m[M.W2A]) tsA.w2a++;
        if (m[M.C10]) tsA.c10++;
        tsA.aGF += ftag;
        tsA.aGA += fthg;
        if (htGoal) tsA.aHtGoal++;
        if (c10Hit) tsA.aC10++;
        if (ftr === "A") tsA.aW++;
        else if (ftr === "D") tsA.aD++;
        else if (ftr === "H") tsA.aL++;
      }
    }
  }

  // ── Factorial & Poisson Distribution ──────────────────────────
  var FACT_CACHE = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
  function fact(n) {
    if (n < FACT_CACHE.length) return FACT_CACHE[n];
    var res = FACT_CACHE[FACT_CACHE.length - 1];
    for (var i = FACT_CACHE.length; i <= n; i++) res *= i;
    return res;
  }

  function poissonProb(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact(k);
  }

  // ── Predictive Model: 1X2 Outright Probabilities ──────────────
  function predictMatchOutright(homeTeam, awayTeam, h2h, odds) {
    var baseHomeGoals = 1.5;
    var baseAwayGoals = 1.2;

    var hStats = TEAM_STATS[homeTeam];
    var aStats = TEAM_STATS[awayTeam];

    var homeAtt =
      hStats && hStats.homeMatches >= 3
        ? hStats.hGF / hStats.homeMatches
        : baseHomeGoals;
    var homeDef =
      hStats && hStats.homeMatches >= 3
        ? hStats.hGA / hStats.homeMatches
        : baseAwayGoals;

    var awayAtt =
      aStats && aStats.awayMatches >= 3
        ? aStats.aGF / aStats.awayMatches
        : baseAwayGoals;
    var awayDef =
      aStats && aStats.awayMatches >= 3
        ? aStats.aGA / aStats.awayMatches
        : baseHomeGoals;

    // Expected Goals (xG) using bivariate venue relative attack/defense rates
    var lambda =
      (homeAtt / baseHomeGoals) * (awayDef / baseHomeGoals) * baseHomeGoals;
    var mu =
      (awayAtt / baseAwayGoals) * (homeDef / baseAwayGoals) * baseAwayGoals;

    // Clamp lambda and mu between realistic bounds (0.2 to 4.5)
    lambda = Math.max(0.2, Math.min(4.5, lambda));
    mu = Math.max(0.2, Math.min(4.5, mu));

    // Compute 7x7 scoreline probability matrix (0..6 goals)
    var pH = 0,
      pD = 0,
      pA = 0;
    for (var i = 0; i <= 6; i++) {
      var probI = poissonProb(i, lambda);
      for (var j = 0; j <= 6; j++) {
        var probJ = poissonProb(j, mu);
        var cell = probI * probJ;
        if (i > j) pH += cell;
        else if (i === j) pD += cell;
        else pA += cell;
      }
    }

    var totalP = pH + pD + pA;
    if (totalP > 0) {
      pH /= totalP;
      pD /= totalP;
      pA /= totalP;
    }

    // Empirical H2H calibration if at least 2 historical meetings exist
    var h2hLen = h2h ? h2h.length : 0;
    if (h2hLen >= 2) {
      var hWins = 0,
        draws = 0,
        aWins = 0;
      for (var k = 0; k < h2hLen; k++) {
        var r = h2h[k][M.FTR];
        if (r === "H") hWins++;
        else if (r === "D") draws++;
        else if (r === "A") aWins++;
      }
      var h2hH = hWins / h2hLen;
      var h2hD = draws / h2hLen;
      var h2hA = aWins / h2hLen;

      // Blend 75% Poisson model + 25% empirical venue H2H
      pH = 0.75 * pH + 0.25 * h2hH;
      pD = 0.75 * pD + 0.25 * h2hD;
      pA = 0.75 * pA + 0.25 * h2hA;

      var norm = pH + pD + pA;
      pH /= norm;
      pD /= norm;
      pA /= norm;
    }

    // Fair odds (1 / P)
    var fairH = pH > 0 ? (1 / pH).toFixed(2) : "—";
    var fairD = pD > 0 ? (1 / pD).toFixed(2) : "—";
    var fairA = pA > 0 ? (1 / pA).toFixed(2) : "—";

    // Calculate Value Edge vs Market Odds if odds provided
    var edgeH = null,
      edgeD = null,
      edgeA = null;
    if (odds && odds.h && odds.d && odds.a) {
      var overround = 1 / odds.h + 1 / odds.d + 1 / odds.a;
      var mktH = 1 / odds.h / overround;
      var mktD = 1 / odds.d / overround;
      var mktA = 1 / odds.a / overround;

      edgeH = Math.round((pH - mktH) * 1000) / 10;
      edgeD = Math.round((pD - mktD) * 1000) / 10;
      edgeA = Math.round((pA - mktA) * 1000) / 10;
    }

    return {
      probH: Math.round(pH * 1000) / 10,
      probD: Math.round(pD * 1000) / 10,
      probA: Math.round(pA * 1000) / 10,
      fairOddsH: fairH,
      fairOddsD: fairD,
      fairOddsA: fairA,
      oddsH: odds && odds.h ? odds.h : null,
      oddsD: odds && odds.d ? odds.d : null,
      oddsA: odds && odds.a ? odds.a : null,
      edgeH: edgeH,
      edgeD: edgeD,
      edgeA: edgeA,
      lambda: Math.round(lambda * 100) / 100,
      mu: Math.round(mu * 100) / 100,
      h2hLen: h2hLen,
      homeMatches: hStats ? hStats.homeMatches : 0,
      awayMatches: aStats ? aStats.awayMatches : 0,
    };
  }

  // ── Coupon Slip State & Persistence ───────────────────────────
  var COUPON_SLIP = [];
  var couponStake = 10;

  function loadCouponSlip() {
    try {
      var stored = localStorage.getItem("footystats_coupon_slip");
      if (stored) {
        COUPON_SLIP = JSON.parse(stored) || [];
      }
      var storedStake = localStorage.getItem("footystats_coupon_stake");
      if (storedStake) {
        var parsedStake = parseFloat(storedStake);
        if (!isNaN(parsedStake) && parsedStake > 0) couponStake = parsedStake;
      }
    } catch (e) {
      COUPON_SLIP = [];
    }
    updateCouponBadge();
  }

  function saveCouponSlip() {
    try {
      localStorage.setItem(
        "footystats_coupon_slip",
        JSON.stringify(COUPON_SLIP),
      );
      localStorage.setItem("footystats_coupon_stake", couponStake.toString());
    } catch (e) {}
    updateCouponBadge();
  }

  function updateCouponBadge() {
    var badge = document.getElementById("coupon-count-badge");
    if (!badge) return;
    var count = COUPON_SLIP.length;
    badge.textContent = count;
    badge.style.display = count > 0 ? "inline-flex" : "none";
  }

  function getCouponLeg(matchId) {
    for (var i = 0; i < COUPON_SLIP.length; i++) {
      if (COUPON_SLIP[i].matchId === matchId) return COUPON_SLIP[i];
    }
    return null;
  }

  function updateCouponMatchCard(matchId) {
    var cur = getCouponLeg(matchId);

    // 1. Standard Coupon Outcome Buttons
    var outcomeBtns = document.querySelectorAll(
      '.coupon-outcome-btn[data-mid="' + CSS.escape(matchId) + '"]',
    );
    outcomeBtns.forEach(function (btn) {
      var pick = btn.getAttribute("data-pick");
      if (cur && cur.pick === pick) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    var matchCards = document.querySelectorAll(
      '.coupon-card[data-match-id="' + CSS.escape(matchId) + '"]',
    );
    if (matchCards.length > 0) {
      matchCards.forEach(function (card) {
        if (cur) card.classList.add("has-selected");
        else card.classList.remove("has-selected");
      });
    } else {
      outcomeBtns.forEach(function (btn) {
        var card = btn.closest(".coupon-card");
        if (card) {
          if (cur) card.classList.add("has-selected");
          else card.classList.remove("has-selected");
        }
      });
    }

    // 2. Hot Pick Cards & Buttons
    var hotPickBtns = document.querySelectorAll(
      '.hot-pick-btn[data-mid="' + CSS.escape(matchId) + '"]',
    );
    hotPickBtns.forEach(function (btn) {
      var pick = btn.getAttribute("data-pick");
      var isSelected = cur && cur.pick === pick;
      var card = btn.closest(".hot-pick-card");

      if (isSelected) {
        btn.classList.add("active");
        btn.innerHTML = "&#10003; Added to Slip";
        if (card) card.classList.add("has-selected");
      } else {
        btn.classList.remove("active");
        var odds = btn.getAttribute("data-odds");
        var fair = btn.getAttribute("data-fair");
        var eff = odds && odds !== "" ? odds : fair;
        btn.innerHTML = "+ Add Pick @ " + eff;
        if (card) card.classList.remove("has-selected");
      }
    });
  }

  function computeCouponAccumulator() {
    var accProb = 1.0;
    var combinedFairOdds = 1.0;
    var combinedMktOdds = 1.0;

    for (var i = 0; i < COUPON_SLIP.length; i++) {
      var leg = COUPON_SLIP[i];
      var pFraction = (leg.prob || 50) / 100;
      accProb *= pFraction;

      var fo = parseFloat(leg.fairOdds) || 1 / pFraction;
      combinedFairOdds *= fo;

      if (leg.odds && parseFloat(leg.odds) > 1) {
        combinedMktOdds *= parseFloat(leg.odds);
      } else {
        combinedMktOdds *= fo;
      }
    }

    if (COUPON_SLIP.length === 0) {
      accProb = 0;
      combinedFairOdds = 0;
      combinedMktOdds = 0;
    }

    var accProbPct = accProb * 100;
    var formattedProbPct =
      accProbPct >= 10 ? accProbPct.toFixed(1) : accProbPct.toFixed(2);
    if (COUPON_SLIP.length === 0) formattedProbPct = "0.0";

    var displayFairOdds =
      combinedFairOdds > 0 ? combinedFairOdds.toFixed(2) : "—";
    var displayMktOdds = combinedMktOdds > 0 ? combinedMktOdds.toFixed(2) : "—";
    var potentialReturn = (
      couponStake * (combinedMktOdds > 0 ? combinedMktOdds : combinedFairOdds)
    ).toFixed(2);
    var potentialProfit = (parseFloat(potentialReturn) - couponStake).toFixed(
      2,
    );
    if (COUPON_SLIP.length === 0) {
      potentialReturn = "0.00";
      potentialProfit = "0.00";
    }

    var meterColor = "var(--neon-green)";
    if (accProbPct < 10) meterColor = "var(--neon-red)";
    else if (accProbPct < 25) meterColor = "var(--neon-orange)";
    else if (accProbPct < 45) meterColor = "var(--neon-yellow)";
    else if (accProbPct < 65) meterColor = "var(--neon-blue)";

    return {
      accProb: accProb,
      accProbPct: accProbPct,
      formattedProbPct: formattedProbPct,
      combinedFairOdds: combinedFairOdds,
      combinedMktOdds: combinedMktOdds,
      displayFairOdds: displayFairOdds,
      displayMktOdds: displayMktOdds,
      potentialReturn: potentialReturn,
      potentialProfit: potentialProfit,
      meterColor: meterColor,
    };
  }

  function renderCouponSlipHtml(metrics) {
    var legsHtml = "";
    if (COUPON_SLIP.length === 0) {
      legsHtml =
        '<div class="coupon-slip-empty">' +
        '<div class="coupon-slip-empty-icon">&#9879;</div>' +
        "<h4>SLIP IS EMPTY</h4>" +
        "<p>Click any match outcome (1, X, or 2) to build your accumulator. Predictions are driven by venue goal expectancies and historical fixture data.</p>" +
        "</div>";
    } else {
      legsHtml =
        '<div class="coupon-legs-list">' +
        COUPON_SLIP.map(function (leg) {
          var pickTitle =
            leg.pick === "1"
              ? "HOME WIN (" + leg.home + ")"
              : leg.pick === "2"
                ? "AWAY WIN (" + leg.away + ")"
                : "DRAW";
          var effectiveOdds = leg.odds ? leg.odds : leg.fairOdds;
          return (
            '<div class="coupon-leg-card">' +
            '<div class="coupon-leg-top">' +
            '<div class="coupon-leg-match">' +
            esc(leg.home) +
            " vs " +
            esc(leg.away) +
            "</div>" +
            '<button class="coupon-leg-remove-btn" data-action="remove-leg" data-mid="' +
            esc(leg.matchId) +
            '" title="Remove from slip">&times;</button>' +
            "</div>" +
            '<div class="coupon-leg-sub">' +
            '<span class="coupon-leg-pick-badge">' +
            esc(pickTitle) +
            "</span>" +
            '<span class="coupon-leg-stats"><strong>' +
            leg.prob +
            "%</strong> \u00b7 Odds: <strong>" +
            effectiveOdds +
            "</strong></span>" +
            "</div>" +
            "</div>"
          );
        }).join("") +
        "</div>";
    }

    var summaryHtml = "";
    if (COUPON_SLIP.length > 0) {
      var accTypeTitle =
        COUPON_SLIP.length === 1
          ? "SINGLE BET"
          : COUPON_SLIP.length + "-FOLD ACCUMULATOR";
      summaryHtml =
        '<div class="coupon-acc-summary">' +
        '<div class="coupon-acc-title-row">' +
        '<span class="coupon-acc-title">' +
        esc(accTypeTitle) +
        "</span>" +
        '<span class="coupon-slip-badge">' +
        COUPON_SLIP.length +
        " LEGS</span>" +
        "</div>" +
        '<div class="coupon-acc-prob-block">' +
        '<span class="coupon-acc-prob-label">Overall Win Probability</span>' +
        '<span class="coupon-acc-prob-pct" style="color:' +
        metrics.meterColor +
        ';">' +
        metrics.formattedProbPct +
        "%</span>" +
        '<div class="coupon-acc-meter-bg">' +
        '<div class="coupon-acc-meter-fill" style="width:' +
        Math.min(100, Math.max(2, metrics.accProbPct)) +
        "%;background:" +
        metrics.meterColor +
        ';"></div>' +
        "</div>" +
        "</div>" +
        '<div class="coupon-acc-grid">' +
        '<div class="coupon-metric-box">' +
        '<span class="coupon-metric-label">Fair Odds (Model)</span>' +
        '<span class="coupon-metric-val">' +
        metrics.displayFairOdds +
        "</span>" +
        "</div>" +
        '<div class="coupon-metric-box">' +
        '<span class="coupon-metric-label">Combined Odds</span>' +
        '<span class="coupon-metric-val highlight">' +
        metrics.displayMktOdds +
        "</span>" +
        "</div>" +
        "</div>" +
        '<div class="coupon-stake-row">' +
        '<div class="coupon-stake-label-group">' +
        "<span>Stake Amount</span>" +
        "<span>Profit: £" +
        metrics.potentialProfit +
        "</span>" +
        "</div>" +
        '<div class="coupon-stake-input-wrap">' +
        '<span class="coupon-currency-symbol">£</span>' +
        '<input type="number" id="coupon-stake-input" class="coupon-stake-input" min="1" step="1" value="' +
        couponStake +
        '" />' +
        "</div>" +
        '<div class="coupon-payout-box">' +
        '<span class="coupon-payout-label">Potential Payout</span>' +
        '<span class="coupon-payout-amount">£' +
        metrics.potentialReturn +
        "</span>" +
        "</div>" +
        "</div>" +
        '<button class="coupon-copy-btn" id="coupon-copy-btn" data-action="copy-slip">' +
        "&#128203; Copy Accumulator Summary" +
        "</button>" +
        "</div>";
    }

    return (
      '<div class="coupon-slip">' +
      '<div class="coupon-drawer-handle" data-action="toggle-mobile-drawer"></div>' +
      '<div class="coupon-slip-header">' +
      '<div class="coupon-slip-title-group">' +
      '<span class="coupon-slip-title">Bet Slip</span>' +
      (COUPON_SLIP.length > 0
        ? '<span class="coupon-slip-badge">' + COUPON_SLIP.length + "</span>"
        : "") +
      "</div>" +
      '<div class="coupon-slip-actions">' +
      (COUPON_SLIP.length > 0
        ? '<button class="coupon-slip-clear-btn" data-action="clear-slip">Clear All</button>'
        : "") +
      '<button class="coupon-slip-close-btn" data-action="close-mobile-drawer" title="Close drawer">&#10005; Close</button>' +
      "</div>" +
      "</div>" +
      legsHtml +
      summaryHtml +
      "</div>"
    );
  }

  function renderCouponMobileBarHtml(metrics) {
    if (COUPON_SLIP.length === 0) return "";
    return (
      '<div class="coupon-mobile-bar" id="coupon-mobile-bar" data-action="open-mobile-drawer">' +
      '<div class="coupon-mobile-bar-left">' +
      '<span class="coupon-mobile-bar-badge">' +
      COUPON_SLIP.length +
      (COUPON_SLIP.length === 1 ? " LEG" : " LEGS") +
      "</span>" +
      '<div class="coupon-mobile-bar-metrics">' +
      "<span>Chance: <strong>" +
      metrics.formattedProbPct +
      "%</strong></span>" +
      "<span>·</span>" +
      "<span>Odds: <strong>" +
      (metrics.displayMktOdds !== "—"
        ? metrics.displayMktOdds
        : metrics.displayFairOdds) +
      "</strong></span>" +
      "</div>" +
      "</div>" +
      '<button class="coupon-mobile-bar-btn" data-action="open-mobile-drawer">' +
      "View Slip &#x25B5;" +
      "</button>" +
      "</div>"
    );
  }

  function updateCouponSlipView() {
    var metrics = computeCouponAccumulator();

    var slipCol = document.getElementById("coupon-slip-column");
    if (slipCol) {
      slipCol.innerHTML = renderCouponSlipHtml(metrics);
      if (COUPON_SLIP.length === 0) {
        slipCol.classList.remove("drawer-open");
        var backdrop = document.getElementById("coupon-drawer-backdrop");
        if (backdrop) backdrop.classList.remove("active");
      }
    }

    var barWrap = document.getElementById("coupon-mobile-bar-wrap");
    if (barWrap) {
      var oldBar = document.getElementById("coupon-mobile-bar");
      if (COUPON_SLIP.length === 0) {
        barWrap.innerHTML = "";
      } else if (oldBar) {
        var badge = oldBar.querySelector(".coupon-mobile-bar-badge");
        if (badge) {
          badge.textContent =
            COUPON_SLIP.length + (COUPON_SLIP.length === 1 ? " LEG" : " LEGS");
        }
        var metricsEl = oldBar.querySelector(".coupon-mobile-bar-metrics");
        if (metricsEl) {
          metricsEl.innerHTML =
            "<span>Chance: <strong>" +
            metrics.formattedProbPct +
            "%</strong></span>" +
            "<span>·</span>" +
            "<span>Odds: <strong>" +
            (metrics.displayMktOdds !== "—"
              ? metrics.displayMktOdds
              : metrics.displayFairOdds) +
            "</strong></span>";
        }
      } else {
        barWrap.innerHTML = renderCouponMobileBarHtml(metrics);
      }
    }

    var slipChip = document.getElementById("coupon-stats-in-slip");
    if (slipChip) {
      slipChip.innerHTML =
        '<strong style="color: var(--neon-blue);">' +
        COUPON_SLIP.length +
        "</strong> in slip";
    }

    updateCouponBadge();
  }

  function toggleCouponLeg(leg) {
    var existingIdx = -1;
    for (var i = 0; i < COUPON_SLIP.length; i++) {
      if (COUPON_SLIP[i].matchId === leg.matchId) {
        existingIdx = i;
        break;
      }
    }

    if (existingIdx !== -1) {
      if (COUPON_SLIP[existingIdx].pick === leg.pick) {
        COUPON_SLIP.splice(existingIdx, 1);
      } else {
        COUPON_SLIP[existingIdx] = leg;
      }
    } else {
      COUPON_SLIP.push(leg);
    }

    saveCouponSlip();

    if (activeTab === "coupon") {
      updateCouponMatchCard(leg.matchId);
      updateCouponSlipView();
    } else if (activeTab === "fixtures") {
      updateFixtureCouponChips(leg.matchId);
    }
  }

  function removeCouponLeg(matchId) {
    COUPON_SLIP = COUPON_SLIP.filter(function (l) {
      return l.matchId !== matchId;
    });
    saveCouponSlip();
    if (activeTab === "coupon") {
      updateCouponMatchCard(matchId);
      updateCouponSlipView();
    } else if (activeTab === "fixtures") {
      updateFixtureCouponChips(matchId);
    }
  }

  function clearCouponSlip() {
    COUPON_SLIP = [];
    saveCouponSlip();
    if (activeTab === "coupon") {
      document
        .querySelectorAll(".coupon-outcome-btn.active")
        .forEach(function (el) {
          el.classList.remove("active");
        });
      document
        .querySelectorAll(".coupon-card.has-selected")
        .forEach(function (el) {
          el.classList.remove("has-selected");
        });
      document.querySelectorAll(".hot-pick-btn").forEach(function (btn) {
        btn.classList.remove("active");
        var odds = btn.getAttribute("data-odds");
        var fair = btn.getAttribute("data-fair");
        var eff = odds && odds !== "" ? odds : fair;
        btn.innerHTML = "+ Add Pick @ " + eff;
      });
      document
        .querySelectorAll(".hot-pick-card.has-selected")
        .forEach(function (el) {
          el.classList.remove("has-selected");
        });
      updateCouponSlipView();
    } else if (activeTab === "fixtures") {
      document
        .querySelectorAll(".fixture-coupon-chip.active")
        .forEach(function (el) {
          el.classList.remove("active");
        });
    }
  }

  function updateFixtureCouponChips(matchId) {
    var container = document.querySelector(
      '[data-fixture-id="' + CSS.escape(matchId) + '"]',
    );
    if (!container) return;
    var cur = getCouponLeg(matchId);
    container.querySelectorAll(".fixture-coupon-chip").forEach(function (btn) {
      var p = btn.getAttribute("data-pick");
      if (cur && cur.pick === p) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function copyCouponSummary(btn) {
    if (COUPON_SLIP.length === 0) return;
    var text = "=== FOOTYSTATS ACCUMULATOR ===\n";
    var accProb = 1.0;
    var combinedOdds = 1.0;
    COUPON_SLIP.forEach(function (leg, i) {
      var pickStr =
        leg.pick === "1"
          ? "Home Win (" + leg.home + ")"
          : leg.pick === "2"
            ? "Away Win (" + leg.away + ")"
            : "Draw";
      var effOdds = leg.odds ? leg.odds : leg.fairOdds;
      text +=
        i + 1 + ". " + leg.home + " vs " + leg.away + " (" + leg.league + ")\n";
      text +=
        "   Pick: " +
        pickStr +
        " | Win Prob: " +
        leg.prob +
        "% | Odds: " +
        effOdds +
        "\n";
      accProb *= leg.prob / 100;
      combinedOdds *= leg.odds || parseFloat(leg.fairOdds) || 2.0;
    });
    var probPct = (accProb * 100).toFixed(1);
    var combOddsStr = combinedOdds.toFixed(2);
    var retStr = (couponStake * combinedOdds).toFixed(2);
    text += "\nAccumulator (" + COUPON_SLIP.length + " Fold):\n";
    text += "Overall Win Probability: " + probPct + "%\n";
    text += "Combined Odds: " + combOddsStr + "\n";
    text +=
      "Stake: £" + couponStake + " -> Potential Return: £" + retStr + "\n";
    text += "Generated via FootyStats Predictive Model";

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var orig = btn.innerHTML;
        btn.innerHTML = "&#10003; Copied to Clipboard!";
        setTimeout(function () {
          btn.innerHTML = orig;
        }, 2000);
      });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      var orig2 = btn.innerHTML;
      btn.innerHTML = "&#10003; Copied to Clipboard!";
      setTimeout(function () {
        btn.innerHTML = orig2;
      }, 2000);
    }
  }

  // Build deduplicated base league list preserving order
  const BASE_LEAGUES = [];
  const blSet = new Set();
  D.l.forEach((lg) => {
    const bl = baseLeague(lg);
    if (!blSet.has(bl)) {
      blSet.add(bl);
      BASE_LEAGUES.push(bl);
    }
  });

  // ── Init ──────────────────────────────────────────────────────
  (function init() {
    computeTeamStats();
    loadCouponSlip();

    // Also include any leagues from upcoming fixtures if not yet in BASE_LEAGUES
    if (F && F.leagues) {
      F.leagues.forEach((flg) => {
        if (!blSet.has(flg)) {
          blSet.add(flg);
          BASE_LEAGUES.push(flg);
        }
      });
    }

    // Populate league select with combined base league names
    BASE_LEAGUES.forEach((bl) => {
      const o = document.createElement("option");
      o.value = bl;
      o.textContent = bl;
      $lg.appendChild(o);
    });

    // Populate datalists
    const frag = document.createDocumentFragment();
    D.t.forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      frag.appendChild(o);
    });
    $("dl-teams").appendChild(frag.cloneNode(true));
    $("dl-opps").appendChild(frag);

    bindEvents();
    render();
    loadTestFixtures();
  })();

  // ── Events ────────────────────────────────────────────────────
  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        activeTab = btn.dataset.tab;
        render();
      });
    });

    let t;
    const deb = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        fTeam = $team.value.trim().toLowerCase();
        fOpp = $opp.value.trim().toLowerCase();
        render();
      }, 200);
    };
    $team.addEventListener("input", deb);
    $opp.addEventListener("input", deb);
    $lg.addEventListener("change", () => {
      fLeague = $lg.value;
      render();
    });
    $reset.addEventListener("click", () => {
      $team.value = "";
      $opp.value = "";
      $lg.value = "";
      fTeam = "";
      fOpp = "";
      fLeague = "";
      fShowHT00Only = false;
      fHtHome = null;
      fHtAway = null;
      fFtHome = null;
      fFtAway = null;
      fTodayOnly = false;
      $ht00.checked = false;
      $htHomeIn.value = "";
      $htAwayIn.value = "";
      $ftHomeIn.value = "";
      $ftAwayIn.value = "";
      syncHTScoreUI();
      syncFTScoreUI();
      updateFilterCount();
      render();
    });

    // ── Scoreline filter events ──
    $("filter-bar-header").addEventListener("click", () => {
      $filterBar.classList.toggle("collapsed");
    });

    $ht00.addEventListener("change", () => {
      fShowHT00Only = $ht00.checked;
      updateFilterCount();
      render();
    });

    function onHTInput() {
      const hv = $htHomeIn.value.trim();
      const av = $htAwayIn.value.trim();
      fHtHome = hv !== "" ? parseInt(hv, 10) : null;
      fHtAway = av !== "" ? parseInt(av, 10) : null;
      syncHTScoreUI();
      updateFilterCount();
      render();
    }
    $htHomeIn.addEventListener("input", onHTInput);
    $htAwayIn.addEventListener("input", onHTInput);

    $clearHt.addEventListener("click", () => {
      fHtHome = null;
      fHtAway = null;
      $htHomeIn.value = "";
      $htAwayIn.value = "";
      syncHTScoreUI();
      updateFilterCount();
      render();
    });

    function onFTInput() {
      const hv = $ftHomeIn.value.trim();
      const av = $ftAwayIn.value.trim();
      fFtHome = hv !== "" ? parseInt(hv, 10) : null;
      fFtAway = av !== "" ? parseInt(av, 10) : null;
      syncFTScoreUI();
      updateFilterCount();
      render();
    }
    $ftHomeIn.addEventListener("input", onFTInput);
    $ftAwayIn.addEventListener("input", onFTInput);

    $clearFt.addEventListener("click", () => {
      fFtHome = null;
      fFtAway = null;
      $ftHomeIn.value = "";
      $ftAwayIn.value = "";
      syncFTScoreUI();
      updateFilterCount();
      render();
    });

    $main.addEventListener("input", (e) => {
      if (e.target && e.target.id === "coupon-stake-input") {
        var val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          couponStake = val;
          saveCouponSlip();
          var metrics = computeCouponAccumulator();
          var payoutEl = document.querySelector(".coupon-payout-amount");
          if (payoutEl) payoutEl.textContent = "£" + metrics.potentialReturn;
          var profEl = document.querySelector(
            ".coupon-stake-label-group span:last-child",
          );
          if (profEl)
            profEl.textContent = "Profit: £" + metrics.potentialProfit;
        }
      }
    });

    $main.addEventListener("click", (e) => {
      // Open Mobile Bet Slip Drawer
      const openDrawerBtn = e.target.closest(
        '[data-action="open-mobile-drawer"]',
      );
      if (openDrawerBtn) {
        const slipCol = document.getElementById("coupon-slip-column");
        const backdrop = document.getElementById("coupon-drawer-backdrop");
        if (slipCol) slipCol.classList.add("drawer-open");
        if (backdrop) backdrop.classList.add("active");
        return;
      }

      // Close Mobile Bet Slip Drawer
      const closeDrawerBtn = e.target.closest(
        '[data-action="close-mobile-drawer"]',
      );
      if (closeDrawerBtn) {
        const slipCol = document.getElementById("coupon-slip-column");
        const backdrop = document.getElementById("coupon-drawer-backdrop");
        if (slipCol) slipCol.classList.remove("drawer-open");
        if (backdrop) backdrop.classList.remove("active");
        return;
      }

      // Toggle Mobile Bet Slip Drawer
      const toggleDrawerBtn = e.target.closest(
        '[data-action="toggle-mobile-drawer"]',
      );
      if (toggleDrawerBtn) {
        const slipCol = document.getElementById("coupon-slip-column");
        const backdrop = document.getElementById("coupon-drawer-backdrop");
        if (slipCol) slipCol.classList.toggle("drawer-open");
        if (backdrop) backdrop.classList.toggle("active");
        return;
      }

      // Coupon Outcome Toggle or Quick-Add Chip
      const couponBtn = e.target.closest(
        '[data-action="toggle-leg"], [data-action="quick-coupon"]',
      );
      if (couponBtn) {
        const mid = couponBtn.getAttribute("data-mid");
        const pick = couponBtn.getAttribute("data-pick");
        const home = couponBtn.getAttribute("data-home");
        const away = couponBtn.getAttribute("data-away");
        const lg = couponBtn.getAttribute("data-lg");
        const date = couponBtn.getAttribute("data-date");
        const time = couponBtn.getAttribute("data-time");
        const prob = parseFloat(couponBtn.getAttribute("data-prob")) || 0;
        const oddsStr = couponBtn.getAttribute("data-odds");
        const odds = oddsStr ? parseFloat(oddsStr) : null;
        const fairOdds = couponBtn.getAttribute("data-fair") || "—";

        toggleCouponLeg({
          matchId: mid,
          home: home,
          away: away,
          league: lg,
          date: date,
          time: time,
          pick: pick,
          prob: prob,
          odds: odds,
          fairOdds: fairOdds,
        });
        return;
      }

      // Remove Leg from Slip
      const removeBtn = e.target.closest('[data-action="remove-leg"]');
      if (removeBtn) {
        const rmid = removeBtn.getAttribute("data-mid");
        removeCouponLeg(rmid);
        return;
      }

      // Clear Slip
      const clearBtn = e.target.closest('[data-action="clear-slip"]');
      if (clearBtn) {
        clearCouponSlip();
        return;
      }

      // Copy Slip Summary
      const copyBtn = e.target.closest('[data-action="copy-slip"]');
      if (copyBtn) {
        copyCouponSummary(copyBtn);
        return;
      }

      // League collapse / expand
      const h = e.target.closest(".league-header, .test-league-header");
      if (h) {
        h.parentElement.classList.toggle("collapsed");
        return;
      }

      // Season tab switch
      const st = e.target.closest(".season-tab-btn");
      if (st) {
        const section = st.closest(".league-section");
        const idx = st.dataset.seasonIdx;
        const panel = section.querySelector(
          `.season-panel[data-season-idx="${idx}"]`,
        );
        if (panel && panel.dataset.rendered !== "true") {
          const lg = panel.dataset.league;
          if (currentViewData && currentViewData[lg]) {
            const teams = currentViewData[lg];
            const tn = Object.keys(teams).sort();
            const isWins = activeTab === "wins";
            const isCustom = activeTab === "custom";
            panel.innerHTML = tn
              .map((t) => renderTeam(t, teams[t], isWins, isCustom))
              .join("");
            panel.dataset.rendered = "true";
          }
        }
        section.querySelectorAll(".season-tab-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.seasonIdx === idx);
        });
        section.querySelectorAll(".season-panel").forEach((p) => {
          p.classList.toggle("hidden", p.dataset.seasonIdx !== idx);
        });
        // Update league badge to reflect the now-active season
        const badge = section.querySelector(".league-badge");
        if (badge) {
          badge.textContent =
            st.dataset.teams +
            " teams \u00b7 " +
            st.dataset.qual +
            " qualifying";
        }
      }
    });
  }

  // ── HT score input UI sync ────────────────────────────────────
  function syncHTScoreUI() {
    const hasHome = fHtHome !== null;
    const hasAway = fHtAway !== null;
    const hasAny = hasHome || hasAway;

    $htHomeIn.classList.toggle("has-value", hasHome);
    $htAwayIn.classList.toggle("has-value", hasAway);

    if (hasAny) {
      const hLabel = hasHome ? String(fHtHome) : "?";
      const aLabel = hasAway ? String(fHtAway) : "?";
      $htPreview.textContent = hLabel + " – " + aLabel;
      $htPreview.classList.add("visible");
      $clearHt.style.display = "";
    } else {
      $htPreview.classList.remove("visible");
      $clearHt.style.display = "none";
    }
  }

  // ── FT score input UI sync ────────────────────────────────────
  function syncFTScoreUI() {
    const hasHome = fFtHome !== null;
    const hasAway = fFtAway !== null;
    const hasAny = hasHome || hasAway;

    $ftHomeIn.classList.toggle("has-value", hasHome);
    $ftAwayIn.classList.toggle("has-value", hasAway);

    if (hasAny) {
      const hLabel = hasHome ? String(fFtHome) : "?";
      const aLabel = hasAway ? String(fFtAway) : "?";
      $ftPreview.textContent = hLabel + " – " + aLabel;
      $ftPreview.classList.add("visible");
      $clearFt.style.display = "";
    } else {
      $ftPreview.classList.remove("visible");
      $clearFt.style.display = "none";
    }
  }

  function updateFilterCount() {
    const count =
      (fShowHT00Only ? 1 : 0) +
      (fHtHome !== null ? 1 : 0) +
      (fHtAway !== null ? 1 : 0) +
      (fFtHome !== null ? 1 : 0) +
      (fFtAway !== null ? 1 : 0);
    if (count > 0) {
      $filterCount.textContent = count + " active";
      $filterCount.style.display = "";
    } else {
      $filterCount.style.display = "none";
    }
  }

  // ── Scoreline filter predicate (show-only / filter logic) ────
  function passesScorelineFilter(m) {
    // HT: when toggled, show ONLY 0-0 half-times
    if (fShowHT00Only && !(m[M.HTHG] === 0 && m[M.HTAG] === 0)) return false;
    // In custom mode the score inputs are used for highlighting, not filtering
    if (activeTab === "custom") return true;
    // HT exact score filter
    if (fHtHome !== null && m[M.HTHG] !== fHtHome) return false;
    if (fHtAway !== null && m[M.HTAG] !== fHtAway) return false;
    // FT home goals: when set, must match exactly
    if (fFtHome !== null && m[M.FTHG] !== fFtHome) return false;
    // FT away goals: when set, must match exactly
    if (fFtAway !== null && m[M.FTAG] !== fFtAway) return false;
    return true;
  }

  // ── Does a match satisfy the custom highlight scoreline? ──────
  function matchesCustomScoreline(m) {
    const htMatch =
      (fHtHome === null || m[M.HTHG] === fHtHome) &&
      (fHtAway === null || m[M.HTAG] === fHtAway);
    const ftMatch =
      (fFtHome === null || m[M.FTHG] === fFtHome) &&
      (fFtAway === null || m[M.FTAG] === fFtAway);
    // Must have at least one scoreline filter active AND both that are active must match
    const anyActive =
      fHtHome !== null ||
      fHtAway !== null ||
      fFtHome !== null ||
      fFtAway !== null;
    return anyActive && htMatch && ftMatch;
  }

  // ── Build filtered view ───────────────────────────────────────
  function buildView() {
    const isWins = activeTab === "wins";
    const isCustom = activeTab === "custom";
    const lgMap = {}; // league_name -> { team -> { home: [{m,q,cx}], away: [{m,q,cx}] } }
    const lgOrder = [];
    const lgSet = new Set();

    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const lgName = D.l[m[M.LG]];

      // League filter (matches all seasons of the selected base league)
      if (fLeague && baseLeague(lgName) !== fLeague) continue;

      // Scoreline filters (no-op in custom mode)
      if (!passesScorelineFilter(m)) continue;

      if (!lgSet.has(lgName)) {
        lgOrder.push(lgName);
        lgSet.add(lgName);
      }
      if (!lgMap[lgName]) lgMap[lgName] = {};

      const home = teamName(m[M.HOME]),
        away = teamName(m[M.AWAY]);

      // q = qualifying flag for wins/corners tabs
      // cx = custom highlight flag
      const homeQ = isWins ? m[M.W2H] : isCustom ? false : m[M.C10];
      const awayQ = isWins ? m[M.W2A] : isCustom ? false : m[M.C10];
      const cx = isCustom ? matchesCustomScoreline(m) : false;

      // Add to home team
      if (!lgMap[lgName][home]) lgMap[lgName][home] = { home: [], away: [] };
      lgMap[lgName][home].home.push({ m, q: homeQ, cx });

      // Add to away team
      if (!lgMap[lgName][away]) lgMap[lgName][away] = { home: [], away: [] };
      lgMap[lgName][away].away.push({ m, q: awayQ, cx });
    }

    // Filter teams + prune
    const out = {};
    const outLg = [];

    lgOrder.forEach((lg) => {
      if (!lgMap[lg]) return;
      const teams = {};
      const names = Object.keys(lgMap[lg]).sort();

      names.forEach((team) => {
        if (fTeam && !team.toLowerCase().includes(fTeam)) return;

        let rec = lgMap[lg][team];

        if (!isCustom) {
          // Must have at least 1 qualifying match (unless scoreline filters are active)
          const hasScorelineFilter =
            fShowHT00Only ||
            fHtHome !== null ||
            fHtAway !== null ||
            fFtHome !== null ||
            fFtAway !== null;
          if (
            !hasScorelineFilter &&
            !rec.home.some((e) => e.q) &&
            !rec.away.some((e) => e.q)
          )
            return;
        }

        // Opponent filter
        if (fOpp) {
          rec = {
            home: rec.home.filter((e) =>
              teamName(e.m[M.AWAY]).toLowerCase().includes(fOpp),
            ),
            away: rec.away.filter((e) =>
              teamName(e.m[M.HOME]).toLowerCase().includes(fOpp),
            ),
          };
          if (!rec.home.length && !rec.away.length) return;
        }

        teams[team] = rec;
      });

      if (Object.keys(teams).length) {
        out[lg] = teams;
        outLg.push(lg);
      }
    });

    return { data: out, leagues: outLg };
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    if (activeTab === "coupon") {
      renderCouponView();
      return;
    }
    if (activeTab === "fixtures") {
      renderFixturesView();
      return;
    }
    if (activeTab === "results") {
      renderResultsView();
      return;
    }
    if (activeTab === "test") {
      renderTestView();
      return;
    }
    $filterBar.style.display = "";

    const { data, leagues } = buildView();
    currentViewData = data;
    const isWins = activeTab === "wins";
    const isCustom = activeTab === "custom";

    // Group season-specific league names by their base league name
    const baseGroups = {}; // baseName -> [lgName, ...]
    const baseOrder = [];
    leagues.forEach((lg) => {
      const bl = baseLeague(lg);
      if (!baseGroups[bl]) {
        baseGroups[bl] = [];
        baseOrder.push(bl);
      }
      baseGroups[bl].push(lg);
    });

    // Aggregate stats across all season variants
    let nTeams = 0,
      nQual = 0,
      nCustom = 0,
      nTotal = 0;
    leagues.forEach((lg) => {
      const tn = Object.keys(data[lg]);
      nTeams += tn.length;
      tn.forEach((t) => {
        const r = data[lg][t];
        nTotal += r.home.length + r.away.length;
        if (isWins) {
          nQual +=
            r.home.filter((e) => e.q).length + r.away.filter((e) => e.q).length;
        } else if (!isCustom) {
          nQual += r.home.filter((e) => e.q).length;
        }
        nCustom += r.home.filter((e) => e.cx).length;
      });
    });

    // Update custom badge
    $customBadge.textContent = nCustom;
    if (isCustom) {
      const hasCriteria =
        fHtHome !== null ||
        fHtAway !== null ||
        fFtHome !== null ||
        fFtAway !== null;
      $customBanner.classList.toggle("visible", hasCriteria);
      $customCount.textContent = nCustom.toLocaleString();
    } else {
      $customBanner.classList.remove("visible");
    }

    let ql;
    if (isCustom) {
      ql = "fixtures highlighted";
      nQual = nCustom;
    } else {
      ql = isWins ? "Qualifying wins" : "10+ corner matches";
    }

    $stats.innerHTML =
      `<div class="stat-chip"><strong>${baseOrder.length}</strong> leagues</div>` +
      `<div class="stat-chip"><strong>${nTeams}</strong> teams</div>` +
      `<div class="stat-chip"><strong>${nQual.toLocaleString()}</strong> ${ql}</div>` +
      `<div class="stat-chip"><strong>${nTotal.toLocaleString()}</strong> fixtures shown</div>`;

    if (!leagues.length) {
      $main.innerHTML =
        '<div class="empty-state"><h2>No matches found</h2><p>Try adjusting your search or filters.</p></div>';
      return;
    }

    const parts = [];

    baseOrder.forEach((bl, bli) => {
      const seasons = baseGroups[bl];

      // Sort seasons ascending by label: "23/24" < "24/25" < "25/26"
      seasons.sort((a, b) => {
        const la = a.slice(bl.length).trim();
        const lb = b.slice(bl.length).trim();
        return la.localeCompare(lb);
      });

      const defaultIdx = seasons.length - 1; // latest season active by default

      // Badge reflects the ACTIVE (latest) season only
      const activeLg = seasons[defaultIdx];
      const activeTeams = Object.keys(data[activeLg]);
      let activeQual = 0;
      activeTeams.forEach((t) => {
        const r = data[activeLg][t];
        if (isCustom) activeQual += r.home.filter((e) => e.cx).length;
        else if (isWins)
          activeQual +=
            r.home.filter((e) => e.q).length + r.away.filter((e) => e.q).length;
        else activeQual += r.home.filter((e) => e.q).length;
      });

      // Season tab strip (omit when only one season)
      let tabsHtml = "";
      if (seasons.length > 1) {
        tabsHtml =
          '<div class="league-tabs">' +
          seasons
            .map((lg, si) => {
              const season = lg.slice(bl.length).trim() || lg;
              const active = si === defaultIdx ? " active" : "";
              // Per-season badge data stored on the button for live updates
              const sTeams = Object.keys(data[lg]);
              let sQual = 0;
              sTeams.forEach((t) => {
                const r = data[lg][t];
                if (isCustom) sQual += r.home.filter((e) => e.cx).length;
                else if (isWins)
                  sQual +=
                    r.home.filter((e) => e.q).length +
                    r.away.filter((e) => e.q).length;
                else sQual += r.home.filter((e) => e.q).length;
              });
              return `<button class="season-tab-btn${active}" data-season-idx="${si}" data-teams="${sTeams.length}" data-qual="${sQual}" type="button">${esc(season)}</button>`;
            })
            .join("") +
          "</div>";
      }

      // One panel per season — lazily render inactive seasons on tab switch
      const panelsHtml = seasons
        .map((lg, si) => {
          const hidden = si !== defaultIdx ? " hidden" : "";
          if (si === defaultIdx) {
            const teams = data[lg];
            const tn = Object.keys(teams).sort();
            return (
              `<div class="season-panel${hidden}" data-season-idx="${si}" data-league="${esc(lg)}" data-rendered="true">` +
              tn
                .map((t) => renderTeam(t, teams[t], isWins, isCustom))
                .join("") +
              "</div>"
            );
          }
          return `<div class="season-panel hidden" data-season-idx="${si}" data-league="${esc(lg)}" data-rendered="false"></div>`;
        })
        .join("");

      parts.push(
        `<section class="league-section" style="animation-delay:${bli * 30}ms">` +
          `<div class="league-header" role="button" tabindex="0" aria-label="Toggle ${esc(bl)}">` +
          `<h2 class="league-name">${esc(bl)}</h2>` +
          `<span class="league-badge">${activeTeams.length} teams &middot; ${activeQual} qualifying</span>` +
          `<span class="league-toggle">&#9660;</span></div>` +
          `<div class="league-body">${tabsHtml}${panelsHtml}</div>` +
          `</section>`,
      );
    });

    $main.innerHTML = parts.join("");
  }

  function renderTeam(name, rec, isWins, isCustom) {
    let h =
      '<div class="team-block"><div class="team-name-header">' +
      esc(name) +
      "</div>";
    if (rec.home.length)
      h +=
        '<div class="venue-label">Home Fixtures</div>' +
        renderTable(rec.home, isWins, true, isCustom);
    if (rec.away.length)
      h +=
        '<div class="venue-label">Away Fixtures</div>' +
        renderTable(rec.away, isWins, false, isCustom);
    return h + "</div>";
  }

  function renderTable(entries, isWins, isHome, isCustom) {
    const hdrExtra =
      isWins || isCustom
        ? '<th class="c">HT</th>'
        : '<th class="c">HC</th><th class="c">AC</th><th class="c">Tot</th>';

    // Colgroup for fixed column widths — keeps all tables aligned
    const colgroup =
      isWins || isCustom
        ? "<colgroup>" +
          '<col class="col-num"><col class="col-date">' +
          '<col class="col-team"><col class="col-score"><col class="col-team">' +
          '<col class="col-res"><col class="col-ht"><col class="col-dot">' +
          "</colgroup>"
        : "<colgroup>" +
          '<col class="col-num"><col class="col-date">' +
          '<col class="col-team"><col class="col-score"><col class="col-team">' +
          '<col class="col-res">' +
          '<col class="col-corner"><col class="col-corner"><col class="col-corner">' +
          '<col class="col-dot">' +
          "</colgroup>";

    let h =
      '<div class="match-table-wrap"><table class="match-table">' +
      colgroup +
      "<thead><tr>" +
      '<th>#</th><th>Date</th><th class="team-cell">Home</th><th class="c">FT</th><th class="team-cell">Away</th>' +
      '<th class="c col-res">Win</th>' +
      hdrExtra +
      '<th class="c"></th></tr></thead><tbody>';

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i],
        m = e.m,
        q = e.q,
        cx = e.cx;

      let rc;
      if (isCustom) {
        rc = cx ? " qcustom" : "";
      } else {
        rc = q ? (isWins ? " qw" : " qc") : "";
      }

      let res, cls;
      if (isHome) {
        res = m[M.FTR] === "H" ? "W" : m[M.FTR] === "A" ? "L" : "D";
      } else {
        res = m[M.FTR] === "A" ? "W" : m[M.FTR] === "H" ? "L" : "D";
      }
      cls = res === "W" ? "bw" : res === "L" ? "bl" : "bd";

      let mk;
      if (isCustom) {
        mk = cx ? '<span class="qm qm-o"></span>' : "";
      } else {
        const mc = isWins ? "qm-g" : "qm-y";
        mk = q ? '<span class="qm ' + mc + '"></span>' : "";
      }

      const ex =
        isWins || isCustom
          ? '<td class="c">' + m[M.HTHG] + "-" + m[M.HTAG] + "</td>"
          : '<td class="c">' +
            m[M.HC] +
            '</td><td class="c">' +
            m[M.AC] +
            '</td><td class="c"><strong>' +
            m[M.TC] +
            "</strong></td>";

      const hTeam = teamName(m[M.HOME]);
      const aTeam = teamName(m[M.AWAY]);

      h +=
        '<tr class="' +
        rc +
        '">' +
        "<td>" +
        (i + 1) +
        "</td>" +
        "<td>" +
        esc(m[M.DATE]) +
        "</td>" +
        '<td class="team-cell" title="' +
        esc(hTeam) +
        '">' +
        esc(hTeam) +
        "</td>" +
        '<td class="c">' +
        m[M.FTHG] +
        " - " +
        m[M.FTAG] +
        "</td>" +
        '<td class="team-cell" title="' +
        esc(aTeam) +
        '">' +
        esc(aTeam) +
        "</td>" +
        '<td class="c col-res"><span class="b ' +
        cls +
        '">' +
        res +
        "</span></td>" +
        ex +
        '<td class="c">' +
        mk +
        "</td></tr>";
    }

    return h + "</tbody></table></div>";
  }

  // ── Coupon / Bet Builder View ────────────────────────────────
  function renderCouponView() {
    $filterBar.style.display = "none";
    $customBanner.classList.remove("visible");

    if (!F || !F.fixtures || !F.fixtures.length) {
      $stats.innerHTML =
        '<div class="stat-chip"><strong>0</strong> upcoming fixtures for coupon</div>';
      $main.innerHTML =
        '<div class="empty-state"><h2>NO FIXTURES LOADED</h2><p>Could not find fixtures in fixtures.js. Run <code>python export_fixtures.py</code> to download upcoming matches.</p></div>';
      return;
    }

    var now = new Date();
    var todayStr =
      String(now.getDate()).padStart(2, "0") +
      "/" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "/" +
      now.getFullYear();

    var filtered = F.fixtures.filter(function (fix) {
      if (fTodayOnly && fix.date !== todayStr) return false;
      if (fLeague && fix.league !== fLeague) return false;
      var h = fix.home.toLowerCase();
      var a = fix.away.toLowerCase();

      if (fTeam) {
        var matchHome = h.includes(fTeam);
        var matchAway = a.includes(fTeam);
        if (!matchHome && !matchAway) return false;
      }
      if (fOpp) {
        var matchHome2 = h.includes(fOpp);
        var matchAway2 = a.includes(fOpp);
        if (!matchHome2 && !matchAway2) return false;
      }
      return true;
    });

    // Stats strip
    var legsCount = COUPON_SLIP.length;
    $stats.innerHTML =
      '<div class="stat-chip"><strong>' +
      filtered.length +
      "</strong> fixtures</div>" +
      '<div class="stat-chip" id="coupon-stats-in-slip" style="border-color: rgba(0, 180, 255, 0.4);"><strong style="color: var(--neon-blue);">' +
      legsCount +
      "</strong> in slip</div>" +
      '<label class="stat-chip stat-chip-toggle coupon-toggle" for="filter-today-only" title="Show only today\'s matches">' +
      '<input type="checkbox" id="filter-today-only" ' +
      (fTodayOnly ? "checked" : "") +
      " />" +
      '<span class="today-toggle-track"></span>' +
      '<span class="today-toggle-label">Today Only</span>' +
      "</label>";

    var cb = document.getElementById("filter-today-only");
    if (cb) {
      cb.addEventListener("change", function () {
        fTodayOnly = cb.checked;
        render();
      });
    }

    // Helper to render a single coupon match card
    function renderCouponCard(fix) {
      var home = fix.home;
      var away = fix.away;
      var matchId = (fix.date || "") + "_" + home + "_" + away;
      var h2h = getH2HAtHome(home, away);
      var pred = predictMatchOutright(home, away, h2h, fix.odds);
      var cur = getCouponLeg(matchId);

      var htGoalPct = calcFirstHalfGoalPct(home, away, h2h);
      var c10Pct = calcCorners10PlusPct(home, away, h2h);

      var homeSub = "H: " + pred.homeMatches + " matches";
      var awaySub = "A: " + pred.awayMatches + " matches";

      var edgeHHtml =
        pred.edgeH !== null && pred.edgeH > 0
          ? '<span class="outcome-edge-chip" title="Model edge vs bookmaker implied probability">+' +
            pred.edgeH +
            "% Edge</span>"
          : "";
      var edgeDHtml =
        pred.edgeD !== null && pred.edgeD > 0
          ? '<span class="outcome-edge-chip" title="Model edge vs bookmaker implied probability">+' +
            pred.edgeD +
            "% Edge</span>"
          : "";
      var edgeAHtml =
        pred.edgeA !== null && pred.edgeA > 0
          ? '<span class="outcome-edge-chip" title="Model edge vs bookmaker implied probability">+' +
            pred.edgeA +
            "% Edge</span>"
          : "";

      var isSelectedH = cur && cur.pick === "1";
      var isSelectedD = cur && cur.pick === "X";
      var isSelectedA = cur && cur.pick === "2";
      var hasSelectedAny = isSelectedH || isSelectedD || isSelectedA;

      var oddsHDisplay = pred.oddsH
        ? "Mkt: <strong>" + pred.oddsH + "</strong>"
        : "Fair: <strong>" + pred.fairOddsH + "</strong>";
      var oddsDDisplay = pred.oddsD
        ? "Mkt: <strong>" + pred.oddsD + "</strong>"
        : "Fair: <strong>" + pred.fairOddsD + "</strong>";
      var oddsADisplay = pred.oddsA
        ? "Mkt: <strong>" + pred.oddsA + "</strong>"
        : "Fair: <strong>" + pred.fairOddsA + "</strong>";

      return (
        '<div class="coupon-card' +
        (hasSelectedAny ? " has-selected" : "") +
        '" data-match-id="' +
        esc(matchId) +
        '">' +
        '<div class="coupon-card-meta">' +
        '<span class="coupon-league-badge">' +
        esc(fix.league) +
        "</span>" +
        '<div class="coupon-datetime">' +
        "<span>" +
        esc(fix.date) +
        "</span>" +
        "<span>·</span>" +
        '<span class="coupon-time-pill">' +
        esc(fix.time) +
        "</span>" +
        "</div>" +
        "</div>" +
        '<div class="coupon-card-teams">' +
        '<div class="coupon-team home">' +
        '<span class="coupon-team-name">' +
        esc(home) +
        "</span>" +
        '<span class="coupon-team-sub">' +
        homeSub +
        "</span>" +
        "</div>" +
        '<span class="coupon-vs">VS</span>' +
        '<div class="coupon-team away">' +
        '<span class="coupon-team-name">' +
        esc(away) +
        "</span>" +
        '<span class="coupon-team-sub">' +
        awaySub +
        "</span>" +
        "</div>" +
        "</div>" +
        '<div class="coupon-xg-strip">' +
        '<div class="coupon-xg-labels">' +
        '<span>Model xG: <strong class="coupon-xg-val">' +
        pred.lambda +
        "</strong></span>" +
        "<span>" +
        (pred.h2hLen > 0 ? pred.h2hLen + " H2H meetings" : "Form Baseline") +
        "</span>" +
        '<span>Model xG: <strong class="coupon-xg-val" style="color:var(--neon-purple);">' +
        pred.mu +
        "</strong></span>" +
        "</div>" +
        '<div class="coupon-xg-bar-container" title="Expected Goal Probabilities (Home ' +
        pred.probH +
        "% | Draw " +
        pred.probD +
        "% | Away " +
        pred.probA +
        '%)">' +
        '<div class="coupon-xg-bar-home" style="width:' +
        pred.probH +
        '%;"></div>' +
        '<div class="coupon-xg-bar-draw" style="width:' +
        pred.probD +
        '%;"></div>' +
        '<div class="coupon-xg-bar-away" style="width:' +
        pred.probA +
        '%;"></div>' +
        "</div>" +
        "</div>" +
        '<div class="coupon-sub-metrics">' +
        '<div class="coupon-sub-metric" title="Historical probability of at least 1 goal scored in the first half">' +
        '<span class="sub-metric-dot' +
        (htGoalPct !== null && htGoalPct >= 70 ? " high" : "") +
        '"></span>' +
        '<span class="sub-metric-label">1st Half Goal:</span>' +
        '<strong class="sub-metric-val' +
        (htGoalPct !== null && htGoalPct >= 70 ? " high" : "") +
        '">' +
        (htGoalPct !== null ? htGoalPct + "%" : "—") +
        "</strong>" +
        "</div>" +
        '<span class="sub-metric-divider">·</span>' +
        '<div class="coupon-sub-metric" title="Historical probability of 10 or more total match corners">' +
        '<span class="sub-metric-dot' +
        (c10Pct !== null && c10Pct >= 55 ? " high-alt" : "") +
        '"></span>' +
        '<span class="sub-metric-label">10+ Corners:</span>' +
        '<strong class="sub-metric-val' +
        (c10Pct !== null && c10Pct >= 55 ? " high-alt" : "") +
        '">' +
        (c10Pct !== null ? c10Pct + "%" : "—") +
        "</strong>" +
        "</div>" +
        "</div>" +
        '<div class="coupon-outcomes-grid">' +
        '<button class="coupon-outcome-btn' +
        (isSelectedH ? " active" : "") +
        '" data-action="toggle-leg" data-mid="' +
        esc(matchId) +
        '" data-pick="1" data-home="' +
        esc(home) +
        '" data-away="' +
        esc(away) +
        '" data-lg="' +
        esc(fix.league) +
        '" data-date="' +
        esc(fix.date) +
        '" data-time="' +
        esc(fix.time) +
        '" data-prob="' +
        pred.probH +
        '" data-odds="' +
        (pred.oddsH || "") +
        '" data-fair="' +
        pred.fairOddsH +
        '">' +
        '<span class="outcome-pick-label"><span class="outcome-pick-full">1 · Home Win</span><span class="outcome-pick-short">1 · Home</span></span>' +
        '<span class="outcome-prob">' +
        pred.probH +
        "%</span>" +
        '<div class="outcome-odds-strip">' +
        oddsHDisplay +
        "</div>" +
        edgeHHtml +
        "</button>" +
        '<button class="coupon-outcome-btn' +
        (isSelectedD ? " active" : "") +
        '" data-action="toggle-leg" data-mid="' +
        esc(matchId) +
        '" data-pick="X" data-home="' +
        esc(home) +
        '" data-away="' +
        esc(away) +
        '" data-lg="' +
        esc(fix.league) +
        '" data-date="' +
        esc(fix.date) +
        '" data-time="' +
        esc(fix.time) +
        '" data-prob="' +
        pred.probD +
        '" data-odds="' +
        (pred.oddsD || "") +
        '" data-fair="' +
        pred.fairOddsD +
        '">' +
        '<span class="outcome-pick-label"><span class="outcome-pick-full">X · Draw</span><span class="outcome-pick-short">X · Draw</span></span>' +
        '<span class="outcome-prob">' +
        pred.probD +
        "%</span>" +
        '<div class="outcome-odds-strip">' +
        oddsDDisplay +
        "</div>" +
        edgeDHtml +
        "</button>" +
        '<button class="coupon-outcome-btn' +
        (isSelectedA ? " active" : "") +
        '" data-action="toggle-leg" data-mid="' +
        esc(matchId) +
        '" data-pick="2" data-home="' +
        esc(home) +
        '" data-away="' +
        esc(away) +
        '" data-lg="' +
        esc(fix.league) +
        '" data-date="' +
        esc(fix.date) +
        '" data-time="' +
        esc(fix.time) +
        '" data-prob="' +
        pred.probA +
        '" data-odds="' +
        (pred.oddsA || "") +
        '" data-fair="' +
        pred.fairOddsA +
        '">' +
        '<span class="outcome-pick-label"><span class="outcome-pick-full">2 · Away Win</span><span class="outcome-pick-short">2 · Away</span></span>' +
        '<span class="outcome-prob">' +
        pred.probA +
        "%</span>" +
        '<div class="outcome-odds-strip">' +
        oddsADisplay +
        "</div>" +
        edgeAHtml +
        "</button>" +
        "</div>" +
        "</div>"
      );
    }

    // Build Match Cards HTML
    var cardsHtml = "";
    if (filtered.length === 0) {
      cardsHtml =
        '<div class="empty-state"><h3>No matches found</h3><p>Try clearing or modifying your search or league filter.</p></div>';
    } else {
      // 1. Identify Model Standouts for Hot Picks Section
      var scoredPicks = [];
      filtered.forEach(function (fix) {
        var home = fix.home;
        var away = fix.away;
        var matchId = (fix.date || "") + "_" + home + "_" + away;
        var h2h = getH2HAtHome(home, away);
        var pred = predictMatchOutright(home, away, h2h, fix.odds);

        var candidates = [
          {
            pick: "1",
            label: "Home Win (" + home + ")",
            prob: pred.probH,
            odds: pred.oddsH,
            fair: pred.fairOddsH,
            edge: pred.edgeH || 0,
          },
          {
            pick: "X",
            label: "Draw",
            prob: pred.probD,
            odds: pred.oddsD,
            fair: pred.fairOddsD,
            edge: pred.edgeD || 0,
          },
          {
            pick: "2",
            label: "Away Win (" + away + ")",
            prob: pred.probA,
            odds: pred.oddsA,
            fair: pred.fairOddsA,
            edge: pred.edgeA || 0,
          },
        ];

        candidates.sort(function (a, b) {
          var scoreA = a.prob + (a.edge > 0 ? a.edge * 1.5 : 0);
          var scoreB = b.prob + (b.edge > 0 ? b.edge * 1.5 : 0);
          return scoreB - scoreA;
        });

        var top = candidates[0];
        var score = top.prob + (top.edge > 0 ? top.edge * 2 : 0);
        if (top.prob >= 48 || top.edge >= 3.5) {
          scoredPicks.push({
            fix: fix,
            matchId: matchId,
            home: home,
            away: away,
            league: fix.league,
            date: fix.date,
            time: fix.time,
            pick: top.pick,
            pickLabel: top.label,
            prob: top.prob,
            odds: top.odds,
            fair: top.fair,
            edge: top.edge,
            score: score,
            h2h: h2h,
          });
        }
      });

      scoredPicks.sort(function (a, b) {
        return b.score - a.score;
      });

      var hotPicks = scoredPicks.slice(0, 4);
      var hotPicksHtml = "";
      if (hotPicks.length > 0) {
        hotPicksHtml =
          '<div class="coupon-hot-picks-section">' +
          '<div class="hot-picks-header">' +
          '<span class="hot-picks-icon">&#128293;</span>' +
          '<div class="hot-picks-title-group">' +
          '<h3 class="hot-picks-title">HOT PICKS · MODEL STANDOUTS <span class="hot-picks-badge">ALGORITHMIC VALUE</span></h3>' +
          '<span class="hot-picks-subtitle">Highest confidence match outcomes &amp; statistical value edges based on Poisson &amp; H2H modelling</span>' +
          "</div>" +
          "</div>" +
          '<div class="hot-picks-grid">' +
          hotPicks
            .map(function (hp) {
              var cur = getCouponLeg(hp.matchId);
              var isSelected = cur && cur.pick === hp.pick;
              var effectiveOdds = hp.odds ? hp.odds : hp.fair;
              var edgeTag =
                hp.edge > 0
                  ? '<span class="hot-pick-edge-tag" title="Model edge vs bookmaker odds">+' +
                    hp.edge +
                    "% Edge</span>"
                  : "";
              var htGoalPct = calcFirstHalfGoalPct(hp.home, hp.away, hp.h2h);
              var c10Pct = calcCorners10PlusPct(hp.home, hp.away, hp.h2h);

              return (
                '<div class="hot-pick-card' +
                (isSelected ? " has-selected" : "") +
                '" data-match-id="' +
                esc(hp.matchId) +
                '">' +
                '<div class="hot-pick-card-top">' +
                '<span class="hot-pick-league">' +
                esc(hp.league) +
                "</span>" +
                '<span class="hot-pick-date">' +
                esc(hp.date) +
                " · " +
                esc(hp.time) +
                "</span>" +
                "</div>" +
                '<div class="hot-pick-match">' +
                esc(hp.home) +
                " vs " +
                esc(hp.away) +
                "</div>" +
                '<div class="hot-pick-recommendation">' +
                '<div class="hot-pick-selection-title">' +
                '&#9654; <span style="color:#fff;">' +
                esc(hp.pickLabel) +
                "</span>" +
                "</div>" +
                '<div class="hot-pick-metrics-row">' +
                '<strong style="color:var(--neon-cyan);">' +
                hp.prob +
                "%</strong>" +
                edgeTag +
                "</div>" +
                "</div>" +
                '<div class="coupon-sub-metrics" style="padding: 4px 8px; font-size: 0.68rem;">' +
                '<div class="coupon-sub-metric">' +
                '<span class="sub-metric-dot' +
                (htGoalPct !== null && htGoalPct >= 70 ? " high" : "") +
                '"></span>' +
                '<span class="sub-metric-label">1st Half:</span> ' +
                '<strong class="sub-metric-val' +
                (htGoalPct !== null && htGoalPct >= 70 ? " high" : "") +
                '">' +
                (htGoalPct !== null ? htGoalPct + "%" : "—") +
                "</strong>" +
                "</div>" +
                '<span class="sub-metric-divider">·</span>' +
                '<div class="coupon-sub-metric">' +
                '<span class="sub-metric-dot' +
                (c10Pct !== null && c10Pct >= 55 ? " high-alt" : "") +
                '"></span>' +
                '<span class="sub-metric-label">10+ Cnr:</span> ' +
                '<strong class="sub-metric-val' +
                (c10Pct !== null && c10Pct >= 55 ? " high-alt" : "") +
                '">' +
                (c10Pct !== null ? c10Pct + "%" : "—") +
                "</strong>" +
                "</div>" +
                "</div>" +
                '<button class="hot-pick-btn' +
                (isSelected ? " active" : "") +
                '" data-action="toggle-leg" data-mid="' +
                esc(hp.matchId) +
                '" data-pick="' +
                hp.pick +
                '" data-home="' +
                esc(hp.home) +
                '" data-away="' +
                esc(hp.away) +
                '" data-lg="' +
                esc(hp.league) +
                '" data-date="' +
                esc(hp.date) +
                '" data-time="' +
                esc(hp.time) +
                '" data-prob="' +
                hp.prob +
                '" data-odds="' +
                (hp.odds || "") +
                '" data-fair="' +
                hp.fair +
                '">' +
                (isSelected
                  ? "&#10003; Added to Slip"
                  : "+ Add Pick @ " + effectiveOdds) +
                "</button>" +
                "</div>"
              );
            })
            .join("") +
          "</div>" +
          "</div>";
      }

      // 2. Group matches by League with Collapsible Sections
      var groups = {};
      var leaguesOrder = [];
      filtered.forEach(function (fix) {
        if (!groups[fix.league]) {
          groups[fix.league] = [];
          leaguesOrder.push(fix.league);
        }
        groups[fix.league].push(fix);
      });

      var isMobile = window.matchMedia("(max-width: 768px)").matches;
      var initialCollapse = isMobile ? " collapsed" : "";

      var leaguesHtml = leaguesOrder
        .map(function (lg, idx) {
          var list = groups[lg];
          var leagueCards = list.map(renderCouponCard).join("");
          return (
            '<section class="league-section' +
            initialCollapse +
            '" style="animation-delay:' +
            idx * 30 +
            'ms">' +
            '<div class="league-header" role="button" tabindex="0" aria-label="Toggle ' +
            esc(lg) +
            '">' +
            '<h2 class="league-name">' +
            esc(lg) +
            "</h2>" +
            '<span class="league-badge">' +
            list.length +
            (list.length === 1 ? " match" : " matches") +
            "</span>" +
            '<span class="league-toggle">&#9660;</span>' +
            "</div>" +
            '<div class="league-body">' +
            '<div class="coupon-matches-grid">' +
            leagueCards +
            "</div>" +
            "</div>" +
            "</section>"
          );
        })
        .join("");

      cardsHtml = hotPicksHtml + leaguesHtml;
    }

    var metrics = computeCouponAccumulator();
    var slipHtml = renderCouponSlipHtml(metrics);
    var mobileBarHtml = renderCouponMobileBarHtml(metrics);

    var wasDrawerOpen = false;
    var oldSlipCol = document.getElementById("coupon-slip-column");
    if (oldSlipCol && oldSlipCol.classList.contains("drawer-open")) {
      wasDrawerOpen = true;
    }
    if (COUPON_SLIP.length === 0) wasDrawerOpen = false;

    $main.innerHTML =
      '<div class="coupon-container">' +
      '<div class="coupon-header-panel">' +
      '<div class="coupon-title-row">' +
      '<div class="coupon-headline">' +
      "<span>Data-Driven Coupon & Bet Builder</span>" +
      '<span class="coupon-headline-pill">POISSON &amp; H2H PREDICTIVE LOGIC</span>' +
      "</div>" +
      "</div>" +
      '<p class="coupon-subtext">' +
      "Outright win probabilities are computed using <strong>bivariate Poisson goal distributions</strong> based on historical venue attack/defense rates, calibrated against <strong>empirical head-to-head records</strong>. Add selections to calculate cumulative accumulator probabilities, fair decimal odds, and expected payouts." +
      "</p>" +
      "</div>" +
      '<div class="coupon-layout">' +
      '<div class="coupon-matches-column">' +
      cardsHtml +
      "</div>" +
      '<div class="coupon-slip-column' +
      (wasDrawerOpen ? " drawer-open" : "") +
      '" id="coupon-slip-column">' +
      slipHtml +
      "</div>" +
      "</div>" +
      '<div class="coupon-drawer-backdrop' +
      (wasDrawerOpen ? " active" : "") +
      '" id="coupon-drawer-backdrop" data-action="close-mobile-drawer"></div>' +
      '<div id="coupon-mobile-bar-wrap">' +
      mobileBarHtml +
      "</div>" +
      "</div>";
  }

  // ── Upcoming Fixtures View ────────────────────────────────────
  function renderFixturesView() {
    $filterBar.style.display = "none";
    $customBanner.classList.remove("visible");

    if (!F || !F.fixtures || !F.fixtures.length) {
      $stats.innerHTML =
        '<div class="stat-chip"><strong>0</strong> upcoming fixtures</div>';
      $main.innerHTML =
        '<div class="empty-state"><h2>NO FIXTURES LOADED</h2><p>Could not find fixtures in fixtures.js. Run <code>python export_fixtures.py</code> to download upcoming matches.</p></div>';
      return;
    }

    // Build today's date string in DD/MM/YYYY to match fixture format
    const _now = new Date();
    const _todayStr =
      String(_now.getDate()).padStart(2, "0") +
      "/" +
      String(_now.getMonth() + 1).padStart(2, "0") +
      "/" +
      _now.getFullYear();

    const filtered = F.fixtures.filter((fix) => {
      if (fTodayOnly && fix.date !== _todayStr) return false;
      if (fLeague && fix.league !== fLeague) return false;
      const h = fix.home.toLowerCase();
      const a = fix.away.toLowerCase();

      if (fTeam) {
        const matchHome = h.includes(fTeam);
        const matchAway = a.includes(fTeam);
        if (!matchHome && !matchAway) return false;
      }

      if (fOpp) {
        const matchHome = h.includes(fOpp);
        const matchAway = a.includes(fOpp);
        if (!matchHome && !matchAway) return false;
      }

      return true;
    });

    // Group by league preserving order of occurrence
    const groups = {};
    const leaguesOrder = [];
    filtered.forEach((fix) => {
      if (!groups[fix.league]) {
        groups[fix.league] = [];
        leaguesOrder.push(fix.league);
      }
      groups[fix.league].push(fix);
    });

    // Stats strip — includes Today Only toggle
    const updatedDate = F.updated
      ? new Date(F.updated).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    $stats.innerHTML =
      `<div class="stat-chip"><strong>${leaguesOrder.length}</strong> leagues</div>` +
      `<div class="stat-chip"><strong>${filtered.length}</strong> upcoming fixtures</div>` +
      (updatedDate
        ? `<div class="stat-chip">Feed: <strong>${esc(updatedDate)}</strong></div>`
        : "") +
      `<label class="stat-chip stat-chip-toggle" for="filter-today-only" title="Show only today&#39;s matches">` +
      `<input type="checkbox" id="filter-today-only"${fTodayOnly ? " checked" : ""}>` +
      `<span class="today-toggle-track"></span>` +
      `<span class="today-toggle-label">Today Only</span>` +
      `</label>`;

    // Re-bind the Today Only checkbox after each render (element is recreated)
    const $todayCb = document.getElementById("filter-today-only");
    if ($todayCb) {
      $todayCb.addEventListener("change", () => {
        fTodayOnly = $todayCb.checked;
        render();
      });
    }

    if (!filtered.length) {
      $main.innerHTML = fTodayOnly
        ? '<div class="empty-state"><h2>No fixtures today</h2><p>There are no matches scheduled for today in the current filters.</p></div>'
        : '<div class="empty-state"><h2>No fixtures match filters</h2><p>Try resetting the team or league filter.</p></div>';
      return;
    }

    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const initialCollapse = isMobile ? " collapsed" : "";

    const parts = [];
    leaguesOrder.forEach((lg, idx) => {
      const list = groups[lg];
      const cardsHtml = list.map(renderFixtureCard).join("");

      parts.push(
        `<section class="league-section${initialCollapse}" style="animation-delay:${idx * 30}ms">` +
          `<div class="league-header" role="button" tabindex="0" aria-label="Toggle ${esc(lg)}">` +
          `<h2 class="league-name">${esc(lg)}</h2>` +
          `<span class="league-badge">${list.length} ${list.length === 1 ? "fixture" : "fixtures"}</span>` +
          `<span class="league-toggle">&#9660;</span></div>` +
          `<div class="league-body"><div class="fixtures-grid">${cardsHtml}</div></div>` +
          `</section>`,
      );
    });

    $main.innerHTML = parts.join("");
  }

  // ── Results & Backtesting View ──────────────────────────────────
  function parseMatchDateTs(dStr) {
    if (!dStr) return 0;
    const p = dStr.split("/");
    if (p.length === 3) return new Date(p[2], p[1] - 1, p[0]).getTime();
    return 0;
  }

  function formatResultDisplayDate(dStr) {
    if (!dStr) return "";
    const p = dStr.split("/");
    if (p.length === 3) {
      const d = new Date(p[2], p[1] - 1, p[0]);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${days[d.getDay()]} ${p[0]} ${months[d.getMonth()]} ${p[2]}`;
    }
    return dStr;
  }

  function getResultTeamCrestHtml(team) {
    const logo = TEAM_LOGOS_MAP[team];
    if (logo) {
      return `<img class="result-team-logo" src="${esc(logo)}" alt="${esc(team)}" loading="lazy" onerror="this.style.display='none'">`;
    }
    const words = team.split(" ");
    const initials = words.length > 1
      ? (words[0][0] + words[1][0]).toUpperCase()
      : team.substring(0, 3).toUpperCase();
    return `<span class="result-team-badge-fallback">${esc(initials)}</span>`;
  }

  function renderResultsView(fullRebuild) {
    $filterBar.style.display = "none";
    $customBanner.classList.remove("visible");

    // Asynchronously populate logos from api_test.json if not yet loaded
    if (!TEST_DATA && !testDataLoading) {
      loadTestFixtures().then(() => {
        if (activeTab === "results") renderResultsView(false);
      });
    }

    if (!D || !D.m || !D.m.length) {
      $stats.innerHTML = '<div class="stat-chip">0 results evaluated</div>';
      $main.innerHTML =
        '<div class="empty-state"><h2>DATA NOT LOADED</h2><p>Could not find match data in data.js.</p></div>';
      return;
    }

    // Collect all 26/27 leagues
    const leagues2627 = [];
    const seenBaseLeagues = new Set();
    D.l.forEach((lg) => {
      if (lg.includes("26/27")) {
        leagues2627.push(lg);
        seenBaseLeagues.add(baseLeague(lg));
      }
    });

    // Find all 26/27 matches & determine max date timestamp
    let maxDateTs = 0;
    const matches2627 = [];
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const lgName = D.l[m[M.LG]];
      if (lgName && lgName.includes("26/27")) {
        const ts = parseMatchDateTs(m[M.DATE]);
        if (ts > maxDateTs) maxDateTs = ts;
        matches2627.push({ m, ts, lgName });
      }
    }

    if (!matches2627.length) {
      $stats.innerHTML = '<div class="stat-chip">0 completed 26/27 matches</div>';
      $main.innerHTML =
        '<div class="empty-state"><h2>NO 26/27 MATCHES FOUND</h2><p>No completed matches were found for the 26/27 season.</p></div>';
      return;
    }

    // 1. Timeframe filtering
    const gwCutoff = maxDateTs - 7 * 86400 * 1000;
    const monthCutoff = maxDateTs - 30 * 86400 * 1000;

    const inTimeframe = matches2627.filter((item) => {
      if (rTimeframe === "gameweek") return item.ts >= gwCutoff;
      if (rTimeframe === "month") return item.ts >= monthCutoff;
      return true; // "season"
    });

    // 2. League filtering
    const inLeague = inTimeframe.filter((item) => {
      if (!rLeague) return true;
      return item.lgName === rLeague || baseLeague(item.lgName) === rLeague;
    });

    // 3. Search filtering (supports both inline results search and top header search bar)
    const searchLow = (rSearch || fTeam || "").trim().toLowerCase();
    const oppLow = (fOpp || "").trim().toLowerCase();
    const evaluatedAll = [];

    inLeague.forEach((item) => {
      const m = item.m;
      const home = teamName(m[M.HOME]);
      const away = teamName(m[M.AWAY]);

      if (searchLow) {
        const hMatch = home.toLowerCase().includes(searchLow);
        const aMatch = away.toLowerCase().includes(searchLow);
        if (!hMatch && !aMatch) return;
      }

      if (oppLow) {
        const hOpp = home.toLowerCase().includes(oppLow);
        const aOpp = away.toLowerCase().includes(oppLow);
        if (!hOpp && !aOpp) return;
      }

      const pred = predictMatchOutright(home, away);
      let pick = "H", pickLabel = "Home Win", pickProb = pred.probH;
      if (pred.probA > pred.probH && pred.probA >= pred.probD) {
        pick = "A";
        pickLabel = "Away Win";
        pickProb = pred.probA;
      } else if (pred.probD > pred.probH && pred.probD > pred.probA) {
        pick = "D";
        pickLabel = "Draw";
        pickProb = pred.probD;
      }

      const actualFTR = m[M.FTR]; // 'H', 'D', 'A'
      const isHit = pick === actualFTR;
      const isHighConf = pickProb >= 50;

      // Sub-market predictions
      const hStats = TEAM_STATS[home];
      const aStats = TEAM_STATS[away];

      const expHtG =
        hStats && aStats
          ? (hStats.hHtGoal / (hStats.homeMatches || 1) + aStats.aHtGoal / (aStats.awayMatches || 1)) / 2
          : 0;
      const htGoalPick = expHtG >= 0.65;
      const actualHtGoal = (m[M.HTHG] || 0) + (m[M.HTAG] || 0) > 0;

      const expC10 =
        hStats && aStats
          ? (hStats.hC10 / (hStats.homeMatches || 1) + aStats.aC10 / (aStats.awayMatches || 1)) / 2
          : 0;
      const c10Pick = expC10 >= 0.50;
      const actualC10 = m[M.C10] === 1 || ((m[M.HC] || 0) + (m[M.AC] || 0)) >= 10;
      const totalCorners = (m[M.HC] || 0) + (m[M.AC] || 0);

      let actualLabel = "Draw";
      if (actualFTR === "H") actualLabel = "Home Win";
      else if (actualFTR === "A") actualLabel = "Away Win";

      evaluatedAll.push({
        m,
        ts: item.ts,
        lgName: item.lgName,
        home,
        away,
        fthg: m[M.FTHG],
        ftag: m[M.FTAG],
        hthg: m[M.HTHG],
        htag: m[M.HTAG],
        hc: m[M.HC] || 0,
        ac: m[M.AC] || 0,
        totalCorners,
        pred,
        pick,
        pickLabel,
        pickProb,
        actualFTR,
        actualLabel,
        isHit,
        isHighConf,
        htGoalPick,
        actualHtGoal,
        c10Pick,
        actualC10,
      });
    });

    // Check if search yields matches across full season if 0 in current timeframe
    let seasonMatchesForSearchCount = 0;
    if (searchLow && rTimeframe !== "season") {
      seasonMatchesForSearchCount = matches2627.filter((item) => {
        const h = teamName(item.m[M.HOME]).toLowerCase();
        const a = teamName(item.m[M.AWAY]).toLowerCase();
        return h.includes(searchLow) || a.includes(searchLow);
      }).length;
    }

    // 4. Compute Executive KPIs across all evaluated matches for this timeframe & league
    const totalEval = evaluatedAll.length;
    const hitsCount = evaluatedAll.filter((x) => x.isHit).length;
    const accPct = totalEval ? ((hitsCount / totalEval) * 100).toFixed(1) : "0.0";

    const hcMatches = evaluatedAll.filter((x) => x.isHighConf);
    const hcHits = hcMatches.filter((x) => x.isHit).length;
    const hcPct = hcMatches.length ? ((hcHits / hcMatches.length) * 100).toFixed(1) : "0.0";

    const htPicks = evaluatedAll.filter((x) => x.htGoalPick);
    const htHits = htPicks.filter((x) => x.actualHtGoal).length;
    const htPct = htPicks.length ? ((htHits / htPicks.length) * 100).toFixed(1) : "0.0";

    const c10Picks = evaluatedAll.filter((x) => x.c10Pick);
    const c10Hits = c10Picks.filter((x) => x.actualC10).length;
    const c10Pct = c10Picks.length ? ((c10Hits / c10Picks.length) * 100).toFixed(1) : "0.0";

    // 5. Outcome filtering for display feed
    const displayMatches = evaluatedAll.filter((x) => {
      if (rFilter === "hits") return x.isHit;
      if (rFilter === "misses") return !x.isHit;
      if (rFilter === "high_conf") return x.isHighConf;
      return true; // "all"
    });

    // Sort newest first
    displayMatches.sort((a, b) => b.ts - a.ts);

    // Update stats bar strip
    $stats.innerHTML =
      `<div class="stat-chip">Evaluated: <strong>${totalEval}</strong> matches</div>` +
      `<div class="stat-chip">Model Accuracy: <strong>${accPct}%</strong> (${hitsCount}/${totalEval})</div>` +
      `<div class="stat-chip">High Confidence: <strong>${hcPct}%</strong> (${hcHits}/${hcMatches.length})</div>` +
      `<div class="stat-chip">1st Half Goals: <strong>${htPct}%</strong> (${htHits}/${htPicks.length})</div>`;

    // 6. Build KPI Grid HTML
    const kpisGridHtml =
      // KPI 1: 1X2 Accuracy
      `<div class="results-kpi-card accent-green">` +
      `<div class="results-kpi-label">Overall 1X2 Accuracy</div>` +
      `<div class="results-kpi-val">${accPct}%</div>` +
      `<div class="results-kpi-meta"><span class="kpi-count">${hitsCount} ${hitsCount === 1 ? "Hit" : "Hits"}</span> / ${totalEval} Finished</div>` +
      `<div class="results-kpi-bar"><div class="results-kpi-bar-fill green" style="width:${Math.min(100, Math.max(5, accPct))}%"></div></div>` +
      `</div>` +
      // KPI 2: High Confidence Accuracy
      `<div class="results-kpi-card accent-cyan">` +
      `<div class="results-kpi-label">High-Confidence Picks (≥50%)</div>` +
      `<div class="results-kpi-val">${hcPct}%</div>` +
      `<div class="results-kpi-meta"><span class="kpi-count">${hcHits} ${hcHits === 1 ? "Hit" : "Hits"}</span> / ${hcMatches.length} Qualified</div>` +
      `<div class="results-kpi-bar"><div class="results-kpi-bar-fill cyan" style="width:${Math.min(100, Math.max(5, hcPct))}%"></div></div>` +
      `</div>` +
      // KPI 3: 1st Half Goal Hit Rate
      `<div class="results-kpi-card accent-purple">` +
      `<div class="results-kpi-label">1st Half Goal Hit Rate</div>` +
      `<div class="results-kpi-val">${htPct}%</div>` +
      `<div class="results-kpi-meta"><span class="kpi-count">${htHits} ${htHits === 1 ? "Hit" : "Hits"}</span> / ${htPicks.length} Qualified (≥65%)</div>` +
      `<div class="results-kpi-bar"><div class="results-kpi-bar-fill purple" style="width:${Math.min(100, Math.max(5, htPct))}%"></div></div>` +
      `</div>` +
      // KPI 4: 10+ Corners Hit Rate
      `<div class="results-kpi-card accent-amber">` +
      `<div class="results-kpi-label">10+ Corners Hit Rate</div>` +
      `<div class="results-kpi-val">${c10Pct}%</div>` +
      `<div class="results-kpi-meta"><span class="kpi-count">${c10Hits} ${c10Hits === 1 ? "Hit" : "Hits"}</span> / ${c10Picks.length} Qualified (≥50%)</div>` +
      `<div class="results-kpi-bar"><div class="results-kpi-bar-fill amber" style="width:${Math.min(100, Math.max(5, c10Pct))}%"></div></div>` +
      `</div>`;

    // Outcome Tabs HTML
    const outcomeTabsHtml =
      `<button type="button" class="results-outcome-tab${rFilter === "all" ? " active" : ""}" data-rfilter="all">All (${totalEval})</button>` +
      `<button type="button" class="results-outcome-tab hit${rFilter === "hits" ? " active" : ""}" data-rfilter="hits">✓ Hits (${hitsCount})</button>` +
      `<button type="button" class="results-outcome-tab miss${rFilter === "misses" ? " active" : ""}" data-rfilter="misses">✕ Misses (${totalEval - hitsCount})</button>` +
      `<button type="button" class="results-outcome-tab high-conf${rFilter === "high_conf" ? " active" : ""}" data-rfilter="high_conf">★ High Conf (${hcMatches.length})</button>`;

    // Match Cards HTML
    let cardsHtml = "";
    if (!displayMatches.length) {
      if (searchLow && seasonMatchesForSearchCount > 0 && rTimeframe !== "season") {
        cardsHtml =
          `<div class="results-empty-card">` +
          `<div class="results-empty-icon" aria-hidden="true">⚽</div>` +
          `<h3>No matches for "${esc(searchLow)}" in ${rTimeframe === "gameweek" ? "Latest Gameweek" : "Last 30 Days"}</h3>` +
          `<p>Found <strong>${seasonMatchesForSearchCount}</strong> completed matches across the full 26/27 season.</p>` +
          `<button type="button" class="results-switch-season-btn" id="btn-switch-season">View All ${seasonMatchesForSearchCount} Season Matches</button>` +
          `</div>`;
      } else {
        cardsHtml =
          `<div class="results-empty-card">` +
          `<div class="results-empty-icon" aria-hidden="true">⚽</div>` +
          `<h3>No match results found</h3>` +
          `<p>No finished matches matched your current timeframe, competition, or search filters.</p>` +
          `</div>`;
      }
    } else {
      cardsHtml = `<div class="results-feed">` + displayMatches.map(renderResultMatchCard).join("") + `</div>`;
    }

    // 7. Check if results container is already mounted
    const $container = $("results-container");
    const canDoTargetedUpdate = $container && fullRebuild !== true;

    if (canDoTargetedUpdate) {
      // Targeted DOM update: never recreate search input or filter panel
      const $kpiGrid = $("results-kpi-grid");
      if ($kpiGrid) $kpiGrid.innerHTML = kpisGridHtml;

      const $outcomeTabs = $("results-outcome-tabs");
      if ($outcomeTabs) $outcomeTabs.innerHTML = outcomeTabsHtml;

      const $feedWrap = $("results-feed-wrap");
      if ($feedWrap) $feedWrap.innerHTML = cardsHtml;

      // Update clear button visibility
      const $clearBtn = $("results-search-clear");
      if ($clearBtn) {
        $clearBtn.style.display = rSearch ? "inline-flex" : "none";
      }

      // Re-bind outcome tabs and season switch button
      bindResultsOutcomeTabs();
      bindSeasonSwitchBtn();
      return;
    }

    // Full Rebuild (initial render or switching views)
    // Capture existing search focus and caret position if rebuilding
    const $existingSearch = $("results-search-input");
    const searchHadFocus = $existingSearch && document.activeElement === $existingSearch;
    const selStart = searchHadFocus ? $existingSearch.selectionStart : null;
    const selEnd = searchHadFocus ? $existingSearch.selectionEnd : null;

    let leagueOptionsHtml = '<option value="">All 26/27 Leagues (20 Competitions)</option>';
    leagues2627.forEach((lg) => {
      const selected = rLeague === lg ? ' selected="selected"' : "";
      leagueOptionsHtml += `<option value="${esc(lg)}"${selected}>${esc(baseLeague(lg))}</option>`;
    });

    const kpisHtml =
      `<div class="results-header-panel">` +
      `<div class="results-title-row">` +
      `<div class="results-title-group">` +
      `<div class="results-headline">` +
      `<span class="results-pulse-dot" aria-hidden="true"></span>` +
      `<h2>Model Performance & Verification</h2>` +
      `</div>` +
      `<p class="results-subtext">` +
      `Retrospective backtesting of Poisson expected goals and 1X2 outright probability predictions compared against finished 2026/27 domestic league fixtures.` +
      `</p>` +
      `</div>` +
      `</div>` +
      `<div class="results-kpi-grid" id="results-kpi-grid">${kpisGridHtml}</div>` +
      `</div>`;

    const filterControlsHtml =
      `<div class="results-filter-panel" id="results-filter-panel">` +
      `<div class="results-filter-top">` +
      // Timeframe Selector
      `<div class="results-timeframe-group">` +
      `<span class="results-filter-label">Timeframe:</span>` +
      `<div class="results-pill-group">` +
      `<button type="button" class="results-pill-btn${rTimeframe === "gameweek" ? " active" : ""}" data-rtimeframe="gameweek">Latest Gameweek</button>` +
      `<button type="button" class="results-pill-btn${rTimeframe === "month" ? " active" : ""}" data-rtimeframe="month">Last 30 Days</button>` +
      `<button type="button" class="results-pill-btn${rTimeframe === "season" ? " active" : ""}" data-rtimeframe="season">Full 26/27 Season</button>` +
      `</div>` +
      `</div>` +
      // League Selector
      `<div class="results-league-group">` +
      `<span class="results-filter-label">Competition:</span>` +
      `<select class="results-select" id="results-league-select" aria-label="Filter competition">${leagueOptionsHtml}</select>` +
      `</div>` +
      `</div>` +
      // Filter Sub-bar: Outcome filter tabs + Search box
      `<div class="results-filter-bottom">` +
      `<div class="results-outcome-tabs" id="results-outcome-tabs">${outcomeTabsHtml}</div>` +
      `<div class="results-search-wrap">` +
      `<span class="results-search-icon" aria-hidden="true">🔍</span>` +
      `<input type="text" id="results-search-input" class="results-search-input" placeholder="Search team (e.g. Arsenal, Real Madrid)..." autocomplete="off" spellcheck="false" aria-label="Search team by name" value="${esc(rSearch)}">` +
      `<button type="button" class="results-search-clear" id="results-search-clear" aria-label="Clear search" style="${rSearch ? "display:inline-flex;" : "display:none;"}">✕</button>` +
      `</div>` +
      `</div>` +
      `</div>`;

    $main.innerHTML =
      `<div class="results-container" id="results-container">` +
      kpisHtml +
      filterControlsHtml +
      `<div class="results-feed-wrap" id="results-feed-wrap">${cardsHtml}</div>` +
      `</div>`;

    // 8. Bind interactive events
    bindResultsEvents();
    bindSeasonSwitchBtn();

    // Restore search focus and cursor selection if it had focus
    if (searchHadFocus) {
      const $newSearch = $("results-search-input");
      if ($newSearch) {
        $newSearch.focus();
        if (selStart !== null && selEnd !== null) {
          $newSearch.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }

  function renderResultMatchCard(res) {
    const isHit = res.isHit;
    const verdictClass = isHit ? "verdict-hit" : "verdict-miss";
    const verdictIcon = isHit ? "✓" : "✕";
    const verdictText = isHit ? "HIT" : "MISS";

    const homeCrestHtml = getResultTeamCrestHtml(res.home);
    const awayCrestHtml = getResultTeamCrestHtml(res.away);
    const displayDate = formatResultDisplayDate(res.m[M.DATE]);
    const lgNameClean = baseLeague(res.lgName);

    // Probability segments
    const pH = res.pred.probH;
    const pD = res.pred.probD;
    const pA = res.pred.probA;

    const isHighConfBadge = res.isHighConf
      ? `<span class="result-highconf-badge" title="High confidence prediction (≥50% probability)">★ High Conf (${res.pickProb}%)</span>`
      : "";

    // Submarket chips
    const actualHtText = res.actualHtGoal ? `Yes (HT ${res.hthg}-${res.htag})` : "No (HT 0-0)";
    const htPickBadge = res.htGoalPick
      ? (res.actualHtGoal
          ? `<span class="res-sub-badge hit">✓ Pick Hit</span>`
          : `<span class="res-sub-badge miss">✕ Pick Miss</span>`)
      : "";

    const actualC10Text = `${res.totalCorners} (${res.hc}-${res.ac})`;
    const c10PickBadge = res.c10Pick
      ? (res.actualC10
          ? `<span class="res-sub-badge hit">✓ 10+ Hit</span>`
          : `<span class="res-sub-badge miss">✕ 10+ Miss</span>`)
      : "";

    return (
      `<div class="result-match-card ${verdictClass}">` +
      // Top header row: League, Date, Verdict Badge
      `<div class="result-match-header">` +
      `<div class="result-match-meta">` +
      `<span class="result-league-badge">${esc(lgNameClean)}</span>` +
      `<span class="result-match-date">${esc(displayDate)}</span>` +
      isHighConfBadge +
      `</div>` +
      `<div class="result-verdict-pill ${verdictClass}">` +
      `<span class="result-verdict-icon">${verdictIcon}</span>` +
      `<span class="result-verdict-text">${verdictText}</span>` +
      `</div>` +
      `</div>` +
      // Scoreboard matchup row
      `<div class="result-scoreboard">` +
      `<div class="result-team home">` +
      `<span class="result-team-name">${esc(res.home)}</span>` +
      homeCrestHtml +
      `</div>` +
      `<div class="result-score-block">` +
      `<div class="result-ft-score">${res.fthg} - ${res.ftag}</div>` +
      `<div class="result-ht-score">HT ${res.hthg}-${res.htag}</div>` +
      `</div>` +
      `<div class="result-team away">` +
      awayCrestHtml +
      `<span class="result-team-name">${esc(res.away)}</span>` +
      `</div>` +
      `</div>` +
      // Prediction Banner
      `<div class="result-pred-banner">` +
      `<div class="result-pred-line">` +
      `<span class="result-pred-tag">Model Pick:</span>` +
      `<strong class="result-pred-pick-name">${esc(res.pickLabel)} (${res.pickProb}%)</strong>` +
      `<span class="result-actual-line">Actual Result: <strong>${esc(res.actualLabel)}</strong></span>` +
      `</div>` +
      // 1X2 Probability bar (with flex-shrink and proportionality)
      `<div class="result-prob-bar-container">` +
      `<div class="result-prob-bar">` +
      `<div class="result-prob-segment seg-h${res.pick === "H" ? " selected" : ""}" style="width:${pH}%;flex:${pH} 1 0%;" title="Home: ${pH}%">` +
      `<span>H ${pH}%</span>` +
      `</div>` +
      `<div class="result-prob-segment seg-d${res.pick === "D" ? " selected" : ""}" style="width:${pD}%;flex:${pD} 1 0%;" title="Draw: ${pD}%">` +
      `<span>D ${pD}%</span>` +
      `</div>` +
      `<div class="result-prob-segment seg-a${res.pick === "A" ? " selected" : ""}" style="width:${pA}%;flex:${pA} 1 0%;" title="Away: ${pA}%">` +
      `<span>A ${pA}%</span>` +
      `</div>` +
      `</div>` +
      `</div>` +
      // Sub-markets detail strip
      `<div class="result-submarkets-strip">` +
      `<div class="result-sub-item">` +
      `<span class="sub-dim">xG:</span> <strong>${res.pred.lambda.toFixed(2)} - ${res.pred.mu.toFixed(2)}</strong>` +
      `</div>` +
      `<div class="result-sub-item">` +
      `<span class="sub-dim">1st Half Goal:</span> <strong>${actualHtText}</strong>${htPickBadge}` +
      `</div>` +
      `<div class="result-sub-item">` +
      `<span class="sub-dim">Corners:</span> <strong>${actualC10Text}</strong>${c10PickBadge}` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</div>`
    );
  }

  function bindResultsOutcomeTabs() {
    document.querySelectorAll("#results-outcome-tabs [data-rfilter]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const filt = tab.dataset.rfilter;
        if (rFilter !== filt) {
          rFilter = filt;
          renderResultsView(false);
        }
      });
    });
  }

  function bindSeasonSwitchBtn() {
    const $switchBtn = $("btn-switch-season");
    if ($switchBtn) {
      $switchBtn.addEventListener("click", () => {
        rTimeframe = "season";
        renderResultsView(true);
      });
    }
  }

  function bindResultsEvents() {
    // Timeframe selector
    document.querySelectorAll("[data-rtimeframe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tf = btn.dataset.rtimeframe;
        if (rTimeframe !== tf) {
          rTimeframe = tf;
          renderResultsView(true);
        }
      });
    });

    // Competition selector
    const $lgSelect = $("results-league-select");
    if ($lgSelect) {
      $lgSelect.addEventListener("change", (e) => {
        rLeague = e.target.value;
        renderResultsView(true);
      });
    }

    // Outcome filter tabs
    bindResultsOutcomeTabs();

    // Team search input: non-destructive updates with keystroke debounce
    const $search = $("results-search-input");
    if ($search) {
      let debTimer;
      $search.addEventListener("input", (e) => {
        clearTimeout(debTimer);
        rSearch = e.target.value; // Store raw value, preserving spaces!
        debTimer = setTimeout(() => {
          renderResultsView(false); // Non-destructive targeted update
        }, 150);
      });

      $search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(debTimer);
          rSearch = e.target.value;
          renderResultsView(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          clearTimeout(debTimer);
          rSearch = "";
          $search.value = "";
          renderResultsView(false);
        }
      });
    }

    const $clearBtn = $("results-search-clear");
    if ($clearBtn) {
      $clearBtn.addEventListener("click", () => {
        rSearch = "";
        const $sInp = $("results-search-input");
        if ($sInp) {
          $sInp.value = "";
          $sInp.focus();
        }
        renderResultsView(false);
      });
    }
  }

  // ── Test View (Live Scores API / api_test.json) ───────────────
  async function renderTestView() {
    $filterBar.style.display = "none";
    $customBanner.classList.remove("visible");

    if (!TEST_DATA) {
      $stats.innerHTML =
        '<div class="stat-chip">Loading <strong>api_test.json</strong>...</div>';
      $main.innerHTML =
        '<div class="test-loading-state">' +
        '<div class="test-spinner"></div>' +
        '<p style="color:var(--text-secondary);font-family:var(--font-metrics);font-size:0.85rem;">' +
        "Fetching test fixtures from api_test.json..." +
        "</p>" +
        "</div>";
      await loadTestFixtures();
      if (activeTab !== "test") return;
    }

    if (!TEST_DATA || !TEST_DATA.fixtures || !TEST_DATA.fixtures.length) {
      $stats.innerHTML =
        '<div class="stat-chip"><strong>0</strong> test fixtures</div>';
      $main.innerHTML =
        '<div class="empty-state"><h2>NO TEST FIXTURES LOADED</h2><p>Could not find fixtures in <code>api_test.json</code>. Run <code>python api_fixtures.py</code> to download upcoming matches from the Live Scores API.</p></div>';
      return;
    }

    const now = new Date();
    const todayStr =
      String(now.getDate()).padStart(2, "0") +
      "/" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "/" +
      now.getFullYear();

    const allFix = TEST_DATA.fixtures || [];
    const filtered = allFix.filter((fix) => {
      if (fTodayOnly && fix.date !== todayStr) return false;
      if (
        fLeague &&
        fix.competition !== fLeague &&
        fix.competition_slug !== fLeague
      )
        return false;
      const h = (fix.home || "").toLowerCase();
      const a = (fix.away || "").toLowerCase();

      if (fTeam) {
        const matchHome = h.includes(fTeam);
        const matchAway = a.includes(fTeam);
        if (!matchHome && !matchAway) return false;
      }

      if (fOpp) {
        const matchHome = h.includes(fOpp);
        const matchAway = a.includes(fOpp);
        if (!matchHome && !matchAway) return false;
      }

      return true;
    });

    // Group by competition
    const groups = {};
    const compOrder = [];
    filtered.forEach((fix) => {
      const comp = fix.competition || "Other";
      if (!groups[comp]) {
        groups[comp] = [];
        compOrder.push(comp);
      }
      groups[comp].push(fix);
    });

    // Stats strip
    const dateRangeStr =
      TEST_DATA.date_range &&
      TEST_DATA.date_range.from &&
      TEST_DATA.date_range.to
        ? `${TEST_DATA.date_range.from.slice(5)} to ${TEST_DATA.date_range.to.slice(5)}`
        : "Next 4 Weeks";

    $stats.innerHTML =
      `<div class="stat-chip"><strong>${compOrder.length}</strong> competitions</div>` +
      `<div class="stat-chip"><strong>${filtered.length}</strong> fixtures</div>` +
      `<div class="stat-chip">Window: <strong>${esc(dateRangeStr)}</strong></div>` +
      `<div class="stat-chip" style="border-color: rgba(0, 240, 255, 0.4);"><strong style="color:var(--neon-cyan);">Live</strong></div>` +
      `<label class="stat-chip stat-chip-toggle test-toggle" for="filter-today-only" title="Show only today's matches">` +
      `<input type="checkbox" id="filter-today-only"${fTodayOnly ? " checked" : ""}>` +
      `<span class="today-toggle-track"></span>` +
      `<span class="today-toggle-label">Today Only</span>` +
      `</label>`;

    const $todayCb = document.getElementById("filter-today-only");
    if ($todayCb) {
      $todayCb.addEventListener("change", () => {
        fTodayOnly = $todayCb.checked;
        render();
      });
    }

    if (!filtered.length) {
      $main.innerHTML = fTodayOnly
        ? '<div class="empty-state"><h2>No fixtures today</h2><p>There are no matches scheduled for today in the current filters.</p></div>'
        : '<div class="empty-state"><h2>No fixtures match filters</h2><p>Try resetting the team or league filter.</p></div>';
      return;
    }

    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const initialCollapse = isMobile ? " collapsed" : "";

    const leagueCardsHtml = compOrder
      .map((comp, idx) => {
        const list = groups[comp];
        const compSlug =
          list[0] && list[0].competition_slug ? list[0].competition_slug : "";
        const rowsHtml = list.map(renderTestFixtureRow).join("");

        return (
          `<section class="test-league-card${initialCollapse}" style="animation-delay:${idx * 35}ms">` +
          `<div class="test-league-header" role="button" tabindex="0" aria-label="Toggle ${esc(comp)}">` +
          `<div class="test-league-title-group">` +
          `<h2 class="test-league-name">${esc(comp)}</h2>` +
          `<span class="test-league-badge">${list.length} ${list.length === 1 ? "fixture" : "fixtures"}</span>` +
          `</div>` +
          `<span class="test-league-toggle">&#9660;</span>` +
          `</div>` +
          `<div class="test-league-body">${rowsHtml}</div>` +
          `</section>`
        );
      })
      .join("");

    $main.innerHTML =
      `<div class="test-container">` +
      `<div class="test-header-panel">` +
      `<div class="test-title-row">` +
      `<div class="test-headline">` +
      `<span>Live Scores API Fixture Feed</span>` +
      `<span class="test-headline-pill">REST API · 4-WEEK CALENDAR</span>` +
      `</div>` +
      `</div>` +
      `<p class="test-subtext">` +
      `Live fixture schedule imported from <strong>worldcup26.ir</strong> for the Premier League, Championship, FA Cup, and League Cup. Each competition is grouped into a dedicated card with sub-card fixture rows and official team crests.` +
      `</p>` +
      `</div>` +
      leagueCardsHtml +
      `</div>`;
  }

  function formatGmtTime24(fix) {
    if (fix.timestamp_utc) {
      try {
        const d = new Date(fix.timestamp_utc);
        if (!isNaN(d.getTime())) {
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const mm = String(d.getUTCMinutes()).padStart(2, "0");
          return `${hh}:${mm}`;
        }
      } catch (e) {}
    }
    if (fix.time && /^\d{1,2}:\d{2}$/.test(fix.time.trim())) {
      const parts = fix.time.trim().split(":");
      return `${parts[0].padStart(2, "0")}:${parts[1]}`;
    }
    return fix.time || "TBD";
  }

  function getTestFixtureDayName(fix) {
    if (fix.timestamp_utc) {
      try {
        const d = new Date(fix.timestamp_utc);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("en-GB", {
            weekday: "short",
            timeZone: "UTC",
          });
        }
      } catch (e) {}
    }
    return "";
  }

  function renderTestFixtureRow(fix) {
    const homeName = fix.home || "Home";
    const awayName = fix.away || "Away";
    const homeShort = fix.home_short || homeName;
    const awayShort = fix.away_short || awayName;
    const homeLogo = fix.home_logo || "";
    const awayLogo = fix.away_logo || "";
    const venue = fix.venue || "TBD";

    const gmtTime = formatGmtTime24(fix);
    const dayName = getTestFixtureDayName(fix);
    const rawDetail = (fix.status_detail || "").trim();
    const rawStatus = (fix.status || "").trim();

    let statusText = gmtTime;
    let statusClass = " scheduled";

    if (
      rawStatus === "STATUS_FULL_TIME" ||
      rawDetail === "FT" ||
      rawStatus === "STATUS_FINAL_AET"
    ) {
      statusText =
        rawDetail === "AET" || rawStatus === "STATUS_FINAL_AET" ? "AET" : "FT";
      statusClass = " ft";
    } else if (
      rawStatus === "STATUS_IN_PROGRESS" ||
      rawStatus === "STATUS_FIRST_HALF" ||
      rawStatus === "STATUS_SECOND_HALF" ||
      rawStatus === "STATUS_HALFTIME" ||
      rawDetail.toLowerCase().includes("live") ||
      rawDetail === "HT" ||
      /^\d+'$/.test(rawDetail)
    ) {
      statusText =
        rawDetail === "HT" || rawStatus === "STATUS_HALFTIME"
          ? "HT"
          : rawDetail && rawDetail.length <= 4
            ? rawDetail
            : "LIVE";
      statusClass = " live";
    } else if (
      rawStatus === "STATUS_POSTPONED" ||
      rawStatus === "STATUS_CANCELED" ||
      rawDetail.toLowerCase().includes("postpon") ||
      rawDetail.toLowerCase().includes("cancel")
    ) {
      statusText = "POSTP";
      statusClass = " postponed";
    } else {
      statusText = gmtTime;
      statusClass = " scheduled";
    }

    const homeLogoHtml = homeLogo
      ? `<img class="test-team-logo" src="${esc(homeLogo)}" alt="${esc(homeName)}" loading="lazy" onerror="this.style.display='none'">`
      : "";
    const awayLogoHtml = awayLogo
      ? `<img class="test-team-logo" src="${esc(awayLogo)}" alt="${esc(awayName)}" loading="lazy" onerror="this.style.display='none'">`
      : "";

    return (
      `<div class="test-fixture-row">` +
      // Mobile top bar (visible on mobile only)
      `<div class="test-row-top-mobile test-row-mobile-only">` +
      `<div class="test-mobile-meta-left">` +
      `<span class="test-row-date">${esc(fix.date)}</span>` +
      (venue && venue !== "TBD"
        ? `<span class="test-row-meta-sep">·</span><span class="test-row-venue" title="${esc(venue)}">${esc(venue)}</span>`
        : "") +
      `</div>` +
      `<span class="test-status-pill${statusClass}">${esc(statusText)}</span>` +
      `</div>` +
      // Desktop Left Meta (Date, Day)
      `<div class="test-row-meta test-row-desktop-only">` +
      `<span class="test-row-date">${esc(fix.date)}</span>` +
      (dayName ? `<span class="test-row-day">${esc(dayName)}</span>` : "") +
      `</div>` +
      // Matchup (Home Logo + Name vs Away Logo + Name)
      `<div class="test-row-matchup">` +
      `<div class="test-team-cell home" title="${esc(homeName)}">` +
      `<span class="test-team-name">${esc(homeShort)}</span>` +
      homeLogoHtml +
      `</div>` +
      `<span class="test-vs-badge">VS</span>` +
      `<div class="test-team-cell away" title="${esc(awayName)}">` +
      awayLogoHtml +
      `<span class="test-team-name">${esc(awayShort)}</span>` +
      `</div>` +
      `</div>` +
      // Desktop Right Info (Venue, Status)
      `<div class="test-row-info test-row-desktop-only">` +
      `<span class="test-row-venue" title="${esc(venue)}">${esc(venue)}</span>` +
      `<span class="test-status-pill${statusClass}">${esc(statusText)}</span>` +
      `</div>` +
      `</div>`
    );
  }

  // ── Decimal → Fractional odds conversion ─────────────────────
  function decimalToFractional(dec) {
    if (!dec || dec <= 1) return "—";
    var num = Math.round((dec - 1) * 100);
    var den = 100;
    var g = gcd(num, den);
    return num / g + "/" + den / g;
  }

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
    M.DATE;
  }

  // ── H2H history: home team at home vs away team ───────────────
  function getH2HAtHome(homeTeam, awayTeam) {
    if (!D || !D.m) return [];
    var results = [];
    for (var i = 0, len = D.m.length; i < len; i++) {
      var m = D.m[i];
      var h = teamName(m[M.HOME]);
      var a = teamName(m[M.AWAY]);
      if (h === homeTeam && a === awayTeam) {
        results.push(m);
      }
    }
    results.sort(function (a, b) {
      var pa = a[M.DATE].split("/");
      var pb = b[M.DATE].split("/");
      var da = pa[2] + pa[1] + pa[0];
      var db = pb[2] + pb[1] + pb[0];
      return db.localeCompare(da);
    });
    return results;
  }

  // ── First-half goal % calculation ─────────────────────────────
  function calcFirstHalfGoalPct(homeTeam, awayTeam, h2h) {
    var homeHtRate = null;
    var awayHtRate = null;

    if (D && D.m) {
      var homeHtTotal = 0,
        homeHtGoal = 0;
      var awayHtTotal = 0,
        awayHtGoal = 0;

      for (var i = 0, len = D.m.length; i < len; i++) {
        var m = D.m[i];
        var h = teamName(m[M.HOME]);
        var a = teamName(m[M.AWAY]);

        if (h === homeTeam) {
          homeHtTotal++;
          if (m[M.HTHG] + m[M.HTAG] > 0) homeHtGoal++;
        }
        if (a === awayTeam) {
          awayHtTotal++;
          if (m[M.HTHG] + m[M.HTAG] > 0) awayHtGoal++;
        }
      }

      if (homeHtTotal >= 3) homeHtRate = homeHtGoal / homeHtTotal;
      if (awayHtTotal >= 3) awayHtRate = awayHtGoal / awayHtTotal;
    }

    var h2hHtRate = null;
    if (h2h.length >= 2) {
      var h2hGoal = h2h.filter(function (m) {
        return m[M.HTHG] + m[M.HTAG] > 0;
      }).length;
      h2hHtRate = h2hGoal / h2h.length;
    }

    var signals = [];
    if (homeHtRate !== null) signals.push(homeHtRate);
    if (awayHtRate !== null) signals.push(awayHtRate);
    if (h2hHtRate !== null) signals.push(h2hHtRate);
    if (!signals.length) return null;

    var avg =
      signals.reduce(function (s, v) {
        return s + v;
      }, 0) / signals.length;
    return Math.round(avg * 100);
  }

  // ── 10+ Corners % calculation ──────────────────────────────────
  function calcCorners10PlusPct(homeTeam, awayTeam, h2h) {
    var homeRate = null;
    var awayRate = null;

    if (D && D.m) {
      var homeTotal = 0,
        homeC10 = 0;
      var awayTotal = 0,
        awayC10 = 0;

      for (var i = 0, len = D.m.length; i < len; i++) {
        var m = D.m[i];
        var h = teamName(m[M.HOME]);
        var a = teamName(m[M.AWAY]);

        if (h === homeTeam) {
          homeTotal++;
          if (m[M.C10]) homeC10++;
        }
        if (a === awayTeam) {
          awayTotal++;
          if (m[M.C10]) awayC10++;
        }
      }

      if (homeTotal >= 3) homeRate = homeC10 / homeTotal;
      if (awayTotal >= 3) awayRate = awayC10 / awayTotal;
    }

    var h2hRate = null;
    if (h2h.length >= 2) {
      var h2hC10 = h2h.filter(function (m) {
        return m[M.C10];
      }).length;
      h2hRate = h2hC10 / h2h.length;
    }

    var signals = [];
    if (homeRate !== null) signals.push(homeRate);
    if (awayRate !== null) signals.push(awayRate);
    if (h2hRate !== null) signals.push(h2hRate);
    if (!signals.length) return null;

    var avg =
      signals.reduce(function (s, v) {
        return s + v;
      }, 0) / signals.length;
    return Math.round(avg * 100);
  }

  function renderFixtureCard(fix) {
    var home = fix.home;
    var away = fix.away;

    var homeStats = "";
    var awayStats = "";

    if (TEAM_STATS[home] && TEAM_STATS[home].homeMatches > 0) {
      var pctH = Math.round(
        (TEAM_STATS[home].w2h / TEAM_STATS[home].homeMatches) * 100,
      );
      homeStats =
        '<span class="fixture-stats-hint">Home 2+ W: <strong>' +
        pctH +
        "%</strong></span>";
    }
    if (TEAM_STATS[away] && TEAM_STATS[away].awayMatches > 0) {
      var pctA = Math.round(
        (TEAM_STATS[away].w2a / TEAM_STATS[away].awayMatches) * 100,
      );
      awayStats =
        '<span class="fixture-stats-hint">Away 2+ W: <strong>' +
        pctA +
        "%</strong></span>";
    }

    // Fractional odds
    var oddsHtml = "";
    if (fix.odds && (fix.odds.h || fix.odds.d || fix.odds.a)) {
      var fh = decimalToFractional(fix.odds.h);
      var fd = decimalToFractional(fix.odds.d);
      var fa = decimalToFractional(fix.odds.a);
      oddsHtml =
        '<div class="fixture-odds-strip" title="Market 1X2 Odds (fractional)">' +
        '<div class="odds-item"><span class="odds-label">Home</span><span class="odds-val">' +
        fh +
        "</span></div>" +
        '<div class="odds-divider"></div>' +
        '<div class="odds-item"><span class="odds-label">Draw</span><span class="odds-val">' +
        fd +
        "</span></div>" +
        '<div class="odds-divider"></div>' +
        '<div class="odds-item"><span class="odds-label">Away</span><span class="odds-val">' +
        fa +
        "</span></div>" +
        "</div>";
    }

    // H2H (home team at home vs away team)
    var h2h = getH2HAtHome(home, away);
    var htGoalPct = calcFirstHalfGoalPct(home, away, h2h);
    var c10Pct = calcCorners10PlusPct(home, away, h2h);

    var h2hHtml = "";
    if (h2h.length === 0) {
      h2hHtml =
        '<div class="fixture-h2h-empty">No Previous Meetings Currently in The Database</div>';
    } else if (h2h.length > 0) {
      var recent = h2h.slice(0, 6);
      var rows = recent
        .map(function (m) {
          var res = m[M.FTR] === "H" ? "W" : m[M.FTR] === "A" ? "L" : "D";
          var resCls = res === "W" ? "bw" : res === "L" ? "bl" : "bd";
          var htGoals = m[M.HTHG] + m[M.HTAG];
          var htFlag =
            htGoals > 0
              ? '<span class="h2h-ht-goal">\u26bd HT</span>'
              : '<span class="h2h-ht-nil">0-0 HT</span>';
          var c10Flag = m[M.C10]
            ? '<span class="h2h-c10-pill" title="Home: ' +
              m[M.HC] +
              " \u00b7 Away: " +
              m[M.AC] +
              '">' +
              m[M.TC] +
              "</span>"
            : '<span class="h2h-c10-sub" title="Home: ' +
              m[M.HC] +
              " \u00b7 Away: " +
              m[M.AC] +
              '">' +
              m[M.TC] +
              "</span>";
          return (
            "<tr>" +
            '<td class="h2h-date">' +
            '<span class="h2h-date-full">' +
            esc(m[M.DATE]) +
            "</span>" +
            '<span class="h2h-date-year">' +
            esc(m[M.DATE].slice(-4)) +
            "</span>" +
            "</td>" +
            '<td class="h2h-score">' +
            m[M.FTHG] +
            "\u2013" +
            m[M.FTAG] +
            "</td>" +
            '<td class="h2h-ht">' +
            m[M.HTHG] +
            "\u2013" +
            m[M.HTAG] +
            "</td>" +
            "<td>" +
            htFlag +
            "</td>" +
            '<td class="h2h-corners">' +
            c10Flag +
            "</td>" +
            '<td><span class="b ' +
            resCls +
            '">' +
            res +
            "</span></td>" +
            "</tr>"
          );
        })
        .join("");

      h2hHtml =
        '<div class="fixture-h2h">' +
        '<div class="h2h-header">' +
        '<span class="h2h-title">H2H at Home</span>' +
        '<span class="h2h-count">' +
        h2h.length +
        " previous</span>" +
        "</div>" +
        '<table class="h2h-table"><thead><tr>' +
        "<th>Date</th><th>FT</th><th>HT</th><th>1st Half</th><th>Corners</th><th>Res</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table>" +
        "</div>";
    }

    // First-half goal probability
    var htProbHtml = "";
    if (htGoalPct !== null) {
      var barColor =
        htGoalPct >= 70
          ? "var(--neon-green)"
          : htGoalPct >= 45
            ? "var(--neon-yellow)"
            : "var(--neon-red)";
      var sources = [];
      if (TEAM_STATS[home] && TEAM_STATS[home].homeMatches >= 3)
        sources.push(esc(home) + " (home)");
      if (TEAM_STATS[away] && TEAM_STATS[away].awayMatches >= 3)
        sources.push(esc(away) + " (away)");
      if (h2h.length >= 2) sources.push("H2H (" + h2h.length + ")");
      htProbHtml =
        '<div class="fixture-ht-prob">' +
        '<div class="ht-prob-label">' +
        "<span>\u26bd 1st Half Goal Probability</span>" +
        '<span class="ht-prob-pct" style="color:' +
        barColor +
        '">' +
        htGoalPct +
        "%</span>" +
        "</div>" +
        '<div class="ht-prob-bar-bg">' +
        '<div class="ht-prob-bar-fill" style="width:' +
        htGoalPct +
        "%;background:" +
        barColor +
        '"></div>' +
        "</div>" +
        '<div class="ht-prob-sources">' +
        sources.join(" \u00b7 ") +
        "</div>" +
        "</div>";
    }

    // 10+ Corners probability
    var c10ProbHtml = "";
    if (c10Pct !== null) {
      var c10BarColor =
        c10Pct >= 70
          ? "var(--neon-green)"
          : c10Pct >= 45
            ? "var(--neon-yellow)"
            : "var(--neon-red)";
      var c10Sources = [];
      if (TEAM_STATS[home] && TEAM_STATS[home].homeMatches >= 3)
        c10Sources.push(esc(home) + " (home)");
      if (TEAM_STATS[away] && TEAM_STATS[away].awayMatches >= 3)
        c10Sources.push(esc(away) + " (away)");
      if (h2h.length >= 2) c10Sources.push("H2H (" + h2h.length + ")");
      c10ProbHtml =
        '<div class="fixture-c10-prob">' +
        '<div class="c10-prob-label">' +
        "<span>\ud83d\udea9 10+ Corners Probability</span>" +
        '<span class="c10-prob-pct" style="color:' +
        c10BarColor +
        '">' +
        c10Pct +
        "%</span>" +
        "</div>" +
        '<div class="c10-prob-bar-bg">' +
        '<div class="c10-prob-bar-fill" style="width:' +
        c10Pct +
        "%;background:" +
        c10BarColor +
        '"></div>' +
        "</div>" +
        '<div class="c10-prob-sources">' +
        c10Sources.join(" \u00b7 ") +
        "</div>" +
        "</div>";
    }

    // Coupon quick-add chips
    var matchId = (fix.date || "") + "_" + home + "_" + away;
    var outrightPred = predictMatchOutright(home, away, h2h, fix.odds);
    var curLeg = getCouponLeg(matchId);

    var couponChipsHtml =
      '<div class="fixture-coupon-bar" data-fixture-id="' +
      esc(matchId) +
      '">' +
      '<span class="fixture-coupon-label"><span class="fixture-coupon-dot"></span>Add to Coupon:</span>' +
      '<div class="fixture-coupon-chips">' +
      '<button class="fixture-coupon-chip' +
      (curLeg && curLeg.pick === "1" ? " active" : "") +
      '" data-action="quick-coupon" data-mid="' +
      esc(matchId) +
      '" data-pick="1" data-home="' +
      esc(home) +
      '" data-away="' +
      esc(away) +
      '" data-lg="' +
      esc(fix.league) +
      '" data-date="' +
      esc(fix.date) +
      '" data-time="' +
      esc(fix.time) +
      '" data-prob="' +
      outrightPred.probH +
      '" data-odds="' +
      (outrightPred.oddsH || "") +
      '" data-fair="' +
      outrightPred.fairOddsH +
      '" title="Home Win (Model: ' +
      outrightPred.probH +
      '%)">1: ' +
      outrightPred.probH +
      "%</button>" +
      '<button class="fixture-coupon-chip' +
      (curLeg && curLeg.pick === "X" ? " active" : "") +
      '" data-action="quick-coupon" data-mid="' +
      esc(matchId) +
      '" data-pick="X" data-home="' +
      esc(home) +
      '" data-away="' +
      esc(away) +
      '" data-lg="' +
      esc(fix.league) +
      '" data-date="' +
      esc(fix.date) +
      '" data-time="' +
      esc(fix.time) +
      '" data-prob="' +
      outrightPred.probD +
      '" data-odds="' +
      (outrightPred.oddsD || "") +
      '" data-fair="' +
      outrightPred.fairOddsD +
      '" title="Draw (Model: ' +
      outrightPred.probD +
      '%)">X: ' +
      outrightPred.probD +
      "%</button>" +
      '<button class="fixture-coupon-chip' +
      (curLeg && curLeg.pick === "2" ? " active" : "") +
      '" data-action="quick-coupon" data-mid="' +
      esc(matchId) +
      '" data-pick="2" data-home="' +
      esc(home) +
      '" data-away="' +
      esc(away) +
      '" data-lg="' +
      esc(fix.league) +
      '" data-date="' +
      esc(fix.date) +
      '" data-time="' +
      esc(fix.time) +
      '" data-prob="' +
      outrightPred.probA +
      '" data-odds="' +
      (outrightPred.oddsA || "") +
      '" data-fair="' +
      outrightPred.fairOddsA +
      '" title="Away Win (Model: ' +
      outrightPred.probA +
      '%)">2: ' +
      outrightPred.probA +
      "%</button>" +
      "</div>" +
      "</div>";

    return (
      '<div class="fixture-card">' +
      '<div class="fixture-header">' +
      '<div class="fixture-date-chip">' +
      "<span>" +
      esc(fix.date) +
      " ·" +
      "</span>" +
      '<span class="fixture-time-badge">' +
      esc(fix.time) +
      "</span>" +
      "</div>" +
      "</div>" +
      '<div class="fixture-teams">' +
      '<div class="fixture-team home">' +
      '<span class="fixture-team-name">' +
      esc(home) +
      "</span>" +
      homeStats +
      "</div>" +
      '<div class="fixture-vs">VS</div>' +
      '<div class="fixture-team away">' +
      '<span class="fixture-team-name">' +
      esc(away) +
      "</span>" +
      awayStats +
      "</div>" +
      "</div>" +
      oddsHtml +
      h2hHtml +
      htProbHtml +
      c10ProbHtml +
      couponChipsHtml +
      "</div>"
    );
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();

// ── PWA: Service Worker & Install/Update Management ────────────────
(function () {
  if (!("serviceWorker" in navigator)) return;

  var $updateBanner = document.getElementById("pwa-update-banner");
  var $updateBtn = document.getElementById("pwa-update-btn");
  var $updateDismiss = document.getElementById("pwa-update-dismiss");
  var $installBanner = document.getElementById("pwa-install-banner");
  var $installBtn = document.getElementById("pwa-install-btn");
  var $installDismiss = document.getElementById("pwa-dismiss-btn");

  var waitingSW = null;

  function showUpdateBanner() {
    $updateBanner.classList.add("visible");
  }
  function hideUpdateBanner() {
    $updateBanner.classList.remove("visible");
  }

  // Watch a registration for a waiting SW
  function trackRegistration(reg) {
    if (reg.waiting) {
      waitingSW = reg.waiting;
      showUpdateBanner();
    }
    reg.addEventListener("updatefound", function () {
      var newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener("statechange", function () {
        if (newSW.state === "installed" && navigator.serviceWorker.controller) {
          waitingSW = newSW;
          showUpdateBanner();
        }
      });
    });
  }

  // Update banner: tell SW to skip waiting, then reload when it takes control
  $updateBtn.addEventListener("click", function () {
    if (waitingSW) {
      waitingSW.postMessage({ type: "SKIP_WAITING" });
    }
  });
  $updateDismiss.addEventListener("click", hideUpdateBanner);

  // When the active SW changes, reload to get the new version
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    window.location.reload();
  });

  // Register SW, track for updates, poll every 60s for long-lived sessions
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        console.log("[FootyStats SW] Registered, scope:", reg.scope);
        trackRegistration(reg);
        setInterval(function () {
          reg.update().catch(function () {
            /* offline, ignore */
          });
        }, 60000);
      })
      .catch(function (err) {
        console.warn("[FootyStats SW] Registration failed:", err);
      });
  });

  // ── PWA Install Banner & A2HS Prompt Logic ────────────────────
  var deferredPrompt = null;
  var DISMISS_KEY = "pwa-install-dismissed";

  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function isDismissedRecently() {
    try {
      var t = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
      return Date.now() - t < 7 * 24 * 60 * 60 * 1000; // 7-day cooldown
    } catch (e) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    } catch (e) {}
  }

  // Handle Chromium beforeinstallprompt event
  window.addEventListener("beforeinstallprompt", function (e) {
    // Prevent browser default mini-infobar so custom styled banner is used
    e.preventDefault();
    deferredPrompt = e;

    if (!isStandalone && !isDismissedRecently()) {
      setTimeout(function () {
        if (!isStandalone && !isDismissedRecently()) {
          $installBanner.classList.add("visible");
        }
      }, 3000);
    }
  });

  // Fallback for iOS Safari (beforeinstallprompt is unsupported on Apple WebKit)
  if (isIOS && !isStandalone && !isDismissedRecently()) {
    var $sub = $installBanner.querySelector(".pwa-banner-sub");
    if ($sub) {
      $sub.textContent = "Tap Share ⎋ then 'Add to Home Screen' ⊞";
    }
    if ($installBtn) {
      $installBtn.style.display = "none";
    }
    setTimeout(function () {
      if (!isStandalone && !isDismissedRecently()) {
        $installBanner.classList.add("visible");
      }
    }, 4000);
  }

  // Install button click handler (Chromium)
  $installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      deferredPrompt = null;
      $installBanner.classList.remove("visible");
      if (choice && choice.outcome === "dismissed") {
        markDismissed();
      }
    });
  });

  // Dismiss button click handler
  $installDismiss.addEventListener("click", function () {
    $installBanner.classList.remove("visible");
    deferredPrompt = null;
    markDismissed();
  });

  // When successfully installed, remove banner and mark dismissed
  window.addEventListener("appinstalled", function () {
    $installBanner.classList.remove("visible");
    deferredPrompt = null;
    markDismissed();
  });
})();
