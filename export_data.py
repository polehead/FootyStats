# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Export football analysis data to data.js for the web frontend.

Downloads the season CSV files from football-data.co.uk (caching a local copy
in ./csv_cache), builds both wins (2+ goals) and corners (10+) datasets, then
writes `data.js` which assigns a global FOOTYDATA variable.
This avoids CORS issues with file:// protocol.

Usage:
    uv run export_data.py
"""

from __future__ import annotations

import csv
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

# ── CSV sources (url -> pretty league name) ───────────────────────────────────
LEAGUE_FILES: dict[str, str] = {
    "https://football-data.co.uk/mmz4281/2627/E0.csv": "Premier League 26/27",
    "https://football-data.co.uk/mmz4281/2526/E0.csv": "Premier League 25/26",
    "https://football-data.co.uk/mmz4281/2425/E0.csv": "Premier League 24/25",
    "https://football-data.co.uk/mmz4281/2324/E0.csv": "Premier League 23/24",
    "https://football-data.co.uk/mmz4281/2223/E0.csv": "Premier League 22/23",
    "https://football-data.co.uk/mmz4281/2627/E1.csv": "Championship 26/27",
    "https://football-data.co.uk/mmz4281/2526/E1.csv": "Championship 25/26",
    "https://football-data.co.uk/mmz4281/2425/E1.csv": "Championship 24/25",
    "https://football-data.co.uk/mmz4281/2324/E1.csv": "Championship 23/24",
    "https://football-data.co.uk/mmz4281/2223/E1.csv": "Championship 22/23",
    "https://football-data.co.uk/mmz4281/2627/E2.csv": "League One 26/27",
    "https://football-data.co.uk/mmz4281/2526/E2.csv": "League One 25/26",
    "https://football-data.co.uk/mmz4281/2425/E2.csv": "League One 24/25",
    "https://football-data.co.uk/mmz4281/2324/E2.csv": "League One 23/24",
    "https://football-data.co.uk/mmz4281/2223/E2.csv": "League One 22/23",
    "https://football-data.co.uk/mmz4281/2627/E3.csv": "League Two 26/27",
    "https://football-data.co.uk/mmz4281/2526/E3.csv": "League Two 25/26",
    "https://football-data.co.uk/mmz4281/2425/E3.csv": "League Two 24/25",
    "https://football-data.co.uk/mmz4281/2324/E3.csv": "League Two 23/24",
    "https://football-data.co.uk/mmz4281/2223/E3.csv": "League Two 22/23",
    "https://football-data.co.uk/mmz4281/2627/EC.csv": "National League 26/27",
    "https://football-data.co.uk/mmz4281/2526/EC.csv": "National League 25/26",
    "https://football-data.co.uk/mmz4281/2425/EC.csv": "National League 24/25",
    "https://football-data.co.uk/mmz4281/2324/EC.csv": "National League 23/24",
    "https://football-data.co.uk/mmz4281/2223/EC.csv": "National League 22/23",
    "https://football-data.co.uk/mmz4281/2627/SC0.csv": "Scottish Premiership 26/27",
    "https://football-data.co.uk/mmz4281/2526/SC0.csv": "Scottish Premiership 25/26",
    "https://football-data.co.uk/mmz4281/2425/SC0.csv": "Scottish Premiership 24/25",
    "https://football-data.co.uk/mmz4281/2324/SC0.csv": "Scottish Premiership 23/24",
    "https://football-data.co.uk/mmz4281/2223/SC0.csv": "Scottish Premiership 22/23",
    "https://football-data.co.uk/mmz4281/2627/SC1.csv": "Scottish League One 26/27",
    "https://football-data.co.uk/mmz4281/2526/SC1.csv": "Scottish League One 25/26",
    "https://football-data.co.uk/mmz4281/2425/SC1.csv": "Scottish League One 24/25",
    "https://football-data.co.uk/mmz4281/2324/SC1.csv": "Scottish League One 23/24",
    "https://football-data.co.uk/mmz4281/2223/SC1.csv": "Scottish League One 22/23",
    "https://football-data.co.uk/mmz4281/2627/SP1.csv": "La Liga 26/27",
    "https://football-data.co.uk/mmz4281/2526/SP1.csv": "La Liga 25/26",
    "https://football-data.co.uk/mmz4281/2425/SP1.csv": "La Liga 24/25",
    "https://football-data.co.uk/mmz4281/2324/SP1.csv": "La Liga 23/24",
    "https://football-data.co.uk/mmz4281/2223/SP1.csv": "La Liga 22/23",
    "https://football-data.co.uk/mmz4281/2627/SP2.csv": "La Liga 2 26/27",
    "https://football-data.co.uk/mmz4281/2526/SP2.csv": "La Liga 2 25/26",
    "https://football-data.co.uk/mmz4281/2425/SP2.csv": "La Liga 2 24/25",
    "https://football-data.co.uk/mmz4281/2324/SP2.csv": "La Liga 2 23/24",
    "https://football-data.co.uk/mmz4281/2223/SP2.csv": "La Liga 2 22/23",
    "https://football-data.co.uk/mmz4281/2627/D1.csv": "Bundesliga 26/27",
    "https://football-data.co.uk/mmz4281/2526/D1.csv": "Bundesliga 25/26",
    "https://football-data.co.uk/mmz4281/2425/D1.csv": "Bundesliga 24/25",
    "https://football-data.co.uk/mmz4281/2324/D1.csv": "Bundesliga 23/24",
    "https://football-data.co.uk/mmz4281/2223/D1.csv": "Bundesliga 22/23",
    "https://football-data.co.uk/mmz4281/2627/D2.csv": "Bundesliga 2 26/27",
    "https://football-data.co.uk/mmz4281/2526/D2.csv": "Bundesliga 2 25/26",
    "https://football-data.co.uk/mmz4281/2425/D2.csv": "Bundesliga 2 24/25",
    "https://football-data.co.uk/mmz4281/2324/D2.csv": "Bundesliga 2 23/24",
    "https://football-data.co.uk/mmz4281/2223/D2.csv": "Bundesliga 2 22/23",
    "https://football-data.co.uk/mmz4281/2627/I1.csv": "Serie A 26/27",
    "https://football-data.co.uk/mmz4281/2526/I1.csv": "Serie A 25/26",
    "https://football-data.co.uk/mmz4281/2425/I1.csv": "Serie A 24/25",
    "https://football-data.co.uk/mmz4281/2324/I1.csv": "Serie A 23/24",
    "https://football-data.co.uk/mmz4281/2223/I1.csv": "Serie A 22/23",
    "https://football-data.co.uk/mmz4281/2627/I2.csv": "Serie B 26/27",
    "https://football-data.co.uk/mmz4281/2526/I2.csv": "Serie B 25/26",
    "https://football-data.co.uk/mmz4281/2425/I2.csv": "Serie B 24/25",
    "https://football-data.co.uk/mmz4281/2324/I2.csv": "Serie B 23/24",
    "https://football-data.co.uk/mmz4281/2223/I2.csv": "Serie B 22/23",
    "https://football-data.co.uk/mmz4281/2627/F1.csv": "Ligue 1 26/27",
    "https://football-data.co.uk/mmz4281/2526/F1.csv": "Ligue 1 25/26",
    "https://football-data.co.uk/mmz4281/2425/F1.csv": "Ligue 1 24/25",
    "https://football-data.co.uk/mmz4281/2324/F1.csv": "Ligue 1 23/24",
    "https://football-data.co.uk/mmz4281/2223/F1.csv": "Ligue 1 22/23",
    "https://football-data.co.uk/mmz4281/2627/F2.csv": "Ligue 2 26/27",
    "https://football-data.co.uk/mmz4281/2526/F2.csv": "Ligue 2 25/26",
    "https://football-data.co.uk/mmz4281/2425/F2.csv": "Ligue 2 24/25",
    "https://football-data.co.uk/mmz4281/2324/F2.csv": "Ligue 2 23/24",
    "https://football-data.co.uk/mmz4281/2223/F2.csv": "Ligue 2 22/23",
    "https://football-data.co.uk/mmz4281/2627/N1.csv": "Eredivisie 26/27",
    "https://football-data.co.uk/mmz4281/2526/N1.csv": "Eredivisie 25/26",
    "https://football-data.co.uk/mmz4281/2425/N1.csv": "Eredivisie 24/25",
    "https://football-data.co.uk/mmz4281/2324/N1.csv": "Eredivisie 23/24",
    "https://football-data.co.uk/mmz4281/2223/N1.csv": "Eredivisie 22/23",
    "https://football-data.co.uk/mmz4281/2627/P1.csv": "Primeira Liga 26/27",
    "https://football-data.co.uk/mmz4281/2526/P1.csv": "Primeira Liga 25/26",
    "https://football-data.co.uk/mmz4281/2425/P1.csv": "Primeira Liga 24/25",
    "https://football-data.co.uk/mmz4281/2324/P1.csv": "Primeira Liga 23/24",
    "https://football-data.co.uk/mmz4281/2223/P1.csv": "Primeira Liga 22/23",
    "https://football-data.co.uk/mmz4281/2627/B1.csv": "Belgium First Division A 26/27",
    "https://football-data.co.uk/mmz4281/2526/B1.csv": "Belgium First Division A 25/26",
    "https://football-data.co.uk/mmz4281/2425/B1.csv": "Belgium First Division A 24/25",
    "https://football-data.co.uk/mmz4281/2324/B1.csv": "Belgium First Division A 23/24",
    "https://football-data.co.uk/mmz4281/2223/B1.csv": "Belgium First Division A 22/23",
    "https://football-data.co.uk/mmz4281/2627/T1.csv": "Super Lig 26/27",
    "https://football-data.co.uk/mmz4281/2526/T1.csv": "Super Lig 25/26",
    "https://football-data.co.uk/mmz4281/2425/T1.csv": "Super Lig 24/25",
    "https://football-data.co.uk/mmz4281/2324/T1.csv": "Super Lig 23/24",
    "https://football-data.co.uk/mmz4281/2223/T1.csv": "Super Lig 22/23",
    "https://football-data.co.uk/mmz4281/2627/G1.csv": "Super League Greece 26/27",
    "https://football-data.co.uk/mmz4281/2526/G1.csv": "Super League Greece 25/26",
    "https://football-data.co.uk/mmz4281/2425/G1.csv": "Super League Greece 24/25",
    "https://football-data.co.uk/mmz4281/2324/G1.csv": "Super League Greece 23/24",
    "https://football-data.co.uk/mmz4281/2223/G1.csv": "Super League Greece 22/23",
}

CACHE_DIR_NAME = "csv_cache"

# ── Helpers ───────────────────────────────────────────────────────────────────


def cache_name(url: str) -> str:
    """Unique local filename from the URL, e.g. 2627_E0.csv"""
    parts = url.rstrip("/").split("/")
    return f"{parts[-2]}_{parts[-1]}"


def fetch_csv_text(url: str, cache_dir: Path) -> str | None:
    """Download a CSV (refreshing the cache). Fall back to the cached copy if
    the download fails. Returns None if neither is available."""
    cache_dir.mkdir(exist_ok=True)
    cached = cache_dir / cache_name(url)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
        cached.write_bytes(raw)
        print(f"  downloaded {url}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if cached.exists():
            print(f"  download failed ({e}); using cached {cached.name}")
            raw = cached.read_bytes()
        else:
            print(f"  FAILED {url}: {e}")
            return None

    # football-data files are usually UTF-8 (sometimes with BOM) or cp1252
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def parse_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        cleaned = {
            k.strip(): (v or "").strip()  # v is None when a row is short
            for k, v in row.items()
            if k and k.strip()
        }
        if cleaned:
            rows.append(cleaned)
    return rows


def safe_int(val: str) -> int:
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def match_to_compact(row: dict[str, str]) -> list:
    """Return a compact array instead of object to save space.
    Index: 0=date, 1=home, 2=away, 3=fthg, 4=ftag, 5=ftr,
           6=hthg, 7=htag, 8=hc, 9=ac, 10=tc,
           11=win2plus_home, 12=win2plus_away, 13=corners10plus, 14=league_idx
    """
    hc = safe_int(row.get("HC", "0"))
    ac = safe_int(row.get("AC", "0"))
    fthg = safe_int(row.get("FTHG", "0"))
    ftag = safe_int(row.get("FTAG", "0"))
    ftr = row.get("FTR", "").strip()

    return [
        row.get("Date", ""),               # 0
        row.get("HomeTeam", "").strip(),   # 1
        row.get("AwayTeam", "").strip(),   # 2
        fthg,                              # 3
        ftag,                              # 4
        ftr,                               # 5
        safe_int(row.get("HTHG", "0")),    # 6
        safe_int(row.get("HTAG", "0")),    # 7
        hc,                                # 8
        ac,                                # 9
        hc + ac,                           # 10
        1 if (ftr == "H" and fthg >= 2) else 0,  # 11 win2plus_home
        1 if (ftr == "A" and ftag >= 2) else 0,  # 12 win2plus_away
        1 if (hc + ac) >= 10 else 0,             # 13 corners10plus
        # 14 = league index, added later
    ]


def build_all_data(base_dir: Path) -> dict:
    cache_dir = base_dir / CACHE_DIR_NAME
    leagues_order: list[str] = []
    all_matches: list[list] = []
    seen_leagues: dict[str, int] = {}

    for url, league_name in LEAGUE_FILES.items():
        print(f"{league_name}:")
        text = fetch_csv_text(url, cache_dir)
        if text is None:
            continue

        if league_name not in seen_leagues:
            seen_leagues[league_name] = len(leagues_order)
            leagues_order.append(league_name)

        lg_idx = seen_leagues[league_name]
        rows = parse_csv(text)
        count = 0
        for row in rows:
            m = match_to_compact(row)
            if not m[1] or not m[2]:
                continue
            # Skip fixtures with no result yet (future matches in the file)
            if not m[5]:
                continue
            m.append(lg_idx)  # index 14 = league index
            all_matches.append(m)
            count += 1
        print(f"  {count} matches")

    # Dictionary-encode team names as integer indices to compress payload
    all_teams = sorted({m[1] for m in all_matches} | {m[2] for m in all_matches})
    team_to_idx = {name: idx for idx, name in enumerate(all_teams)}

    for m in all_matches:
        m[1] = team_to_idx[m[1]]
        m[2] = team_to_idx[m[2]]

    return {
        "l": leagues_order,   # leagues
        "t": all_teams,       # teams
        "m": all_matches,     # matches (compact arrays, dictionary-encoded teams)
    }


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    data = build_all_data(base_dir)

    if not data["m"]:
        print("No matches loaded - check your connection / URLs. data.js not written.")
        sys.exit(1)

    out_path = base_dir / "data.js"
    json_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"var FOOTYDATA = {json_str};\n")

    n = len(data["m"])
    nl = len(data["l"])
    nt = len(data["t"])
    sz = out_path.stat().st_size / 1024
    print(f"Exported {n:,} matches | {nl} leagues | {nt} teams | {sz:.0f} KB -> {out_path}")


if __name__ == "__main__":
    main()