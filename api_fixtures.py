"""
Export English football fixtures from Free Football Live Scores API (worldcup26.ir)
Competitions: Premier League, Championship, FA Cup, and League Cup (Carabao Cup)
Window: Next 4 weeks
Destination: api_test.json
"""

import os
import sys
import json
import datetime
import urllib.request
import urllib.error

# API Configuration
BASE_URL = "https://worldcup26.ir/get/soccer"

# Target competitions and their respective API slugs
COMPETITIONS = {
    "Premier League": {
        "slug": "eng.1",
        "league_id": "700"
    },
    "Championship": {
        "slug": "eng.2",
        "league_id": "3914"
    },
    "League One": {
        "slug": "eng.3",
        "league_id": "3915"
    },
    "League Two": {
        "slug": "eng.4",
        "league_id": "3916"
    },
    "English National League": {
        "slug": "eng.5",
        "league_id": "3917"
    },
    "FA Cup": {
        "slug": "eng.fa",
        "league_id": "3918"
    },
    "League Cup": {
        "slug": "eng.league_cup",
        "league_id": "3920"
    },
    "Spanish LALIGA": {
        "slug": "esp.1",
        "league_id": "740"
    },
    "Spanish LA LIGA 2": {
        "slug": "esp.2",
        "league_id": "3921"
    },
    "Spanish Copa del Rey": {
        "slug": "esp.copa_del_rey",
        "league_id": "3924"
    },
    "German Bunesliga": {
        "slug": "ger.1",
        "league_id": "720"
    },
    "French Ligue 1": {
        "slug": "fra.1",
        "league_id": "710"
    },
    "Italian Serie A": {
        "slug": "ita.1",
        "league_id": "730"
    },
    "Portuguese Primeira Liga": {
        "slug": "por.1",
        "league_id": "750"
    },
    "Eredevise": {
        "slug": "ned.1",
        "league_id": "780"
    },
    "Belgian Pro League": {
        "slug": "bel.1",
        "league_id": "760"
    },
    "Scottish Premiership": {
        "slug": "sco.1",
        "league_id": "840"
    },
    "Turkish Super Lig": {
        "slug": "tur.1",
        "league_id": "880"
    }
}

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api_test.json")


def fetch_fixtures(slug: str, from_date_str: str, to_date_str: str) -> list:
    """Fetch stored fixtures for a league within a specific date window."""
    url = f"{BASE_URL}/{slug}/fixtures?from={from_date_str}&to={to_date_str}&status=all&limit=200"
    headers = {
        "User-Agent": "FootyStats-FixtureExporter/1.0",
        "Accept": "application/json"
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("events", [])
    except Exception as e:
        print(f"  [X] Failed fetching {slug}: {e}")
        return []


def parse_event(event: dict, comp_name: str, comp_slug: str) -> dict:
    """Normalize event payload into clean fixture dictionary."""
    comp_list = event.get("competitions", [{}])
    comp_data = comp_list[0] if comp_list else {}
    competitors = comp_data.get("competitors", [])

    home_comp = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away_comp = next((c for c in competitors if c.get("homeAway") == "away"), {})

    home_team = home_comp.get("team", {})
    away_team = away_comp.get("team", {})

    home_name = home_team.get("displayName") or home_team.get("name") or "Home Team"
    away_name = away_team.get("displayName") or away_team.get("name") or "Away Team"

    raw_date = event.get("date", "")
    date_formatted = ""
    time_formatted = ""

    if raw_date:
        try:
            # ISO 8601 parsing e.g. 2026-11-07T15:00:00.000Z
            clean_date = raw_date.replace("Z", "+00:00")
            dt = datetime.datetime.fromisoformat(clean_date)
            date_formatted = dt.strftime("%d/%m/%Y")
            time_formatted = dt.strftime("%H:%M")
        except Exception:
            date_formatted = raw_date[:10]
            time_formatted = raw_date[11:16]

    # Venue detection
    venue_info = comp_data.get("venue", {}) or event.get("venue", {})
    venue_name = venue_info.get("fullName") or venue_info.get("displayName") or "TBD"

    # Status
    status_type = event.get("status", {}).get("type", {})
    status_name = status_type.get("name", "STATUS_SCHEDULED")
    status_detail = status_type.get("detail", "Scheduled")

    return {
        "id": str(event.get("id")),
        "competition": comp_name,
        "competition_slug": comp_slug,
        "date": date_formatted,
        "time": time_formatted,
        "timestamp_utc": raw_date,
        "home": home_name,
        "home_short": home_team.get("shortDisplayName") or home_name,
        "home_abbr": home_team.get("abbreviation") or "",
        "home_logo": home_team.get("logo") or "",
        "away": away_name,
        "away_short": away_team.get("shortDisplayName") or away_name,
        "away_abbr": away_team.get("abbreviation") or "",
        "away_logo": away_team.get("logo") or "",
        "venue": venue_name,
        "status": status_name,
        "status_detail": status_detail
    }


def main():
    # Calculate 4-week window (28 days)
    # Target date reference: current date
    today = datetime.date(2026, 11, 7)
    # Check if actual system date is current
    sys_today = datetime.date.today()
    if sys_today.year >= 2026:
        today = sys_today

    end_date = today + datetime.timedelta(days=28)
    from_date_str = today.strftime("%Y%m%d")
    to_date_str = end_date.strftime("%Y%m%d")

    print("=" * 70)
    print("WORLDCUP26.IR - FOOTBALL FIXTURE EXPORTER")
    print(f"Date Window: {today.isoformat()} to {end_date.isoformat()} (4 weeks / 28 days)")
    print(f"Output File: {OUTPUT_FILE}")
    print("=" * 70)

    summary_counts = {}
    all_fixtures = []

    for comp_name, comp_info in COMPETITIONS.items():
        slug = comp_info["slug"]
        print(f"\nFetching {comp_name} ({slug})...")
        events = fetch_fixtures(slug, from_date_str, to_date_str)
        print(f"  Found {len(events)} fixtures from API.")

        parsed_fixtures = []
        for e in events:
            fix = parse_event(e, comp_name, slug)
            parsed_fixtures.append(fix)

        summary_counts[comp_name] = len(parsed_fixtures)
        all_fixtures.extend(parsed_fixtures)

        # Print quick preview
        for fix in parsed_fixtures[:3]:
            print(f"    - [{fix['date']} {fix['time']}] {fix['home']} vs {fix['away']} @ {fix['venue']}")

    # Sort all fixtures chronologically by timestamp
    all_fixtures.sort(key=lambda x: x.get("timestamp_utc") or "")

    summary_counts["total"] = len(all_fixtures)

    export_payload = {
        "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": BASE_URL,
        "date_range": {
            "from": today.isoformat(),
            "to": end_date.isoformat(),
            "days": 28
        },
        "summary": summary_counts,
        "fixtures": all_fixtures
    }

    # Write to api_test.json
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(export_payload, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70)
    print("EXPORT COMPLETED")
    for comp, count in summary_counts.items():
        print(f"  {comp:<20}: {count}")
    print(f"Saved into: {OUTPUT_FILE}")
    print("=" * 70)


if __name__ == "__main__":
    main()

