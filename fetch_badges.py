"""
Fetch and cache team badges/logos for English Premier League and English Championship.
Source: API-Football v3 (https://v3.football.api-sports.io)
Destination: team_badges/
"""

import os
import re
import sys
import json
import time
import argparse
import urllib.request
import urllib.error

# API Configuration
API_KEY = "9afec5b02d90b1c67f9b98c1833d84a2"
BASE_URL = "https://v3.football.api-sports.io"

# Target leagues
LEAGUES = {
    "English Premier League": 39,
    "English Championship": 40
}

# Default season (Free tier supports 2022-2024; auto-falls back if 2026 is blocked)
DEFAULT_SEASON = 2024
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "team_badges")


def sanitize_slug(name: str) -> str:
    """Convert team name into a clean, safe filename slug."""
    s = name.lower()
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s


def fetch_api(endpoint: str, params: dict) -> dict:
    """Fetch JSON data from API-Football v3."""
    query_string = "&".join(f"{k}={v}" for k, v in params.items())
    full_url = f"{BASE_URL}/{endpoint}?{query_string}"
    headers = {
        "x-apisports-key": API_KEY,
        "Accept": "application/json",
        "User-Agent": "FootyStats-BadgeGatherer/1.0"
    }

    req = urllib.request.Request(full_url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_image(url: str, dest_paths: list[str]) -> bool:
    """Download image from url and save to all specified destination paths if missing."""
    # Check if all destination files already exist
    all_exist = all(os.path.exists(p) and os.path.getsize(p) > 0 for p in dest_paths)
    if all_exist:
        return False  # Already cached

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    req = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()

    for p in dest_paths:
        with open(p, "wb") as f:
            f.write(data)

    return True  # Freshly downloaded


def main():
    parser = argparse.ArgumentParser(description="Gather team badges from API-Football")
    parser.add_argument("--season", type=int, default=DEFAULT_SEASON, help="Season starting year")
    parser.add_argument("--dir", default=OUTPUT_DIR, help="Destination directory for team badges")
    args = parser.parse_args()

    os.makedirs(args.dir, exist_ok=True)

    print("=" * 70)
    print("API-FOOTBALL v3 - TEAM BADGES GATHERER")
    print(f"Target Season:   {args.season}")
    print(f"Output Directory: {args.dir}")
    print("=" * 70)

    manifest_data = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "season_queried": args.season,
        "teams": []
    }

    total_downloaded = 0
    total_cached = 0

    for league_name, league_id in LEAGUES.items():
        print(f"\n--- {league_name} (ID: {league_id}) ---")
        params = {"league": league_id, "season": args.season}

        data = fetch_api("teams", params)
        errors = data.get("errors")

        # Auto-fallback to 2024 if plan restriction encountered
        if errors and "plan" in errors and args.season != 2024:
            print(f"  [!] Plan restriction on season {args.season}: {errors['plan']}")
            print("  [*] Automatically falling back to latest accessible season (2024)...")
            params["season"] = 2024
            manifest_data["season_queried"] = 2024
            data = fetch_api("teams", params)
            errors = data.get("errors")

        if errors and len(errors) > 0:
            print(f"  [X] Error fetching teams: {errors}")
            continue

        teams_list = data.get("response", [])
        print(f"  Found {len(teams_list)} clubs.")

        for item in teams_list:
            t = item.get("team", {})
            team_id = t.get("id")
            name = t.get("name", "Unknown")
            code = t.get("code") or ""
            logo_url = t.get("logo")

            if not logo_url or not team_id:
                continue

            slug = sanitize_slug(name)
            slug_filename = f"{slug}.png"
            id_filename = f"{team_id}.png"

            slug_path = os.path.join(args.dir, slug_filename)
            id_path = os.path.join(args.dir, id_filename)

            try:
                downloaded = download_image(logo_url, [slug_path, id_path])
                status_str = "Downloaded" if downloaded else "Cached"
                if downloaded:
                    total_downloaded += 1
                    time.sleep(0.08)  # Polite pause between downloads
                else:
                    total_cached += 1

                print(f"  [{status_str}] {name} ({code}) -> {slug_filename}")

                manifest_data["teams"].append({
                    "id": team_id,
                    "name": name,
                    "code": code,
                    "slug": slug,
                    "league_id": league_id,
                    "league_name": league_name,
                    "files": [slug_filename, id_filename],
                    "remote_logo": logo_url
                })

            except Exception as e:
                print(f"  [!] Failed to download badge for {name}: {e}")

    # Write manifest.json
    manifest_path = os.path.join(args.dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    print("\n" + "=" * 70)
    print("BADGES SUMMARY")
    print(f"Total Clubs Processed: {len(manifest_data['teams'])}")
    print(f"New Downloads:         {total_downloaded}")
    print(f"Already Cached:        {total_cached}")
    print(f"Manifest Generated:    {manifest_path}")
    print("=" * 70)


if __name__ == "__main__":
    main()

