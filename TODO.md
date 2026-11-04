## Completed Fixes

- [x] **Data-Driven Coupon & Bet Builder**:
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
