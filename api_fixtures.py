"""
Fetch fixtures for English Premier League and English Championship
Season: 2026-2027 (season=2026)
Window: Next 7 days
API: API-Football v3 (https://v3.football.api-sports.io)
"""

import sys
import json
import argparse
import datetime

# Standard library HTTP client with requests fallback
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    import urllib.error
    HAS_REQUESTS = False

# API Configuration
API_KEY = "9afec5b02d90b1c67f9b98c1833d84a2"
BASE_URL = "https://v3.football.api-sports.io"

# Target leagues and strictly season 2026 (2026-2027)
DEFAULT_SEASON = 2026
LEAGUES = {
    "English Premier League": 39,
    "English Championship": 40
}

# Next 7-day window from current target date
DEFAULT_FROM_DATE = "2026-11-05"
DEFAULT_TO_DATE = "2026-11-12"
DEFAULT_TIMEZONE = "Europe/London"


def fetch_api(endpoint: str, params: dict) -> dict:
    """Fetch data from API-Football v3 using available HTTP client."""
    query_string = "&".join(f"{k}={v}" for k, v in params.items())
    full_url = f"{BASE_URL}/{endpoint}?{query_string}"
    headers = {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
    }

    if HAS_REQUESTS:
        resp = requests.get(full_url, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.json()
    else:
        req = urllib.request.Request(full_url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)


def format_fixture(item: dict) -> str:
    """Format fixture details for readable output."""
    fix = item.get("fixture", {})
    league = item.get("league", {})
    teams = item.get("teams", {})
    home = teams.get("home", {}).get("name", "Home")
    away = teams.get("away", {}).get("name", "Away")
    date_raw = fix.get("date", "")
    venue = fix.get("venue", {}).get("name") or "TBD"
    city = fix.get("venue", {}).get("city") or ""
    venue_str = f"{venue}, {city}" if city else venue
    status = fix.get("status", {}).get("long", "Scheduled")
    round_name = league.get("round", "")

    # Format date & time
    try:
        dt = datetime.datetime.fromisoformat(date_raw)
        formatted_dt = dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        formatted_dt = date_raw

    return (
        f"  - [{formatted_dt}] {home} vs {away}\n"
        f"    Round: {round_name} | Status: {status} | Venue: {venue_str} | ID: {fix.get('id')}"
    )


def main():
    parser = argparse.ArgumentParser(description="Fetch fixtures from API-Football v3")
    parser.add_argument("--season", type=int, default=DEFAULT_SEASON, help="Season starting year (e.g. 2026)")
    parser.add_argument("--from", dest="from_date", default=DEFAULT_FROM_DATE, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", default=DEFAULT_TO_DATE, help="End date (YYYY-MM-DD)")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE, help="Timezone (e.g. Europe/London)")
    args = parser.parse_args()

    print("=" * 70)
    print("API-FOOTBALL v3 - FIXTURE GATHERER")
    print(f"Season:       {args.season}-{args.season + 1} (season={args.season})")
    print(f"Date Range:   {args.from_date} to {args.to_date} (7 days)")
    print(f"Timezone:     {args.timezone}")
    print(f"HTTP Engine:  {'requests' if HAS_REQUESTS else 'urllib.request (standard library)'}")
    print("=" * 70)

    total_fixtures = 0

    for league_name, league_id in LEAGUES.items():
        print(f"\nQuerying {league_name} (League ID: {league_id})...")
        params = {
            "league": league_id,
            "season": args.season,
            "from": args.from_date,
            "to": args.to_date,
            "timezone": args.timezone
        }

        try:
            data = fetch_api("fixtures", params)
            errors = data.get("errors")
            if errors and len(errors) > 0:
                print(f"  [!] API returned errors:")
                for err_key, err_val in errors.items():
                    print(f"      - {err_key}: {err_val}")
                if "plan" in errors:
                    print("      Note: API-Football restricts current/future seasons to paid subscription tiers.")
                continue

            results_count = data.get("results", 0)
            fixtures = data.get("response", [])
            print(f"  Results returned by API: {results_count}")

            if results_count > 0:
                total_fixtures += results_count
                for item in fixtures:
                    print(format_fixture(item))
            else:
                print(f"  No fixtures found for {league_name} in season {args.season} between {args.from_date} and {args.to_date}.")

        except Exception as e:
            print(f"  [X] Failed to query {league_name}: {e}")

    print("\n" + "=" * 70)
    print(f"Summary: Found {total_fixtures} total fixtures across target leagues.")
    print("=" * 70)


if __name__ == "__main__":
    main()
