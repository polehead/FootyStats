# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Fetch and export upcoming football fixtures to fixtures.js.

Downloads fixtures.csv from football-data.co.uk (caching a local copy in ./csv_cache),
filters for the 20 tracked leagues, cleans and extracts dates, times, teams, and
bookmaker odds, then writes `fixtures.js` assigning global FOOTYFIXTURES.

Usage:
    python export_fixtures.py
"""

from __future__ import annotations

import csv
import datetime
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FIXTURES_URL = "https://www.football-data.co.uk/fixtures.csv"
CACHE_DIR_NAME = "csv_cache"
FIXTURES_CACHE_NAME = "fixtures.csv"

# Division codes mapped to base league names matching index.html
DIV_TO_LEAGUE: dict[str, str] = {
    "E0": "Premier League",
    "E1": "Championship",
    "E2": "League One",
    "E3": "League Two",
    "EC": "National League",
    "SC0": "Scottish Premiership",
    "SC1": "Scottish League One",
    "SP1": "La Liga",
    "SP2": "La Liga 2",
    "D1": "Bundesliga",
    "D2": "Bundesliga 2",
    "I1": "Serie A",
    "I2": "Serie B",
    "F1": "Ligue 1",
    "F2": "Ligue 2",
    "N1": "Eredivisie",
    "P1": "Primeira Liga",
    "B1": "Belgium First Division A",
    "T1": "Super Lig",
    "G1": "Super League Greece",
}


def fetch_fixtures_csv(url: str, cache_dir: Path) -> str | None:
    cache_dir.mkdir(exist_ok=True)
    cached = cache_dir / FIXTURES_CACHE_NAME

    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "text/csv,text/plain,*/*",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
        cached.write_bytes(raw)
        print(f"Downloaded latest fixtures from {url}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if cached.exists():
            print(f"Download failed ({e}); falling back to cached {cached.name}")
            raw = cached.read_bytes()
        else:
            print(f"Failed to download fixtures and no cache found: {e}")
            return None

    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def safe_float(val: str | None) -> float | None:
    if not val:
        return None
    try:
        f = float(val.strip())
        return round(f, 2) if f > 0 else None
    except (ValueError, TypeError):
        return None


def parse_fixtures(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    fixtures = []

    for row in reader:
        cleaned = {
            (k.strip() if k else ""): (v.strip() if v else "")
            for k, v in row.items()
            if k
        }
        div = cleaned.get("Div", "").strip()
        league = DIV_TO_LEAGUE.get(div)
        if not league:
            continue

        home_team = cleaned.get("HomeTeam", "").strip()
        away_team = cleaned.get("AwayTeam", "").strip()
        date_str = cleaned.get("Date", "").strip()
        time_str = cleaned.get("Time", "").strip()

        if not home_team or not away_team or not date_str:
            continue

        # Extract Bet365 odds with fallbacks to Average or Market Max odds
        odds_h = safe_float(cleaned.get("B365H") or cleaned.get("AvgH") or cleaned.get("MaxH"))
        odds_d = safe_float(cleaned.get("B365D") or cleaned.get("AvgD") or cleaned.get("MaxD"))
        odds_a = safe_float(cleaned.get("B365A") or cleaned.get("AvgA") or cleaned.get("MaxA"))

        odds = None
        if odds_h or odds_d or odds_a:
            odds = {
                "h": odds_h,
                "d": odds_d,
                "a": odds_a,
            }

        fixtures.append({
            "div": div,
            "league": league,
            "date": date_str,
            "time": time_str or "TBD",
            "home": home_team,
            "away": away_team,
            "odds": odds,
        })

    return fixtures


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    cache_dir = base_dir / CACHE_DIR_NAME

    csv_text = fetch_fixtures_csv(FIXTURES_URL, cache_dir)
    if not csv_text:
        print("Error: Could not retrieve fixtures CSV.")
        sys.exit(1)

    fixtures = parse_fixtures(csv_text)

    # Sort fixtures by date/time where possible
    def sort_key(f: dict) -> tuple:
        parts = f["date"].split("/")
        # Convert DD/MM/YYYY to YYYY-MM-DD for sorting
        if len(parts) == 3:
            day, month, year = parts
            if len(year) == 2:
                year = f"20{year}"
            d_key = f"{year.zfill(4)}-{month.zfill(2)}-{day.zfill(2)}"
        else:
            d_key = f["date"]
        return (f["league"], d_key, f["time"])

    fixtures.sort(key=sort_key)

    leagues_with_fixtures = sorted(list({f["league"] for f in fixtures}))

    payload = {
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "leagues": leagues_with_fixtures,
        "fixtures": fixtures,
    }

    out_path = base_dir / "fixtures.js"
    json_str = json.dumps(payload, ensure_ascii=False, indent=2)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"var FOOTYFIXTURES = {json_str};\n")

    count = len(fixtures)
    l_count = len(leagues_with_fixtures)
    print(f"Exported {count} upcoming fixtures across {l_count} leagues -> {out_path.name}")


if __name__ == "__main__":
    main()
