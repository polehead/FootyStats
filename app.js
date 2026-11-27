/* ═══════════════════════════════════════════════════════════════════
   FootyStats Analyser — Main Application Script (app.js)
   ═══════════════════════════════════════════════════════════════════
   Table of Contents:
   1. Compact Match Schema & Index Constants (M)
   2. Global State & Dataset References (D, F, TEAM_STATS, WINS_2PLUS_STATS, COUPON_SLIP)
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

// ── Shared Top-Layer Dialog & Animation Helpers ────────────────────
const FootyDialogs = (function () {
  "use strict";

  const hasNativePopover = Object.hasOwn(HTMLElement.prototype, "popover");
  let supportsDisplayTransition;

  // Reliably probe discrete `display` transition support (guards against Firefox bug 1882408
  // where CSS.supports('transition-behavior', 'allow-discrete') returns true without animating display)
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined)
      return supportsDisplayTransition;
    if (
      !window.CSS ||
      !window.CSS.supports ||
      !window.CSS.supports("transition-behavior", "allow-discrete") ||
      !document.body
    ) {
      return false;
    }
    const probe = document.createElement("div");
    probe.style.cssText =
      "transition: display 1s allow-discrete !important; display: block;";
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = "none";
    supportsDisplayTransition = getComputedStyle(probe).display === "block";
    probe.remove();
    return supportsDisplayTransition;
  }

  function supportsTopLayerExit() {
    return (
      Boolean(
        window.CSS &&
        window.CSS.supports &&
        window.CSS.supports("overlay", "auto"),
      ) && canTransitionDisplay()
    );
  }

  function isPopoverDialog(el) {
    return hasNativePopover && el.hasAttribute("popover");
  }

  function isOpen(el) {
    if (!el) return false;
    if (isPopoverDialog(el)) {
      try {
        return el.matches(":popover-open");
      } catch (_) {
        return Boolean(el.open);
      }
    }
    return Boolean(el.open);
  }

  function open(el, opts) {
    if (!el) return;
    const modal = Boolean(opts && opts.modal);
    el.removeAttribute("data-closing");
    if (modal) {
      if (!el.open && typeof el.showModal === "function") {
        el.showModal();
      }
      return;
    }
    if (isPopoverDialog(el)) {
      if (!isOpen(el)) {
        el.showPopover();
      }
    } else if (!el.open && typeof el.show === "function") {
      el.show();
    }
  }

  async function close(el) {
    if (!el || !isOpen(el)) return;
    if (el.hasAttribute("data-closing")) return;

    if (!supportsTopLayerExit()) {
      el.setAttribute("data-closing", "");
      const animations =
        typeof el.getAnimations === "function"
          ? el.getAnimations({ subtree: true })
          : [];
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      }
      if (!el.hasAttribute("data-closing")) return;
      el.removeAttribute("data-closing");
    }

    if (isPopoverDialog(el)) {
      if (isOpen(el)) el.hidePopover();
    } else if (el.open && typeof el.close === "function") {
      el.close();
    }
  }

  // Enhance modal dialogs:
  // 1) Route native cancel (Esc / closedby) through close() when top-layer exit fallback is needed
  // 2) Provide bounding-rect pointerdown/pointerup light-dismiss fallback when closedBy is unsupported
  function enhanceModal(dialog) {
    if (!dialog || dialog.dataset.modalEnhanced) return;
    dialog.dataset.modalEnhanced = "1";

    dialog.addEventListener("cancel", (event) => {
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        close(dialog);
      }
    });

    if (
      !("closedBy" in HTMLDialogElement.prototype) &&
      dialog.getAttribute("closedby") === "any"
    ) {
      const outside = (e) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e)) {
          close(dialog);
        }
        pressedOutside = false;
      });
    }
  }

  return { open, close, isOpen, enhanceModal };
})();

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
  const WINS_2PLUS_STATS = {};
  const CORNERS_10PLUS_STATS = {};

  // ── Team Crests & Badges ───────────────────────────────────────
  function getTeamInitials(team) {
    if (!team) return "";
    const words = team.trim().split(/\s+/);
    if (words.length > 1) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return team.substring(0, 3).toUpperCase();
  }

  function getTeamBadgeHtml(teamName, className) {
    className = className || "team-badge";
    const logoUrl =
      (typeof TEAM_LOGOS !== "undefined" &&
        TEAM_LOGOS &&
        TEAM_LOGOS[teamName]) ||
      "";
    const fullClass =
      className === "team-badge" ? "team-badge" : "team-badge " + className;
    const fullFallbackClass =
      className === "team-badge"
        ? "team-badge-fallback"
        : "team-badge-fallback " + className + "-fallback";
    if (logoUrl) {
      return (
        `<img class="${esc(fullClass)}" src="${esc(logoUrl)}" alt="${esc(teamName)}" loading="lazy" ` +
        `onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline-flex';">` +
        `<span class="${esc(fullFallbackClass)}" style="display:none;" aria-hidden="true">${esc(getTeamInitials(teamName))}</span>`
      );
    }
    return `<span class="${esc(fullFallbackClass)}" aria-hidden="true">${esc(getTeamInitials(teamName))}</span>`;
  }
  const getTeamCrestHtml = getTeamBadgeHtml;

  function getLeagueCrestHtml(leagueName, className) {
    className = className || "league-logo";
    const base = String(leagueName || "")
      .replace(/\s+\d{2}\/\d{2}$/, "")
      .trim();
    const logoUrl =
      typeof LEAGUE_LOGOS !== "undefined" && LEAGUE_LOGOS
        ? LEAGUE_LOGOS[base]
        : null;
    if (logoUrl) {
      const fullClass = "league-logo " + className;
      return (
        `<img class="${esc(fullClass)}" src="${esc(logoUrl)}" alt="${esc(base)}" loading="lazy" ` +
        `onerror="this.style.display='none';">`
      );
    }
    return "";
  }
  let activeTab = "fixtures";
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

  // Precompute neutral predictive & venue performance rates (decoupled from 2+ win filters)
  function computeTeamStats() {
    if (!D || !D.m) return;
    D.t.forEach((name) => {
      TEAM_STATS[name] = {
        total: 0,
        homeMatches: 0,
        awayMatches: 0,
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
      const htGoal = (m[M.HTHG] || 0) + (m[M.HTAG] || 0) > 0;
      const c10Hit = m[M.C10] === 1 || (m[M.HC] || 0) + (m[M.AC] || 0) >= 10;
      if (TEAM_STATS[h]) {
        const tsH = TEAM_STATS[h];
        tsH.total++;
        tsH.homeMatches++;
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

  function _recordWin2Side(bucket, isHome, isHit) {
    if (isHome) {
      bucket.homeMatches++;
      if (isHit) bucket.w2h++;
    } else {
      bucket.awayMatches++;
      if (isHit) bucket.w2a++;
    }
  }

  // Isolated 2+ goal win rate aggregator used strictly by the Wins 2+ Goals tab
  function computeWins2PlusStats() {
    if (!D || !D.m) return;
    D.t.forEach((name) => {
      WINS_2PLUS_STATS[name] = {
        homeMatches: 0,
        awayMatches: 0,
        w2h: 0,
        w2a: 0,
        byLeague: {},
      };
    });
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const h = teamName(m[M.HOME]);
      const a = teamName(m[M.AWAY]);
      const lgName = D.l[m[M.LG]];
      const sides = [
        [h, true, m[M.W2H]],
        [a, false, m[M.W2A]],
      ];
      for (let s = 0; s < sides.length; s++) {
        const [team, isHome, isHit] = sides[s];
        const ts = WINS_2PLUS_STATS[team];
        if (!ts) continue;
        _recordWin2Side(ts, isHome, isHit);
        if (lgName) {
          if (!ts.byLeague[lgName]) {
            ts.byLeague[lgName] = {
              homeMatches: 0,
              awayMatches: 0,
              w2h: 0,
              w2a: 0,
            };
          }
          _recordWin2Side(ts.byLeague[lgName], isHome, isHit);
        }
      }
    }
  }

  function _recordCorner10Side(bucket, isHome, isHit) {
    if (isHome) {
      bucket.homeMatches++;
      if (isHit) bucket.c10h++;
    } else {
      bucket.awayMatches++;
      if (isHit) bucket.c10a++;
    }
  }

  // Isolated 10+ corners rate aggregator used strictly by the Corners tab
  function computeCorners10PlusStats() {
    if (!D || !D.m) return;
    D.t.forEach((name) => {
      CORNERS_10PLUS_STATS[name] = {
        homeMatches: 0,
        awayMatches: 0,
        c10h: 0,
        c10a: 0,
        byLeague: {},
      };
    });
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      // Exclude matches where corner statistics were untracked (e.g. National League)
      if (!m[M.HC] && !m[M.AC] && !m[M.TC]) continue;
      const h = teamName(m[M.HOME]);
      const a = teamName(m[M.AWAY]);
      const lgName = D.l[m[M.LG]];
      const isC10 = m[M.C10] ? 1 : 0;
      const sides = [
        [h, true, isC10],
        [a, false, isC10],
      ];
      for (let s = 0; s < sides.length; s++) {
        const [team, isHome, isHit] = sides[s];
        const ts = CORNERS_10PLUS_STATS[team];
        if (!ts) continue;
        _recordCorner10Side(ts, isHome, isHit);
        if (lgName) {
          if (!ts.byLeague[lgName]) {
            ts.byLeague[lgName] = {
              homeMatches: 0,
              awayMatches: 0,
              c10h: 0,
              c10a: 0,
            };
          }
          _recordCorner10Side(ts.byLeague[lgName], isHome, isHit);
        }
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

  // ── Chronological xG + Underlying Stats + Elo Rating Engine ───
  const MODEL_RATINGS = {
    teams: {},
    leagues: {},
    preMatch2627: {},
  };

  function parseDateKeyInt(dateStr) {
    if (!dateStr) return 0;
    const p = dateStr.split("/");
    if (p.length !== 3) return 0;
    return parseInt(p[2], 10) * 10000 + parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
  }

  function computeModelRatings() {
    MODEL_RATINGS.teams = {};
    MODEL_RATINGS.leagues = {};
    MODEL_RATINGS.preMatch2627 = {};
    if (!D || !D.m || !D.m.length) return;

    const bsdMeta = D.bsd2627 || {};
    const rows = new Array(D.m.length);
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      rows[i] = { m, dk: parseDateKeyInt(m[M.DATE]), idx: i };
    }
    rows.sort((a, b) => a.dk - b.dk || a.idx - b.idx);

    const teams = MODEL_RATINGS.teams;
    const leagues = MODEL_RATINGS.leagues;
    const ensureT = (name) =>
      teams[name] ||
      (teams[name] = { att: 1.0, def: 1.0, elo: 1500, n: 0, lastSeason: "" });
    const ensureL = (bl) =>
      leagues[bl] || (leagues[bl] = { w: 0, hg: 0, ag: 0 });

    const SEASON_REG = 0.30;
    const LR = 0.05;
    const ELO_K = 20;
    const HOME_ELO = 55;
    const ELO_XG_W = 0.45;

    for (let i = 0, len = rows.length; i < len; i++) {
      const m = rows[i].m;
      const lgName = D.l[m[M.LG]] || "";
      const bl = baseLeague(lgName);
      const season = lgName.slice(-5);
      const is2627 = lgName.includes("26/27");
      const h = teamName(m[M.HOME]);
      const a = teamName(m[M.AWAY]);
      const fthg = m[M.FTHG] || 0;
      const ftag = m[M.FTAG] || 0;
      const ftr = m[M.FTR];

      const ht = ensureT(h);
      const at = ensureT(a);
      const lt = ensureL(bl);

      // Inter-season mean regression for squad turnover & promotion/relegation
      if (ht.lastSeason && ht.lastSeason !== season) {
        ht.att = 1.0 + (ht.att - 1.0) * (1 - SEASON_REG);
        ht.def = 1.0 + (ht.def - 1.0) * (1 - SEASON_REG);
        ht.elo = 1500 + (ht.elo - 1500) * (1 - SEASON_REG);
      }
      ht.lastSeason = season;

      if (at.lastSeason && at.lastSeason !== season) {
        at.att = 1.0 + (at.att - 1.0) * (1 - SEASON_REG);
        at.def = 1.0 + (at.def - 1.0) * (1 - SEASON_REG);
        at.elo = 1500 + (at.elo - 1500) * (1 - SEASON_REG);
      }
      at.lastSeason = season;

      const baseH = lt.w >= 30 ? lt.hg / lt.w : 1.48;
      const baseA = lt.w >= 30 ? lt.ag / lt.w : 1.18;
      const matchKey = is2627 ? lgName + "|" + m[M.DATE] + "|" + h + "|" + a : "";
      const meta = matchKey ? bsdMeta[matchKey] : null;

      // Snapshot strict pre-match ratings for zero-lookahead Results backtesting
      if (is2627) {
        MODEL_RATINGS.preMatch2627[matchKey] = {
          hAtt: ht.att,
          hDef: ht.def,
          hElo: ht.elo,
          aAtt: at.att,
          aDef: at.def,
          aElo: at.elo,
          baseH: baseH,
          baseA: baseA,
          derby: Boolean(meta && meta.derby),
        };
      }

      // Build composite underlying attacking output (actual xG + xGOT/shots/big-chances + goals)
      const hasXg = Boolean(meta && meta.hxg != null && meta.axg != null);
      let obsH = fthg;
      let obsA = ftag;
      if (hasXg) {
        const hasXgot = meta.hxgot != null && meta.axgot != null;
        const hasShots = meta.hsot != null && meta.asot != null;
        if (hasXgot || hasShots) {
          const qH = hasXgot
            ? meta.hxgot
            : Math.min(5, 0.09 * meta.hsot + 0.32 * (meta.hbc || 0));
          const qA = hasXgot
            ? meta.axgot
            : Math.min(5, 0.09 * meta.asot + 0.32 * (meta.abc || 0));
          obsH = 0.55 * meta.hxg + 0.15 * qH + 0.30 * fthg;
          obsA = 0.55 * meta.axg + 0.15 * qA + 0.30 * ftag;
        } else {
          obsH = 0.70 * meta.hxg + 0.30 * fthg;
          obsA = 0.70 * meta.axg + 0.30 * ftag;
        }
      } else if (meta && meta.hsot != null && meta.asot != null) {
        const qH = Math.min(5, 0.09 * meta.hsot + 0.32 * (meta.hbc || 0));
        const qA = Math.min(5, 0.09 * meta.asot + 0.32 * (meta.abc || 0));
        obsH = 0.30 * qH + 0.70 * fthg;
        obsA = 0.30 * qA + 0.70 * ftag;
      }

      // Opponent-adjusted multiplicative attack/defense update (outlier-clipped)
      const expH = Math.max(0.25, baseH * ht.att * at.def);
      const expA = Math.max(0.25, baseA * at.att * ht.def);
      const errH = Math.max(-2.5, Math.min(2.5, obsH - expH));
      const errA = Math.max(-2.5, Math.min(2.5, obsA - expA));

      ht.att = Math.max(0.45, Math.min(2.1, ht.att * Math.exp((LR * errH) / Math.max(0.8, expH))));
      at.def = Math.max(0.45, Math.min(2.1, at.def * Math.exp((LR * errH) / Math.max(0.8, expH))));
      at.att = Math.max(0.45, Math.min(2.1, at.att * Math.exp((LR * errA) / Math.max(0.8, expA))));
      ht.def = Math.max(0.45, Math.min(2.1, ht.def * Math.exp((LR * errA) / Math.max(0.8, expA))));

      // xG-enhanced Elo update
      const dElo = ht.elo + (meta && meta.derby ? 35 : HOME_ELO) - at.elo;
      const eScore = 1 / (1 + Math.pow(10, -dElo / 400));
      const actRes = ftr === "H" ? 1 : ftr === "D" ? 0.5 : 0;
      let perf = actRes;
      if (hasXg) {
        const xgScore = 1 / (1 + Math.exp(-(meta.hxg - meta.axg) * 1.1));
        perf = (1 - ELO_XG_W) * actRes + ELO_XG_W * xgScore;
      }
      const margin = Math.log(Math.abs(fthg - ftag) + 1) * 0.4 + 1;
      const delta = ELO_K * margin * (perf - eScore);
      ht.elo += delta;
      at.elo -= delta;

      ht.n++;
      at.n++;
      lt.w += 1;
      lt.hg += fthg;
      lt.ag += ftag;
    }
  }

  // ── Live 26/27 League Standings (Points -> GD -> GF -> Name) ──
  const LEAGUE_STANDINGS_2627 = {};

  function computeLeagueStandings2627() {
    for (const k of Object.keys(LEAGUE_STANDINGS_2627)) {
      delete LEAGUE_STANDINGS_2627[k];
    }
    if (!D || !D.m || !D.m.length) return;

    const raw = {};
    for (let i = 0, len = D.m.length; i < len; i++) {
      const m = D.m[i];
      const lgName = D.l[m[M.LG]] || "";
      if (!lgName.includes("26/27")) continue;
      const bl = baseLeague(lgName);
      const tbl = raw[bl] || (raw[bl] = {});
      const h = teamName(m[M.HOME]);
      const a = teamName(m[M.AWAY]);
      const hg = m[M.FTHG] || 0;
      const ag = m[M.FTAG] || 0;

      if (!tbl[h]) tbl[h] = { name: h, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      if (!tbl[a]) tbl[a] = { name: a, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };

      tbl[h].p++;
      tbl[a].p++;
      tbl[h].gf += hg;
      tbl[h].ga += ag;
      tbl[a].gf += ag;
      tbl[a].ga += hg;

      if (hg > ag) {
        tbl[h].w++;
        tbl[h].pts += 3;
        tbl[a].l++;
      } else if (ag > hg) {
        tbl[a].w++;
        tbl[a].pts += 3;
        tbl[h].l++;
      } else {
        tbl[h].d++;
        tbl[a].d++;
        tbl[h].pts += 1;
        tbl[a].pts += 1;
      }
    }

    Object.keys(raw).forEach((bl) => {
      const rows = Object.values(raw[bl]).sort(
        (x, y) =>
          y.pts - x.pts ||
          (y.gf - y.ga) - (x.gf - x.ga) ||
          y.gf - x.gf ||
          x.name.localeCompare(y.name),
      );
      const map = {};
      const total = rows.length;
      for (let i = 0; i < total; i++) {
        const r = rows[i];
        map[r.name] = {
          rank: i + 1,
          total: total,
          pts: r.pts,
          p: r.p,
          w: r.w,
          d: r.d,
          l: r.l,
          gd: r.gf - r.ga,
        };
      }
      LEAGUE_STANDINGS_2627[bl] = map;
    });
  }

  function formatOrdinal(n) {
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return n + "th";
    var mod10 = n % 10;
    if (mod10 === 1) return n + "st";
    if (mod10 === 2) return n + "nd";
    if (mod10 === 3) return n + "rd";
    return n + "th";
  }

  function renderLeagueRankPill(leagueName, team) {
    var bl = baseLeague(leagueName || "");
    var tbl = LEAGUE_STANDINGS_2627[bl];
    var info = tbl && tbl[team];
    if (!info) return "";

    var ord = formatOrdinal(info.rank);
    var zoneCls = "";
    if (info.rank === 1) {
      zoneCls = " rank-leader";
    } else if (info.rank <= 4) {
      zoneCls = " rank-top";
    } else if (info.total >= 6 && info.rank >= info.total - 2) {
      zoneCls = " rank-bottom";
    }

    var gdStr = info.gd > 0 ? "+" + info.gd : String(info.gd);
    var titleAttr =
      ord +
      " in " +
      bl +
      " (26/27) \u00b7 " +
      info.pts +
      " pts (P" +
      info.p +
      " \u00b7 " +
      info.w +
      "W-" +
      info.d +
      "D-" +
      info.l +
      "L \u00b7 GD " +
      gdStr +
      ")";

    return (
      '<span class="fixture-rank-pill' +
      zoneCls +
      '" title="' +
      esc(titleAttr) +
      '">' +
      ord +
      "</span>"
    );
  }

  // ── Predictive Model: 1X2 Outright Probabilities (xG + Elo + Dixon-Coles + BSD AI Ensemble) ──
  function predictMatchOutright(homeTeam, awayTeam, h2h, odds, ctx) {
    ctx = ctx || {};
    var hStats = TEAM_STATS[homeTeam];
    var aStats = TEAM_STATS[awayTeam];

    var snap = ctx.preMatch || null;
    var ht = snap
      ? { att: snap.hAtt, def: snap.hDef, elo: snap.hElo }
      : MODEL_RATINGS.teams[homeTeam] || { att: 1.0, def: 1.0, elo: 1500 };
    var at = snap
      ? { att: snap.aAtt, def: snap.aDef, elo: snap.aElo }
      : MODEL_RATINGS.teams[awayTeam] || { att: 1.0, def: 1.0, elo: 1500 };

    var lgInfo = ctx.league
      ? MODEL_RATINGS.leagues[baseLeague(ctx.league)]
      : null;
    var baseHomeGoals = snap
      ? snap.baseH
      : lgInfo && lgInfo.w >= 30
        ? lgInfo.hg / lgInfo.w
        : 1.48;
    var baseAwayGoals = snap
      ? snap.baseA
      : lgInfo && lgInfo.w >= 30
        ? lgInfo.ag / lgInfo.w
        : 1.18;

    var isDerby = Boolean(ctx.derby || (snap && snap.derby));
    var homeEloAdv = isDerby ? 35 : 55;

    // Context modifier: unavailable/injured player net imbalance (capped)
    var injH = ctx.inj && ctx.inj.h ? ctx.inj.h : 0;
    var injA = ctx.inj && ctx.inj.a ? ctx.inj.a : 0;
    var netInj = injA - injH; // positive favors home
    var injEloAdj = Math.max(-24, Math.min(24, netInj * 6));
    var injAttMultH = Math.max(0.92, Math.min(1.08, 1 + Math.max(-4, Math.min(4, -injH * 0.012 + injA * 0.008))));
    var injAttMultA = Math.max(0.92, Math.min(1.08, 1 + Math.max(-4, Math.min(4, -injA * 0.012 + injH * 0.008))));

    // Expected Goals (lambda / mu) from opponent-adjusted xG/underlying ratings
    var lambda = baseHomeGoals * ht.att * at.def * injAttMultH;
    var mu = baseAwayGoals * at.att * ht.def * injAttMultA;

    lambda = Math.max(0.25, Math.min(4.2, lambda));
    mu = Math.max(0.25, Math.min(4.2, mu));

    // Dixon-Coles low-score correlation adjustment (fixes 0-0 / 1-1 draw calibration)
    var rho = isDerby ? -0.13 : -0.10;
    var pH = 0,
      pD = 0,
      pA = 0;
    for (var i = 0; i <= 6; i++) {
      var probI = poissonProb(i, lambda);
      for (var j = 0; j <= 6; j++) {
        var cell = probI * poissonProb(j, mu);
        var tau = 1;
        if (i === 0 && j === 0) tau = 1 - lambda * mu * rho;
        else if (i === 0 && j === 1) tau = 1 + lambda * rho;
        else if (i === 1 && j === 0) tau = 1 + mu * rho;
        else if (i === 1 && j === 1) tau = 1 - rho;
        cell *= Math.max(0.01, tau);
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

    // Blend 65% Dixon-Coles + 35% xG-Enhanced Elo (High-Confidence calibrated profile)
    var dElo = ht.elo + homeEloAdv + injEloAdj - at.elo;
    var eH = 1 / (1 + Math.pow(10, -dElo / 400));
    var eDraw = (isDerby ? 0.29 : 0.27) * Math.exp(-Math.pow(dElo / 320, 2));
    var pHE = eH * (1 - eDraw);
    var pAE = (1 - eH) * (1 - eDraw);
    pH = 0.65 * pH + 0.35 * pHE;
    pD = 0.65 * pD + 0.35 * eDraw;
    pA = 0.65 * pA + 0.35 * pAE;

    var normElo = pH + pD + pA;
    pH /= normElo;
    pD /= normElo;
    pA /= normElo;

    // Sample-shrunk venue H2H calibration (max 6% at 6+ historical meetings)
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
      var h2hW = (0.06 * Math.min(h2hLen, 6)) / 6;
      pH = (1 - h2hW) * pH + h2hW * (hWins / h2hLen);
      pD = (1 - h2hW) * pD + h2hW * (draws / h2hLen);
      pA = (1 - h2hW) * pA + h2hW * (aWins / h2hLen);

      var normH2H = pH + pD + pA;
      pH /= normH2H;
      pD /= normH2H;
      pA /= normH2H;
    }

    // Ensemble blend: 70% FootyStats (xG/Elo/DC) + 30% BSD AI ML (strictly independent of bookmaker odds)
    var usedEnsemble = false;
    var ai = ctx.aiPred;
    if (ai && ai.ph != null && ai.pd != null && ai.pa != null) {
      var aiSum = ai.ph + ai.pd + ai.pa;
      if (aiSum > 0) {
        pH = 0.70 * pH + 0.30 * (ai.ph / aiSum);
        pD = 0.70 * pD + 0.30 * (ai.pd / aiSum);
        pA = 0.70 * pA + 0.30 * (ai.pa / aiSum);
        var normEns = pH + pD + pA;
        pH /= normEns;
        pD /= normEns;
        pA /= normEns;
        if (ai.xhg != null && ai.xag != null) {
          lambda = 0.70 * lambda + 0.30 * ai.xhg;
          mu = 0.70 * mu + 0.30 * ai.xag;
        }
        usedEnsemble = true;
      }
    }

    // Fair decimal odds under the hood (displayed via decimalToFractional)
    var fairH = pH > 0 ? (1 / pH).toFixed(2) : "—";
    var fairD = pD > 0 ? (1 / pD).toFixed(2) : "—";
    var fairA = pA > 0 ? (1 / pA).toFixed(2) : "—";

    // Calculate pure Value Edge strictly vs bookmaker market odds
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
      usedEnsemble: usedEnsemble,
      modelVersion: "xg-dc-elo-v2",
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
      combinedFairOdds > 0 ? decimalToFractional(combinedFairOdds) : "—";
    var displayMktOdds =
      combinedMktOdds > 0 ? decimalToFractional(combinedMktOdds) : "—";
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

  function renderCouponSlipHtml(metrics, isModal) {
    var legsHtml = "";
    var stakeInputId = isModal
      ? "coupon-modal-stake-input"
      : "coupon-stake-input";
    var copyBtnId = isModal ? "coupon-modal-copy-btn" : "coupon-copy-btn";
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
          var effectiveOdds = decimalToFractional(
            leg.odds ? leg.odds : leg.fairOdds,
          );
          return (
            '<div class="coupon-leg-card">' +
            '<div class="coupon-leg-top">' +
            '<div class="coupon-leg-match">' +
            getTeamBadgeHtml(leg.home, "coupon-slip-team-badge") +
            " " +
            esc(leg.home) +
            " vs " +
            esc(leg.away) +
            " " +
            getTeamBadgeHtml(leg.away, "coupon-slip-team-badge") +
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
        '<span class="coupon-slip-badge" style="color:' +
        metrics.meterColor +
        ';">' +
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
        '<input type="number" id="' +
        stakeInputId +
        '" class="coupon-stake-input" aria-label="Stake amount" min="1" step="1" value="' +
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
        '<button type="button" class="coupon-copy-btn" id="' +
        copyBtnId +
        '" data-action="copy-slip">' +
        "&#128203; Copy Accumulator Summary" +
        "</button>" +
        "</div>";
    }

    var titleHtml = isModal
      ? '<h2 class="coupon-slip-title" id="coupon-slip-dialog-title">Bet Slip</h2>'
      : '<span class="coupon-slip-title">Bet Slip</span>';

    return (
      '<div class="coupon-slip">' +
      (isModal
        ? '<button type="button" class="coupon-drawer-handle" data-action="close-mobile-drawer" aria-label="Close bet slip"></button>'
        : "") +
      '<div class="coupon-slip-header">' +
      '<div class="coupon-slip-title-group">' +
      titleHtml +
      (COUPON_SLIP.length > 0
        ? '<span class="coupon-slip-badge" style="color:' +
          metrics.meterColor +
          ';">' +
          COUPON_SLIP.length +
          "</span>"
        : "") +
      "</div>" +
      '<div class="coupon-slip-actions">' +
      (COUPON_SLIP.length > 0
        ? '<button type="button" class="coupon-slip-clear-btn" data-action="clear-slip">Clear All</button>'
        : "") +
      (isModal
        ? '<button type="button" class="coupon-slip-close-btn" data-action="close-mobile-drawer" title="Close drawer" autofocus>&#10005; Close</button>'
        : "") +
      "</div>" +
      "</div>" +
      legsHtml +
      summaryHtml +
      "</div>"
    );
  }

  function openCouponSlipDialog() {
    var dlg = document.getElementById("coupon-slip-dialog");
    if (!dlg || COUPON_SLIP.length === 0) return;
    var metrics = computeCouponAccumulator();
    dlg.innerHTML = renderCouponSlipHtml(metrics, true);
    FootyDialogs.enhanceModal(dlg);
    FootyDialogs.open(dlg, { modal: true });
  }

  function closeCouponSlipDialog() {
    var dlg = document.getElementById("coupon-slip-dialog");
    if (dlg) FootyDialogs.close(dlg);
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
      '<button type="button" class="coupon-mobile-bar-btn" data-action="open-mobile-drawer">' +
      "View Slip &#x25B5;" +
      "</button>" +
      "</div>"
    );
  }

  function updateCouponSlipView() {
    var metrics = computeCouponAccumulator();

    var slipCol = document.getElementById("coupon-slip-column");
    if (slipCol) {
      slipCol.innerHTML = renderCouponSlipHtml(metrics, false);
    }

    var slipDialog = document.getElementById("coupon-slip-dialog");
    if (slipDialog && FootyDialogs.isOpen(slipDialog)) {
      if (COUPON_SLIP.length === 0) {
        FootyDialogs.close(slipDialog);
      } else {
        slipDialog.innerHTML = renderCouponSlipHtml(metrics, true);
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
      var effOdds = decimalToFractional(leg.odds ? leg.odds : leg.fairOdds);
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
    var combOddsStr = decimalToFractional(combinedOdds);
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

  // ── Mobile Navigation Peek / Scroll Discovery ──────────────────
  function initMobileNavPeek() {
    try {
      // 1. Skip if user has already experienced the peek animation
      if (localStorage.getItem("footystats_nav_peek_seen")) return;

      // 2. Skip if user prefers reduced motion
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const $tabBar = document.querySelector(".tab-bar");
      if (!$tabBar) return;

      // 3. Wait for initial DOM layout to settle, then verify horizontal overflow
      setTimeout(() => {
        // Only run on mobile/narrow viewports where the nav bar actually overflows
        if ($tabBar.scrollWidth <= $tabBar.clientWidth + 12) return;

        let aborted = false;
        const markSeenAndCleanup = () => {
          aborted = true;
          try {
            localStorage.setItem("footystats_nav_peek_seen", "1");
          } catch (_) {}
          $tabBar.classList.remove("is-peeking");
          $tabBar.removeEventListener("pointerdown", markSeenAndCleanup);
          $tabBar.removeEventListener("touchstart", markSeenAndCleanup);
        };

        // If user interacts with the tabs before/during peek, abort immediately
        $tabBar.addEventListener("pointerdown", markSeenAndCleanup, {
          once: true,
          passive: true,
        });
        $tabBar.addEventListener("touchstart", markSeenAndCleanup, {
          once: true,
          passive: true,
        });

        // Add visual peek class
        $tabBar.classList.add("is-peeking");

        // Step 1: Smoothly nudge to the right (~130px) to reveal hidden tabs
        $tabBar.scrollTo({ left: 130, behavior: "smooth" });

        // Step 2: Pause briefly so the user sees Upcoming Fixtures & Results, then glide back
        setTimeout(() => {
          if (aborted) return;
          $tabBar.scrollTo({ left: 0, behavior: "smooth" });

          // Cleanup and mark as seen
          setTimeout(() => {
            markSeenAndCleanup();
          }, 500);
        }, 550);
      }, 700);
    } catch (_) {
      // Graceful fallback if localStorage is restricted
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  (function init() {
    computeTeamStats();
    computeModelRatings();
    computeLeagueStandings2627();
    computeWins2PlusStats();
    computeCorners10PlusStats();
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
    initMobileNavPeek();
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

    function handleStakeInput(e) {
      if (e.target && e.target.classList.contains("coupon-stake-input")) {
        var val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          couponStake = val;
          saveCouponSlip();
          var metrics = computeCouponAccumulator();
          document.querySelectorAll(".coupon-stake-input").forEach((inp) => {
            if (inp !== e.target) inp.value = couponStake;
          });
          document.querySelectorAll(".coupon-payout-amount").forEach((el) => {
            el.textContent = "£" + metrics.potentialReturn;
          });
          document
            .querySelectorAll(".coupon-stake-label-group span:last-child")
            .forEach((el) => {
              el.textContent = "Profit: £" + metrics.potentialProfit;
            });
        }
      }
    }

    $main.addEventListener("input", handleStakeInput);

    // Native Modal Bet Slip Dialog event delegation & lifecycle
    const $couponSlipDialog = $("coupon-slip-dialog");
    if ($couponSlipDialog) {
      FootyDialogs.enhanceModal($couponSlipDialog);

      $couponSlipDialog.addEventListener("input", handleStakeInput);

      $couponSlipDialog.addEventListener("click", (e) => {
        if (
          e.target.closest(
            '[data-action="close-mobile-drawer"], [data-action="toggle-mobile-drawer"]',
          )
        ) {
          closeCouponSlipDialog();
          return;
        }
        const removeBtn = e.target.closest('[data-action="remove-leg"]');
        if (removeBtn) {
          removeCouponLeg(removeBtn.getAttribute("data-mid"));
          return;
        }
        const clearBtn = e.target.closest('[data-action="clear-slip"]');
        if (clearBtn) {
          clearCouponSlip();
          return;
        }
        const copyBtn = e.target.closest('[data-action="copy-slip"]');
        if (copyBtn) {
          copyCouponSummary(copyBtn);
          return;
        }
      });

      $couponSlipDialog.addEventListener("close", () => {
        $couponSlipDialog.returnValue = "";
        $couponSlipDialog.innerHTML = "";
      });

      if (window.matchMedia) {
        const desktopMq = window.matchMedia("(min-width: 881px)");
        const onViewportChange = (ev) => {
          if (ev.matches && FootyDialogs.isOpen($couponSlipDialog)) {
            closeCouponSlipDialog();
          }
        };
        if (typeof desktopMq.addEventListener === "function") {
          desktopMq.addEventListener("change", onViewportChange);
        }
      }
    }

    $main.addEventListener("click", (e) => {
      // Open Mobile Bet Slip Modal Dialog
      const openDrawerBtn = e.target.closest(
        '[data-action="open-mobile-drawer"]',
      );
      if (openDrawerBtn) {
        openCouponSlipDialog();
        return;
      }

      // Close Mobile Bet Slip Modal Dialog
      const closeDrawerBtn = e.target.closest(
        '[data-action="close-mobile-drawer"]',
      );
      if (closeDrawerBtn) {
        closeCouponSlipDialog();
        return;
      }

      // Toggle Mobile Bet Slip Modal Dialog
      const toggleDrawerBtn = e.target.closest(
        '[data-action="toggle-mobile-drawer"]',
      );
      if (toggleDrawerBtn) {
        if ($couponSlipDialog && FootyDialogs.isOpen($couponSlipDialog)) {
          closeCouponSlipDialog();
        } else {
          openCouponSlipDialog();
        }
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
      const h = e.target.closest(".league-header");
      if (h) {
        h.parentElement.classList.toggle("collapsed");
        return;
      }

      // Bento team card expand / collapse
      const th = e.target.closest(".team-bento-card .team-name-header");
      if (th) {
        const card = th.closest(".team-bento-card");
        if (card) {
          const isExpanded = card.classList.toggle("expanded");
          th.setAttribute("aria-expanded", isExpanded ? "true" : "false");
          if (isExpanded) {
            // Smoothly scroll so the team block and name remain fully visible below the site header with a clean breathing gap
            setTimeout(() => {
              const header = document.querySelector(".site-header");
              const headerHeight = header
                ? header.getBoundingClientRect().height
                : 70;
              const gap = 16; // breathing space between sticky site header and team block
              const cardTop =
                card.getBoundingClientRect().top + window.pageYOffset;
              window.scrollTo({
                top: Math.max(0, Math.round(cardTop - headerHeight - gap)),
                behavior: "smooth",
              });
            }, 60);
          }
        }
        return;
      }

      // Toggle all teams in a league
      const toggleAllBtn = e.target.closest('[data-action="toggle-all-teams"]');
      if (toggleAllBtn) {
        e.stopPropagation();
        const section = toggleAllBtn.closest(".league-section");
        if (!section) return;
        const activePanel = section.querySelector(".season-panel:not(.hidden)");
        if (!activePanel) return;
        const cards = activePanel.querySelectorAll(".team-bento-card");
        const anyCollapsed = Array.from(cards).some(
          (c) => !c.classList.contains("expanded"),
        );
        cards.forEach((c) => {
          c.classList.toggle("expanded", anyCollapsed);
          const header = c.querySelector(".team-name-header");
          if (header)
            header.setAttribute(
              "aria-expanded",
              anyCollapsed ? "true" : "false",
            );
        });
        const textSpan = toggleAllBtn.querySelector(".toggle-text");
        const iconSpan = toggleAllBtn.querySelector(".toggle-icon");
        if (textSpan)
          textSpan.textContent = anyCollapsed ? "Collapse All" : "Expand All";
        if (iconSpan)
          iconSpan.innerHTML = anyCollapsed ? "&#x2921;" : "&#x2922;";
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
              .map((t) => renderTeam(t, teams[t], isWins, isCustom, lg))
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
        // Reset the expand/collapse button for this league section
        const toggleAllBtn = section.querySelector(
          '[data-action="toggle-all-teams"]',
        );
        if (toggleAllBtn) {
          const textSpan = toggleAllBtn.querySelector(".toggle-text");
          const iconSpan = toggleAllBtn.querySelector(".toggle-icon");
          if (textSpan) textSpan.textContent = "Expand All";
          if (iconSpan) iconSpan.innerHTML = "&#x2922;";
        }
      }
    });

    $main.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const th = e.target.closest(".team-bento-card .team-name-header");
        if (th) {
          e.preventDefault();
          th.click();
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
    // Scoreline filters are only active in Custom mode (where scores highlight matching fixtures)
    if (activeTab !== "custom") return true;
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
          // Must have at least 1 qualifying match on wins/corners tabs
          if (!rec.home.some((e) => e.q) && !rec.away.some((e) => e.q)) return;
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
    // Only display the Scoreline Filters bar on the Custom tab
    $filterBar.style.display = activeTab === "custom" ? "" : "none";

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
                .map((t) => renderTeam(t, teams[t], isWins, isCustom, lg))
                .join("") +
              "</div>"
            );
          }
          return `<div class="season-panel hidden" data-season-idx="${si}" data-league="${esc(lg)}" data-rendered="false"></div>`;
        })
        .join("");

      const toolbarHtml =
        `<div class="league-toolbar">` +
        tabsHtml +
        `<button type="button" class="league-teams-toggle-btn" data-action="toggle-all-teams" title="Expand or collapse all teams in this league">` +
        `<span class="toggle-icon">&#x2922;</span> <span class="toggle-text">Expand All</span>` +
        `</button>` +
        `</div>`;

      parts.push(
        `<section class="league-section" style="animation-delay:${bli * 30}ms">` +
          `<div class="league-header" role="button" tabindex="0" aria-label="Toggle ${esc(bl)}">` +
          `<div class="league-title-group">` +
          getLeagueCrestHtml(bl, "league-header-logo") +
          `<h2 class="league-name">${esc(bl)}</h2>` +
          `</div>` +
          `<span class="league-badge">${activeTeams.length} teams &middot; ${activeQual} qualifying</span>` +
          `<span class="league-toggle">&#9660;</span></div>` +
          `<div class="league-body">${toolbarHtml}${panelsHtml}</div>` +
          `</section>`,
      );
    });

    $main.innerHTML = parts.join("");
  }

  function formatWin2VenuePill(wStats, isHome, seasonLabel, fullLeagueName) {
    if (!wStats) return "";
    const played = isHome ? wStats.homeMatches : wStats.awayMatches;
    if (!played) return "";
    const hits = isHome ? wStats.w2h : wStats.w2a;
    const pct = Math.round((hits / played) * 100);
    const venue = isHome ? "Home" : "Away";
    const label = seasonLabel
      ? `${seasonLabel} ${venue} 2+ W`
      : `${venue} 2+ W`;
    const scope = fullLeagueName
      ? `in ${fullLeagueName}`
      : "across all seasons";
    const tip = `${seasonLabel ? "Selected season" : "Overall historical"} ${venue} wins scoring 2+ goals ${scope}`;
    return `<span class="team-win2-pill" title="${esc(tip)}">${esc(label)}: <strong>${pct}%</strong> <span class="team-win2-frac">(${hits}/${played})</span></span>`;
  }

  function formatCorner10VenuePill(
    cStats,
    isHome,
    seasonLabel,
    fullLeagueName,
  ) {
    if (!cStats) return "";
    const played = isHome ? cStats.homeMatches : cStats.awayMatches;
    if (!played) return "";
    const hits = isHome ? cStats.c10h : cStats.c10a;
    const pct = Math.round((hits / played) * 100);
    const venue = isHome ? "Home" : "Away";
    const label = seasonLabel
      ? `${seasonLabel} ${venue} 10+ C`
      : `${venue} 10+ C`;
    const scope = fullLeagueName
      ? `in ${fullLeagueName}`
      : "across all seasons";
    const tip = `${seasonLabel ? "Selected season" : "Overall historical"} ${venue} 10+ corner matches ${scope}`;
    return `<span class="team-win2-pill" title="${esc(tip)}">${esc(label)}: <strong>${pct}%</strong> <span class="team-win2-frac">(${hits}/${played})</span></span>`;
  }

  function renderTeam(name, rec, isWins, isCustom, lg) {
    let badgesHtml = "";
    if (isWins && WINS_2PLUS_STATS[name]) {
      const overallStats = WINS_2PLUS_STATS[name];
      const seasonStats =
        lg && overallStats.byLeague ? overallStats.byLeague[lg] : null;
      const seasonLabel = lg
        ? lg.slice(baseLeague(lg).length).trim() || "Season"
        : "";
      const pills = [true, false]
        .map((isHome) => formatWin2VenuePill(overallStats, isHome, "", ""))
        .concat(
          seasonStats
            ? [true, false].map((isHome) =>
                formatWin2VenuePill(seasonStats, isHome, seasonLabel, lg),
              )
            : [],
        )
        .filter(Boolean);
      if (pills.length) {
        badgesHtml = `<div class="team-win2-badges">${pills.join("")}</div>`;
      }
    } else if (!isWins && !isCustom) {
      // Corners tab
      const overallStats = CORNERS_10PLUS_STATS[name];
      if (overallStats) {
        const seasonStats =
          lg && overallStats.byLeague ? overallStats.byLeague[lg] : null;
        const seasonLabel = lg
          ? lg.slice(baseLeague(lg).length).trim() || "Season"
          : "";
        const pills = [true, false]
          .map((isHome) =>
            formatCorner10VenuePill(overallStats, isHome, "", ""),
          )
          .concat(
            seasonStats
              ? [true, false].map((isHome) =>
                  formatCorner10VenuePill(seasonStats, isHome, seasonLabel, lg),
                )
              : [],
          )
          .filter(Boolean);
        if (pills.length) {
          badgesHtml = `<div class="team-win2-badges">${pills.join("")}</div>`;
        }
      } else {
        const hQ = rec.home.filter((e) => e.q).length;
        const hTot = rec.home.length;
        const aQ = rec.away.filter((e) => e.q).length;
        const aTot = rec.away.length;
        const pills = [];
        if (hTot > 0) {
          const pct = Math.round((hQ / hTot) * 100);
          pills.push(
            `<span class="team-win2-pill">Home 10+ C: <strong>${pct}%</strong> <span class="team-win2-frac">(${hQ}/${hTot})</span></span>`,
          );
        }
        if (aTot > 0) {
          const pct = Math.round((aQ / aTot) * 100);
          pills.push(
            `<span class="team-win2-pill">Away 10+ C: <strong>${pct}%</strong> <span class="team-win2-frac">(${aQ}/${aTot})</span></span>`,
          );
        }
        if (pills.length) {
          badgesHtml = `<div class="team-win2-badges">${pills.join("")}</div>`;
        }
      }
    } else if (isCustom) {
      // Custom tab
      const hQ = rec.home.filter((e) => e.cx).length;
      const hTot = rec.home.length;
      const aQ = rec.away.filter((e) => e.cx).length;
      const aTot = rec.away.length;
      const pills = [];
      if (hTot > 0) {
        const pct = Math.round((hQ / hTot) * 100);
        pills.push(
          `<span class="team-win2-pill">Home Hits: <strong>${pct}%</strong> <span class="team-win2-frac">(${hQ}/${hTot})</span></span>`,
        );
      }
      if (aTot > 0) {
        const pct = Math.round((aQ / aTot) * 100);
        pills.push(
          `<span class="team-win2-pill">Away Hits: <strong>${pct}%</strong> <span class="team-win2-frac">(${aQ}/${aTot})</span></span>`,
        );
      }
      if (pills.length) {
        badgesHtml = `<div class="team-win2-badges">${pills.join("")}</div>`;
      }
    }

    const crestHtml = getTeamBadgeHtml(name, "team-header-badge");
    let drawerHtml = "";
    if (rec.home.length)
      drawerHtml +=
        '<div class="venue-label">Home Fixtures</div>' +
        renderTable(rec.home, isWins, true, isCustom);
    if (rec.away.length)
      drawerHtml +=
        '<div class="venue-label">Away Fixtures</div>' +
        renderTable(rec.away, isWins, false, isCustom);

    return (
      `<div class="team-block team-bento-card" data-team="${esc(name)}">` +
      `<div class="team-name-header" role="button" tabindex="0" aria-expanded="false" aria-label="Toggle ${esc(name)} match results">` +
      `<div class="team-header-identity">` +
      crestHtml +
      `<span class="team-name-title">${esc(name)}</span>` +
      `</div>` +
      `<div class="team-header-meta">` +
      badgesHtml +
      `<span class="team-expand-toggle" aria-hidden="true">&#9660;</span>` +
      `</div>` +
      `</div>` +
      `<div class="team-fixtures-drawer">` +
      drawerHtml +
      `</div>` +
      `</div>`
    );
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
        '<div class="empty-state"><h2>NO FIXTURES LOADED</h2><p>Could not find fixtures in fixtures.js. Run <code>python footyapi.py --export-fixtures</code> to download upcoming matches.</p></div>';
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
      var pred = predictMatchOutright(home, away, h2h, fix.odds, {
        league: fix.league,
        aiPred: fix.ai_pred,
        derby: fix.derby,
        inj: fix.inj,
      });
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
        ? "Mkt: <strong>" + decimalToFractional(pred.oddsH) + "</strong>"
        : "Fair: <strong>" + decimalToFractional(pred.fairOddsH) + "</strong>";
      var oddsDDisplay = pred.oddsD
        ? "Mkt: <strong>" + decimalToFractional(pred.oddsD) + "</strong>"
        : "Fair: <strong>" + decimalToFractional(pred.fairOddsD) + "</strong>";
      var oddsADisplay = pred.oddsA
        ? "Mkt: <strong>" + decimalToFractional(pred.oddsA) + "</strong>"
        : "Fair: <strong>" + decimalToFractional(pred.fairOddsA) + "</strong>";

      return (
        '<div class="coupon-card' +
        (hasSelectedAny ? " has-selected" : "") +
        '" data-match-id="' +
        esc(matchId) +
        '">' +
        '<div class="coupon-card-meta">' +
        '<span class="coupon-league-badge">' +
        getLeagueCrestHtml(fix.league, "coupon-league-logo") +
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
        '<div class="coupon-team-row">' +
        getTeamBadgeHtml(home, "coupon-team-badge") +
        '<span class="coupon-team-name">' +
        esc(home) +
        "</span>" +
        "</div>" +
        '<span class="coupon-team-sub">' +
        homeSub +
        "</span>" +
        "</div>" +
        '<span class="coupon-vs">VS</span>' +
        '<div class="coupon-team away">' +
        '<div class="coupon-team-row">' +
        '<span class="coupon-team-name">' +
        esc(away) +
        "</span>" +
        getTeamBadgeHtml(away, "coupon-team-badge") +
        "</div>" +
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
        var pred = predictMatchOutright(home, away, h2h, fix.odds, {
          league: fix.league,
          aiPred: fix.ai_pred,
          derby: fix.derby,
          inj: fix.inj,
        });

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
              var effectiveOdds = decimalToFractional(
                hp.odds ? hp.odds : hp.fair,
              );
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
            '<div class="league-title-group">' +
            getLeagueCrestHtml(lg, "league-header-logo") +
            '<h2 class="league-name">' +
            esc(lg) +
            "</h2>" +
            "</div>" +
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
    var slipHtml = renderCouponSlipHtml(metrics, false);
    var mobileBarHtml = renderCouponMobileBarHtml(metrics);

    var slipDialog = document.getElementById("coupon-slip-dialog");
    if (slipDialog && FootyDialogs.isOpen(slipDialog)) {
      if (COUPON_SLIP.length === 0) {
        FootyDialogs.close(slipDialog);
      } else {
        slipDialog.innerHTML = renderCouponSlipHtml(metrics, true);
      }
    }

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
      "Outright win probabilities are computed using <strong>bivariate Poisson goal distributions</strong> based on historical venue attack/defense rates, calibrated against <strong>empirical head-to-head records</strong>. Add selections to calculate cumulative accumulator probabilities, fair fractional odds, and expected payouts." +
      "</p>" +
      "</div>" +
      '<div class="coupon-layout">' +
      '<div class="coupon-matches-column">' +
      cardsHtml +
      "</div>" +
      '<div class="coupon-slip-column" id="coupon-slip-column">' +
      slipHtml +
      "</div>" +
      "</div>" +
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
        '<div class="empty-state"><h2>NO FIXTURES LOADED</h2><p>Could not find fixtures in fixtures.js. Run <code>python footyapi.py --export-fixtures</code> to download upcoming matches.</p></div>';
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
      const deferredCls = idx >= 2 ? " fixtures-league-deferred" : "";

      parts.push(
        `<section class="league-section fixtures-league-section${initialCollapse}${deferredCls}" style="animation-delay:${Math.min(idx, 8) * 24}ms">` +
          `<div class="league-header fixtures-league-header" role="button" tabindex="0" aria-label="Toggle ${esc(lg)}">` +
          `<div class="league-title-group">` +
          getLeagueCrestHtml(lg, "league-header-logo") +
          `<h2 class="league-name">${esc(lg)}</h2>` +
          `</div>` +
          `<span class="league-badge">${list.length} ${list.length === 1 ? "match" : "matches"}</span>` +
          `<span class="league-toggle" aria-hidden="true">&#9660;</span></div>` +
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
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return `${days[d.getDay()]} ${p[0]} ${months[d.getMonth()]} ${p[2]}`;
    }
    return dStr;
  }

  function getResultTeamCrestHtml(team) {
    return getTeamCrestHtml(team, "result-team-logo");
  }

  function renderResultsView(fullRebuild) {
    $filterBar.style.display = "none";
    $customBanner.classList.remove("visible");

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
      $stats.innerHTML =
        '<div class="stat-chip">0 completed 26/27 matches</div>';
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

      const matchKey = item.lgName + "|" + m[M.DATE] + "|" + home + "|" + away;
      const preMatch = MODEL_RATINGS.preMatch2627[matchKey] || null;
      const pred = predictMatchOutright(home, away, null, null, {
        league: item.lgName,
        preMatch: preMatch,
      });
      let pick = "H",
        pickLabel = "Home Win",
        pickProb = pred.probH;
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
          ? (hStats.hHtGoal / (hStats.homeMatches || 1) +
              aStats.aHtGoal / (aStats.awayMatches || 1)) /
            2
          : 0;
      const htGoalPick = expHtG >= 0.65;
      const actualHtGoal = (m[M.HTHG] || 0) + (m[M.HTAG] || 0) > 0;

      const expC10 =
        hStats && aStats
          ? (hStats.hC10 / (hStats.homeMatches || 1) +
              aStats.aC10 / (aStats.awayMatches || 1)) /
            2
          : 0;
      const c10Pick = expC10 >= 0.5;
      const actualC10 = m[M.C10] === 1 || (m[M.HC] || 0) + (m[M.AC] || 0) >= 10;
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
    const accPct = totalEval
      ? ((hitsCount / totalEval) * 100).toFixed(1)
      : "0.0";

    const hcMatches = evaluatedAll.filter((x) => x.isHighConf);
    const hcHits = hcMatches.filter((x) => x.isHit).length;
    const hcPct = hcMatches.length
      ? ((hcHits / hcMatches.length) * 100).toFixed(1)
      : "0.0";

    const htPicks = evaluatedAll.filter((x) => x.htGoalPick);
    const htHits = htPicks.filter((x) => x.actualHtGoal).length;
    const htPct = htPicks.length
      ? ((htHits / htPicks.length) * 100).toFixed(1)
      : "0.0";

    const c10Picks = evaluatedAll.filter((x) => x.c10Pick);
    const c10Hits = c10Picks.filter((x) => x.actualC10).length;
    const c10Pct = c10Picks.length
      ? ((c10Hits / c10Picks.length) * 100).toFixed(1)
      : "0.0";

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
      if (
        searchLow &&
        seasonMatchesForSearchCount > 0 &&
        rTimeframe !== "season"
      ) {
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
      cardsHtml =
        `<div class="results-feed">` +
        displayMatches.map(renderResultMatchCard).join("") +
        `</div>`;
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
    const searchHadFocus =
      $existingSearch && document.activeElement === $existingSearch;
    const selStart = searchHadFocus ? $existingSearch.selectionStart : null;
    const selEnd = searchHadFocus ? $existingSearch.selectionEnd : null;

    let leagueOptionsHtml = '<option value="">All Leagues</option>';
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
      `Continuous empirical validation of our bivariate Poisson models against completed fixtures. Evaluating predictive calibration, value edge integrity, and real-world outcomes across the 2026/27 football season.` +
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
      `<button type="button" class="results-pill-btn${rTimeframe === "season" ? " active" : ""}" data-rtimeframe="season">Current Season</button>` +
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
      `<input type="text" id="results-search-input" class="results-search-input" placeholder="Search team (e.g. Liverpool)..." autocomplete="on" spellcheck="false" aria-label="Search team by name" value="${esc(rSearch)}">` +
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
    const actualHtText = res.actualHtGoal
      ? `Yes (HT ${res.hthg}-${res.htag})`
      : "No (HT 0-0)";
    const htPickBadge = res.htGoalPick
      ? res.actualHtGoal
        ? `<span class="res-sub-badge hit">✓ Pick Hit</span>`
        : `<span class="res-sub-badge miss">✕ Pick Miss</span>`
      : "";

    const actualC10Text = `${res.totalCorners} (${res.hc}-${res.ac})`;
    const c10PickBadge = res.c10Pick
      ? res.actualC10
        ? `<span class="res-sub-badge hit">✓ 10+ Hit</span>`
        : `<span class="res-sub-badge miss">✕ 10+ Miss</span>`
      : "";

    return (
      `<div class="result-match-card ${verdictClass}">` +
      // Top header row: League, Date, Verdict Badge
      `<div class="result-match-header">` +
      `<div class="result-match-meta">` +
      `<span class="result-league-badge">${getLeagueCrestHtml(lgNameClean, "result-league-logo")}${esc(lgNameClean)}</span>` +
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
    document
      .querySelectorAll("#results-outcome-tabs [data-rfilter]")
      .forEach((tab) => {
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

  // ── Decimal → Fractional odds conversion ─────────────────────
  function decimalToFractional(dec) {
    var d = parseFloat(dec);
    if (!Number.isFinite(d) || d <= 1) return "—";
    var num = Math.round((d - 1) * 100);
    if (num <= 0) return "1/100";
    var den = 100;
    var g = gcd(num, den);
    return num / g + "/" + den / g;
  }

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
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

  function formatFixtureDateShort(dStr) {
    if (!dStr) return "";
    var p = String(dStr).split("/");
    if (p.length === 3) {
      var d = new Date(p[2], p[1] - 1, p[0]);
      if (!isNaN(d.getTime())) {
        var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        var months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return days[d.getDay()] + " " + parseInt(p[0], 10) + " " + months[d.getMonth()];
      }
    }
    return String(dStr);
  }

  function renderVenueFormHint(team, isHome) {
    var st = TEAM_STATS[team];
    if (!st) return "";
    var played = isHome ? st.homeMatches : st.awayMatches;
    if (!played) return "";
    var w = isHome ? st.hW : st.aW;
    var d = isHome ? st.hD : st.aD;
    var l = isHome ? st.hL : st.aL;
    var gf = isHome ? st.hGF : st.aGF;
    var ga = isHome ? st.hGA : st.aGA;
    var winPct = Math.round((w / played) * 100);
    var avgGf = (gf / played).toFixed(2);
    var avgGa = (ga / played).toFixed(2);
    var venueLabel = isHome ? "Home" : "Away";
    var titleAttr =
      venueLabel +
      " record: " +
      w +
      "W-" +
      d +
      "D-" +
      l +
      "L \u00b7 Avg " +
      avgGf +
      " GF / " +
      avgGa +
      " GA";
    return (
      '<span class="fixture-stats-hint" title="' +
      esc(titleAttr) +
      '"><strong>' +
      winPct +
      "%</strong> W \u00b7 " +
      avgGf +
      " GF</span>"
    );
  }

  function renderFixtureCard(fix) {
    var home = fix.home;
    var away = fix.away;

    var homeStats = renderVenueFormHint(home, true);
    var awayStats = renderVenueFormHint(away, false);
    var homeRankHtml = renderLeagueRankPill(fix.league, home);
    var awayRankHtml = renderLeagueRankPill(fix.league, away);
    var injH = fix.inj && fix.inj.h ? Number(fix.inj.h) : 0;
    var injA = fix.inj && fix.inj.a ? Number(fix.inj.a) : 0;
    var homeInjHtml =
      injH > 0
        ? '<span class="fixture-inj-tag" title="' +
          injH +
          ' unavailable player' +
          (injH === 1 ? "" : "s") +
          '">' +
          injH +
          " out</span>"
        : "";
    var awayInjHtml =
      injA > 0
        ? '<span class="fixture-inj-tag" title="' +
          injA +
          ' unavailable player' +
          (injA === 1 ? "" : "s") +
          '">' +
          injA +
          " out</span>"
        : "";

    // H2H (home team at home vs away team) & sub-market probabilities
    var h2h = getH2HAtHome(home, away);
    var htGoalPct = calcFirstHalfGoalPct(home, away, h2h);
    var c10Pct = calcCorners10PlusPct(home, away, h2h);

    // Unified 1X2 Market Odds + Model Probabilities + 1-click Coupon Matrix
    var matchId = (fix.date || "") + "_" + home + "_" + away;
    var outrightPred = predictMatchOutright(home, away, h2h, fix.odds, {
      league: fix.league,
      aiPred: fix.ai_pred,
      derby: fix.derby,
      inj: fix.inj,
    });
    var curLeg = getCouponLeg(matchId);

    var leadPick = "1";
    if (
      outrightPred.probA > outrightPred.probH &&
      outrightPred.probA >= outrightPred.probD
    ) {
      leadPick = "2";
    } else if (
      outrightPred.probD > outrightPred.probH &&
      outrightPred.probD > outrightPred.probA
    ) {
      leadPick = "X";
    }

    var tiles = [
      {
        pick: "1",
        code: "1 · HOME",
        shortLabel: "Home Win",
        prob: outrightPred.probH,
        odds: outrightPred.oddsH,
        fair: outrightPred.fairOddsH,
        edge: outrightPred.edgeH,
      },
      {
        pick: "X",
        code: "X · DRAW",
        shortLabel: "Draw",
        prob: outrightPred.probD,
        odds: outrightPred.oddsD,
        fair: outrightPred.fairOddsD,
        edge: outrightPred.edgeD,
      },
      {
        pick: "2",
        code: "2 · AWAY",
        shortLabel: "Away Win",
        prob: outrightPred.probA,
        odds: outrightPred.oddsA,
        fair: outrightPred.fairOddsA,
        edge: outrightPred.edgeA,
      },
    ];

    var marketTilesHtml = tiles
      .map(function (t) {
        var isActive = curLeg && curLeg.pick === t.pick;
        var isLead = leadPick === t.pick;
        var fracOdds = t.odds ? decimalToFractional(t.odds) : "\u2014";
        var hasEdge = t.edge != null && t.edge >= 3.0;
        var edgeHtml = hasEdge
          ? '<span class="fmt-edge" title="Model value edge vs bookmaker implied probability">+' +
            t.edge.toFixed(1) +
            "%</span>"
          : "";
        var barWidth = Math.max(4, Math.min(100, Math.round(t.prob || 0)));
        return (
          '<button type="button" class="fixture-coupon-chip fixture-market-tile' +
          (isActive ? " active" : "") +
          (isLead ? " model-lead" : "") +
          '" data-action="quick-coupon" data-mid="' +
          esc(matchId) +
          '" data-pick="' +
          t.pick +
          '" data-home="' +
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
          t.prob +
          '" data-odds="' +
          (t.odds || "") +
          '" data-fair="' +
          t.fair +
          '" title="' +
          t.shortLabel +
          " \u00b7 Model " +
          t.prob +
          "%" +
          (t.odds ? " \u00b7 Market " + fracOdds : "") +
          ' (click to add/remove from Coupon)">' +
          '<span class="fmt-top"><span class="fmt-code">' +
          t.code +
          "</span>" +
          edgeHtml +
          "</span>" +
          '<span class="fmt-odds' +
          (t.odds ? "" : " is-empty") +
          '">' +
          esc(fracOdds) +
          "</span>" +
          '<span class="fmt-prob-row"><span>Model <strong>' +
          t.prob +
          '%</strong></span><span class="fmt-check" aria-hidden="true">&#10003;</span></span>' +
          '<span class="fmt-bar" aria-hidden="true"><span class="fmt-bar-fill" style="width:' +
          barWidth +
          '%"></span></span>' +
          "</button>"
        );
      })
      .join("");

    var marketBlockHtml =
      '<div class="fixture-market-block" data-fixture-id="' +
      esc(matchId) +
      '">' +
      '<div class="fixture-market-kicker">' +
      "<span>1X2 Market &amp; Model</span>" +
      '<span class="fixture-market-hint">Click tile to add to coupon</span>' +
      "</div>" +
      '<div class="fixture-market-grid">' +
      marketTilesHtml +
      "</div>" +
      "</div>";

    // Compact Dual Probability Meters (1H Goal + 10+ Corners) & Secondary Markets (BTTS / O2.5)
    var meterCellsHtml = "";
    if (htGoalPct !== null) {
      var htColor =
        htGoalPct >= 70
          ? "var(--neon-green)"
          : htGoalPct >= 45
            ? "var(--neon-yellow)"
            : "var(--neon-red)";
      var htSources = [];
      if (TEAM_STATS[home] && TEAM_STATS[home].homeMatches >= 3)
        htSources.push(home + " (H)");
      if (TEAM_STATS[away] && TEAM_STATS[away].awayMatches >= 3)
        htSources.push(away + " (A)");
      if (h2h.length >= 2) htSources.push("H2H (" + h2h.length + ")");
      meterCellsHtml +=
        '<div class="fixture-meter-cell" title="1st Half Goal Probability \u00b7 ' +
        esc(htSources.join(" \u00b7 ") || "Historical model") +
        '">' +
        '<div class="fixture-meter-top">' +
        '<span class="fixture-meter-label">1H Goal</span>' +
        '<span class="fixture-meter-pct" style="color:' +
        htColor +
        '">' +
        htGoalPct +
        "%</span>" +
        "</div>" +
        '<div class="fixture-meter-track"><div class="fixture-meter-fill" style="width:' +
        htGoalPct +
        "%;background:" +
        htColor +
        '"></div></div>' +
        "</div>";
    }

    if (c10Pct !== null) {
      var c10Color =
        c10Pct >= 70
          ? "var(--neon-green)"
          : c10Pct >= 45
            ? "var(--neon-yellow)"
            : "var(--neon-red)";
      var c10Sources = [];
      if (TEAM_STATS[home] && TEAM_STATS[home].homeMatches >= 3)
        c10Sources.push(home + " (H)");
      if (TEAM_STATS[away] && TEAM_STATS[away].awayMatches >= 3)
        c10Sources.push(away + " (A)");
      if (h2h.length >= 2) c10Sources.push("H2H (" + h2h.length + ")");
      meterCellsHtml +=
        '<div class="fixture-meter-cell" title="10+ Match Corners Probability \u00b7 ' +
        esc(c10Sources.join(" \u00b7 ") || "Historical model") +
        '">' +
        '<div class="fixture-meter-top">' +
        '<span class="fixture-meter-label">10+ Corners</span>' +
        '<span class="fixture-meter-pct" style="color:' +
        c10Color +
        '">' +
        c10Pct +
        "%</span>" +
        "</div>" +
        '<div class="fixture-meter-track"><div class="fixture-meter-fill" style="width:' +
        c10Pct +
        "%;background:" +
        c10Color +
        '"></div></div>' +
        "</div>";
    }

    var secChips = [];
    if (fix.btts && (fix.btts.yes || fix.btts.no)) {
      var bttsStr = [];
      if (fix.btts.yes)
        bttsStr.push("Y <strong>" + esc(decimalToFractional(fix.btts.yes)) + "</strong>");
      if (fix.btts.no)
        bttsStr.push("N <strong>" + esc(decimalToFractional(fix.btts.no)) + "</strong>");
      secChips.push(
        '<span class="fixture-sec-chip" title="Both Teams to Score odds (fractional)">BTTS ' +
          bttsStr.join(" / ") +
          "</span>",
      );
    }
    if (fix.ou && (fix.ou.o25 || fix.ou.u25)) {
      var ouStr = [];
      if (fix.ou.o25)
        ouStr.push("O2.5 <strong>" + esc(decimalToFractional(fix.ou.o25)) + "</strong>");
      if (fix.ou.u25)
        ouStr.push("U2.5 <strong>" + esc(decimalToFractional(fix.ou.u25)) + "</strong>");
      secChips.push(
        '<span class="fixture-sec-chip" title="Over / Under 2.5 Goals odds (fractional)">' +
          ouStr.join(" / ") +
          "</span>",
      );
    }

    var signalsStripHtml = "";
    if (meterCellsHtml || secChips.length) {
      signalsStripHtml =
        '<div class="fixture-signals-strip">' +
        (meterCellsHtml
          ? '<div class="fixture-meters-grid">' + meterCellsHtml + "</div>"
          : "") +
        (secChips.length
          ? '<div class="fixture-secondary-odds">' + secChips.join("") + "</div>"
          : "") +
        "</div>";
    }

    var intelHtml = renderFixtureIntelHtml(fix, home, away, h2h);

    var metaTagsHtml = "";
    if (fix.round != null && fix.round !== "") {
      metaTagsHtml += '<span class="fixture-tag">R' + esc(String(fix.round)) + "</span>";
    }
    if (fix.derby) {
      metaTagsHtml += '<span class="fixture-tag derby">Derby</span>';
    }
    var venueTitle = fix.venue ? String(fix.venue).trim() : "";

    return (
      '<article class="fixture-card">' +
      '<div class="fixture-header"' +
      (venueTitle ? ' title="Venue: ' + esc(venueTitle) + '"' : "") +
      ">" +
      '<div class="fixture-date-chip">' +
      "<span>" +
      esc(formatFixtureDateShort(fix.date)) +
      "</span>" +
      '<span class="fixture-meta-sep" aria-hidden="true">&middot;</span>' +
      '<span class="fixture-time-badge">' +
      esc(fix.time || "TBD") +
      "</span>" +
      "</div>" +
      (metaTagsHtml
        ? '<div class="fixture-meta-tags">' + metaTagsHtml + "</div>"
        : "") +
      "</div>" +
      '<div class="fixture-teams">' +
      '<div class="fixture-team home">' +
      '<div class="fixture-team-row">' +
      getTeamBadgeHtml(home, "fixture-team-badge") +
      '<span class="fixture-team-name">' +
      esc(home) +
      "</span>" +
      "</div>" +
      (homeRankHtml || homeStats || homeInjHtml
        ? '<div class="fixture-team-meta">' + homeRankHtml + homeStats + homeInjHtml + "</div>"
        : "") +
      "</div>" +
      '<div class="fixture-vs" aria-hidden="true">VS</div>' +
      '<div class="fixture-team away">' +
      '<div class="fixture-team-row">' +
      '<span class="fixture-team-name">' +
      esc(away) +
      "</span>" +
      getTeamBadgeHtml(away, "fixture-team-badge") +
      "</div>" +
      (awayRankHtml || awayStats || awayInjHtml
        ? '<div class="fixture-team-meta">' + awayInjHtml + awayStats + awayRankHtml + "</div>"
        : "") +
      "</div>" +
      "</div>" +
      marketBlockHtml +
      signalsStripHtml +
      intelHtml +
      "</article>"
    );
  }

  // ── BSD API Intel: AI Prediction, H2H Drawer, Fun Facts & AI Preview ──
  function formatInlineMd(escapedText) {
    return escapedText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function extractAiScoreTeaser(rawText) {
    if (!rawText) return "";
    const m = String(rawText).match(
      /Prediction:\s*(?:\r?\n)+\s*\*\*([^*]{3,42}?)\*\*/i,
    );
    return m ? m[1].replace(/\.$/, "").trim() : "";
  }

  function formatAiPreviewHtml(rawText) {
    if (!rawText) return "";
    const blocks = String(rawText)
      .split(/\r?\n\s*\r?\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const isBulletBlock = lines.every((l) => /^[-•]\s+/.test(l));
      if (isBulletBlock) {
        out.push(
          '<ul class="ai-preview-list">' +
            lines
              .map(
                (l) =>
                  "<li>" +
                  formatInlineMd(esc(l.replace(/^[-•]\s+/, ""))) +
                  "</li>",
              )
              .join("") +
            "</ul>",
        );
      } else if (
        lines.length === 1 &&
        /^(Key storylines|Expected lineups|Prediction):$/i.test(lines[0])
      ) {
        out.push(
          '<div class="ai-preview-subhead">' +
            esc(lines[0].replace(/:$/, "")) +
            "</div>",
        );
      } else {
        const joined = lines.map((l) => formatInlineMd(esc(l))).join("<br />");
        const isPredCallout =
          i === blocks.length - 1 &&
          out.length > 0 &&
          out[out.length - 1].includes(">Prediction<");
        out.push(
          '<p class="ai-preview-para' +
            (isPredCallout ? " ai-preview-verdict" : "") +
            '">' +
            joined +
            "</p>",
        );
      }
    }
    return out.join("");
  }

  function renderFixtureH2HDrawerHtml(h2h, apiH2H, home, away) {
    if (!h2h || !h2h.length) {
      if (apiH2H && ((apiH2H.m && apiH2H.m.length) || apiH2H.n > 0)) {
        var apiRows = (apiH2H.m || [])
          .map(function (row) {
            var dStr = row[0] || "";
            var atHome = row[1] === 1;
            var hs = row[2];
            var as_ = row[3];
            var res = row[4] || "D";
            var resCls = res === "W" ? "bw" : res === "L" ? "bl" : "bd";
            var venueLabel = atHome ? "H" : "A";
            var venueCls = atHome ? "is-home" : "is-away";
            var matchTitle = atHome
              ? home + " " + hs + "\u2013" + as_ + " " + away + " (Home)"
              : away + " " + hs + "\u2013" + as_ + " " + home + " (Away)";
            return (
              '<tr title="' +
              esc(matchTitle) +
              '">' +
              '<td class="h2h-date">' +
              '<span class="h2h-date-full">' +
              esc(dStr) +
              "</span>" +
              '<span class="h2h-date-year">' +
              esc(dStr.slice(-4)) +
              "</span>" +
              "</td>" +
              '<td><span class="h2h-venue-pill ' +
              venueCls +
              '">' +
              venueLabel +
              "</span></td>" +
              '<td class="h2h-score">' +
              hs +
              "\u2013" +
              as_ +
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

        var summaryStat =
          (apiH2H.w || 0) +
          "W-" +
          (apiH2H.d || 0) +
          "D-" +
          (apiH2H.l || 0) +
          "L" +
          (apiH2H.ag != null ? " \u00b7 " + Number(apiH2H.ag).toFixed(1) + " g/m" : "");

        return (
          '<details class="fixture-intel-details h2h-details api-h2h">' +
          '<summary class="fixture-intel-summary">' +
          '<span class="fixture-intel-title">H2H</span>' +
          '<span class="fixture-intel-pill cyan">' +
          (apiH2H.n || (apiH2H.m ? apiH2H.m.length : 0)) +
          "</span>" +
          '<span class="fixture-intel-pill api-src" title="Historical H2H from Bzzoiro Sports Data API (all venues)">API</span>' +
          '<span class="fixture-h2h-summary-stat">' +
          esc(summaryStat) +
          "</span>" +
          "</summary>" +
          '<div class="fixture-intel-body">' +
          (apiRows
            ? '<div class="fixture-h2h-table-wrap">' +
              '<table class="h2h-table"><thead><tr>' +
              "<th>Date</th><th>Venue</th><th>FT</th><th>Res</th>" +
              "</tr></thead><tbody>" +
              apiRows +
              "</tbody></table>" +
              "</div>"
            : "") +
          "</div>" +
          "</details>"
        );
      }

      return (
        '<div class="fixture-h2h-empty">' +
        "<span>H2H at Home</span><span>No previous meetings in database</span>" +
        "</div>"
      );
    }

    var htHits = 0;
    var c10Hits = 0;
    for (var i = 0; i < h2h.length; i++) {
      if ((h2h[i][M.HTHG] || 0) + (h2h[i][M.HTAG] || 0) > 0) htHits++;
      if (h2h[i][M.C10]) c10Hits++;
    }

    var recent = h2h.slice(0, 6);
    var rows = recent
      .map(function (m) {
        var res = m[M.FTR] === "H" ? "W" : m[M.FTR] === "A" ? "L" : "D";
        var resCls = res === "W" ? "bw" : res === "L" ? "bl" : "bd";
        var htGoals = (m[M.HTHG] || 0) + (m[M.HTAG] || 0);
        var htFlag =
          htGoals > 0
            ? '<span class="h2h-ht-goal">1H</span>'
            : '<span class="h2h-ht-nil">0-0</span>';
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

    return (
      '<details class="fixture-intel-details h2h-details">' +
      '<summary class="fixture-intel-summary">' +
      '<span class="fixture-intel-title">H2H at Home</span>' +
      '<span class="fixture-intel-pill cyan">' +
      h2h.length +
      "</span>" +
      '<span class="fixture-h2h-summary-stat">' +
      htHits +
      "/" +
      h2h.length +
      " HT \u00b7 " +
      c10Hits +
      "/" +
      h2h.length +
      " 10+C</span>" +
      "</summary>" +
      '<div class="fixture-intel-body">' +
      '<div class="fixture-h2h-table-wrap">' +
      '<table class="h2h-table"><thead><tr>' +
      "<th>Date</th><th>FT</th><th>HT</th><th>1H</th><th>Crn</th><th>Res</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      "</div>" +
      "</div>" +
      "</details>"
    );
  }

  function renderFixtureIntelHtml(fix, home, away, h2h) {
    const pred = fix && fix.ai_pred ? fix.ai_pred : null;
    const funfacts =
      fix && Array.isArray(fix.funfacts) && fix.funfacts.length
        ? fix.funfacts
        : null;
    const preview = fix && fix.ai_preview ? fix.ai_preview : null;

    let predHtml = "";
    if (pred) {
      const resCode = pred.res || "";
      const pickText =
        resCode === "H"
          ? esc(home)
          : resCode === "A"
            ? esc(away)
            : resCode === "D"
              ? "Draw"
              : "";
      const recLabels = {
        winner: "Winner",
        favorite: "Favourite",
        over_25: "Over 2.5",
        btts: "BTTS",
      };
      const recBadges = Array.isArray(pred.rec)
        ? pred.rec
            .map(
              (r) =>
                '<span class="fixture-ai-rec-pill">&#9733; ' +
                esc(recLabels[r] || r) +
                "</span>",
            )
            .join("")
        : "";
      const scoreBadge = pred.score
        ? '<span class="fixture-ai-score-pill" title="Most likely scoreline">' +
          esc(pred.score) +
          "</span>"
        : "";
      const xgStr =
        pred.xhg != null && pred.xag != null
          ? Number(pred.xhg).toFixed(2) + "–" + Number(pred.xag).toFixed(2)
          : null;

      predHtml =
        '<div class="fixture-ai-pred">' +
        '<div class="fixture-ai-pred-top">' +
        '<span class="fixture-ai-label"><span class="fixture-ai-spark" aria-hidden="true">&#10022;</span> Model Pick' +
        (pickText
          ? ': <strong class="fixture-ai-pick">' + pickText + "</strong>"
          : "") +
        "</span>" +
        '<div class="fixture-ai-badges">' +
        recBadges +
        scoreBadge +
        "</div>" +
        "</div>" +
        '<div class="fixture-ai-metrics">' +
        (pred.ph != null
          ? '<span class="fixture-ai-metric' +
            (resCode === "H" ? " lead" : "") +
            '">1 <strong>' +
            Math.round(pred.ph) +
            "%</strong></span>"
          : "") +
        (pred.pd != null
          ? '<span class="fixture-ai-metric' +
            (resCode === "D" ? " lead" : "") +
            '">X <strong>' +
            Math.round(pred.pd) +
            "%</strong></span>"
          : "") +
        (pred.pa != null
          ? '<span class="fixture-ai-metric' +
            (resCode === "A" ? " lead" : "") +
            '">2 <strong>' +
            Math.round(pred.pa) +
            "%</strong></span>"
          : "") +
        (xgStr
          ? '<span class="fixture-ai-metric xg">xG <strong>' +
            xgStr +
            "</strong></span>"
          : "") +
        (pred.o25 != null
          ? '<span class="fixture-ai-metric">O2.5 <strong>' +
            Math.round(pred.o25) +
            "%</strong></span>"
          : "") +
        (pred.btts != null
          ? '<span class="fixture-ai-metric">BTTS <strong>' +
            Math.round(pred.btts) +
            "%</strong></span>"
          : "") +
        "</div>" +
        "</div>";
    } else {
      predHtml =
        '<div class="fixture-ai-pred fixture-ai-pred-tbd">' +
        '<div class="fixture-ai-pred-top">' +
        '<span class="fixture-ai-label"><span class="fixture-ai-spark" aria-hidden="true">&#10022;</span> Model Pick: <strong class="fixture-ai-pick fixture-ai-tbd">TBD</strong></span>' +
        "</div>" +
        "</div>";
    }

    let accordionsHtml = "";
    if (typeof h2h !== "undefined") {
      accordionsHtml += renderFixtureH2HDrawerHtml(
        h2h,
        fix && fix.api_h2h ? fix.api_h2h : null,
        home,
        away,
      );
    }

    if (funfacts) {
      accordionsHtml +=
        '<details class="fixture-intel-details">' +
        '<summary class="fixture-intel-summary">' +
        '<span class="fixture-intel-title">Intel</span>' +
        '<span class="fixture-intel-pill cyan">' +
        funfacts.length +
        "</span>" +
        "</summary>" +
        '<div class="fixture-intel-body">' +
        '<ul class="fixture-funfacts-list">' +
        funfacts.map((s) => "<li>" + esc(s) + "</li>").join("") +
        "</ul>" +
        "</div>" +
        "</details>";
    }

    if (preview) {
      const teaser = extractAiScoreTeaser(preview);
      accordionsHtml +=
        '<details class="fixture-intel-details ai-preview">' +
        '<summary class="fixture-intel-summary">' +
        '<span class="fixture-intel-title">Match Preview</span>' +
        (teaser
          ? '<span class="fixture-intel-pill purple">' + esc(teaser) + "</span>"
          : "") +
        "</summary>" +
        '<div class="fixture-intel-body ai-preview-body">' +
        formatAiPreviewHtml(preview) +
        "</div>" +
        "</details>";
    }

    return (
      '<div class="fixture-intel-wrap">' +
      predHtml +
      (accordionsHtml
        ? '<div class="fixture-intel-accordions">' + accordionsHtml + "</div>"
        : "") +
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
    FootyDialogs.open($updateBanner);
  }
  function hideUpdateBanner() {
    FootyDialogs.close($updateBanner);
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
    // Prevent browser default mini-infobar so custom styled dialog is used
    e.preventDefault();
    deferredPrompt = e;

    if (!isStandalone && !isDismissedRecently()) {
      setTimeout(function () {
        if (!isStandalone && !isDismissedRecently()) {
          FootyDialogs.open($installBanner);
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
        FootyDialogs.open($installBanner);
      }
    }, 4000);
  }

  // Install button click handler (Chromium)
  $installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      deferredPrompt = null;
      FootyDialogs.close($installBanner);
      if (choice && choice.outcome === "dismissed") {
        markDismissed();
      }
    });
  });

  // Dismiss button click handler
  $installDismiss.addEventListener("click", function () {
    FootyDialogs.close($installBanner);
    deferredPrompt = null;
    markDismissed();
  });

  // When successfully installed, remove dialog and mark dismissed
  window.addEventListener("appinstalled", function () {
    FootyDialogs.close($installBanner);
    deferredPrompt = null;
    markDismissed();
  });
})();
