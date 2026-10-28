# /// script
# requires-python = ">=3.10"
# dependencies = ["rich"]
# ///
"""
Football Match Analyser
========================
1) Teams that Won with 2+ Goals  (highlighted green)
2) Matches with 10+ Total Corners (highlighted yellow)

Both sections list ALL fixtures for qualifying teams, with the
qualifying rows highlighted.

Usage:
    uv run analyse_wins.py
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from collections import defaultdict

from rich.console import Console
from rich.table import Table
from rich.text import Text
from rich.panel import Panel
from rich import box

# ── CSV files to process (filename -> pretty league name) ─────────────────────
LEAGUE_FILES: dict[str, str] = {
    "Premier League_2026-2027.csv": "Premier League 26/27",
    "Premier League_2025-2026.csv": "Premier League 25/26",
    "Premier League_2024-2025.csv": "Premier League 24/25",
    "Premier League_2023-2024.csv": "Premier League 23/24",
    "Premier Leagues_2022-2023.csv": "Premier Leagues 22/23",
    "Championship_2026-2027.csv": "Championship 26/27",
    "Championship_2025-2026.csv": "Championship 25/26",
    "Championship_2024-2025.csv": "Championship 24/25",
    "Championship_2023-2024.csv": "Championship 23/24",
    "Championship_2022-2023.csv": "Championship 22/23",
    "League One_2026-2027.csv": "League One 26/27",
    "League One_2025-2026.csv": "League One 25/26",
    "League One_2024-2025.csv": "League One 24/25",
    "League One_2023-2024.csv": "League One 23/24",
    "League One_2022-2023.csv": "League One 22/23",
    "League Two_2026-2027.csv": "League Two 26/27",
    "League Two_2025-2026.csv": "League Two 25/26",
    "League Two_2024-2025.csv": "League Two 24/25",
    "League Two_2023-2024.csv": "League Two 23/24",
    "League Two_2022-2023.csv": "League Two 22/23",
    "National League_2026-2027.csv": "National League 26/27",
    "National League_2025-2026.csv": "National League 25/26",
    "National League_2024-2025.csv": "National League 24/25",
    "National League_2023-2024.csv": "National League 23/24",
    "National League_2022-2023.csv": "National League 22/23",
    "Scottish Premiership_2026-2027.csv": "Scottish Premiership 26/27",
    "Scottish Premiership_2025-2026.csv": "Scottish Premiership 25/26",
    "Scottish Premiership_2024-2025.csv": "Scottish Premiership 24/25",
    "Scottish Premiership_2023-2024.csv": "Scottish Premiership 23/24",
    "Scottish Premiership_2022-2023.csv": "Scottish Premiership 22/23",
    "Scottish League One_2026-2027.csv": "Scottish League One 26/27",
    "Scottish League One_2025-2026.csv": "Scottish League One 25/26",
    "Scottish League One_2024-2025.csv": "Scottish League One 24/25",
    "Scottish League One_2023-2024.csv": "Scottish League One 23/24",
    "Scottish League One_2022-2023.csv": "Scottish League One 22/23",
    "La Liga_2026-2027.csv": "La Liga 26/27",
    "La Liga_2025-2026.csv": "La Liga 25/26",
    "La Liga_2024-2025.csv": "La Liga 24/25",
    "La Liga_2023-2024.csv": "La Liga 23/24",
    "La Liga_2022-2023.csv": "La Liga 22/23",
    "La Liga 2_2026-2027.csv": "La Liga 2 26/27",
    "La Liga 2_2025-2026.csv": "La Liga 2 25/26",
    "La Liga 2_2024-2025.csv": "La Liga 2 24/25",
    "La Liga 2_2023-2024.csv": "La Liga 2 23/24",
    "La Liga 2_2022-2023.csv": "La Liga 2 22/23",
    "Bundesliga_2026-2027.csv": "Bundesliga 26/27",
    "Bundesliga_2025-2026.csv": "Bundesliga 25/26",
    "Bundesliga_2024-2025.csv": "Bundesliga 24/25",
    "Bundesliga_2023-2024.csv": "Bundesliga 23/24",
    "Bundesliga_2022-2023.csv": "Bundesliga 22/23",
    "Bundesliga 2_2026-2027.csv": "Bundesliga 2 26/27",
    "Bundesliga 2_2025-2026.csv": "Bundesliga 2 25/26",
    "Bundesliga 2_2024-2025.csv": "Bundesliga 2 24/25",
    "Bundesliga 2_2023-2024.csv": "Bundesliga 2 23/24",
    "Bundesliga 2_2022-2023.csv": "Bundesliga 2 22/23",
    "Serie A_2026-2027.csv": "Serie A 26/27",
    "Serie A_2025-2026.csv": "Serie A 25/26",
    "Serie A_2024-2025.csv": "Serie A 24/25",
    "Serie A_2023-2024.csv": "Serie A 23/24",
    "Serie A_2022-2023.csv": "Serie A 22/23",
    "Serie B_2026-2027.csv": "Serie B 26/27",
    "Serie B_2025-2026.csv": "Serie B 25/26",
    "Serie B_2024-2025.csv": "Serie B 24/25",
    "Serie B_2023-2024.csv": "Serie B 23/24",
    "Serie B_2022-2023.csv": "Serie B 22/23",
    "League of Ireland Premier Division_2012-2026.csv": "League of Ireland Premier Division 12/26",
    "Ligue 1_2026-2027.csv": "Ligue 1 26/27",
    "Ligue 1_2025-2026.csv": "Ligue 1 25/26",
    "Ligue 1_2024-2025.csv": "Ligue 1 24/25",
    "Ligue 1_2023-2024.csv": "Ligue 1 23/24",
    "Ligue 1_2022-2023.csv": "Ligue 1 22/23",
    "Ligue 2_2026-2027.csv": "Ligue 2 26/27",
    "Ligue 2_2025-2026.csv": "Ligue 2 25/26",
    "Ligue 2_2024-2025.csv": "Ligue 2 24/25",
    "Ligue 2_2023-2024.csv": "Ligue 2 23/24",
    "Ligue 2_2022-2023.csv": "Ligue 2 22/23",
    "Eredivisie_2026-2027.csv": "Eredivisie 26/27",
    "Eredivisie_2025-2026.csv": "Eredivisie 25/26",
    "Eredivisie_2024-2025.csv": "Eredivisie 24/25",
    "Eredivisie_2023-2024.csv": "Eredivisie 23/24",
    "Eredivisie_2022-2023.csv": "Eredivisie 22/23",
    "Poland Ekstraklasa_2012-2027.csv": "Poland Ekstraklasa 26/27",
    "Primeira Liga_2026-2027.csv": "Primeira Liga 26/27",
    "Primeira Liga_2025-2026.csv": "Primeira Liga 25/26",
    "Primeira Liga_2024-2025.csv": "Primeira Liga 24/25",
    "Primeira Liga_2023-2024.csv": "Primeira Liga 23/24",
    "Primeira Liga_2022-2023.csv": "Primeira Liga 22/23",
    "Belgium First Division A_2026-2027.csv": "Belgium First Division A 26/27",
    "Belgium First Division A_2025-2026.csv": "Belgium First Division A 25/26",
    "Belgium First Division A_2024-2025.csv": "Belgium First Division A 24/25",
    "Belgium First Division A_2023-2024.csv": "Belgium First Division A 23/24",
    "Belgium First Division A_2022-2023.csv": "Belgium First Division A 22/23",
    "Super Lig_2026-2027.csv": "Super Lig 26/27",
    "Super Lig_2025-2026.csv": "Super Lig 25/26",
    "Super Lig_2024-2025.csv": "Super Lig 24/25",
    "Super Lig_2023-2024.csv": "Super Lig 23/24",
    "Super Lig_2022-2023.csv": "Super Lig 22/23",
    "Super League Greece_2026-2027.csv": "Super League Greece 26/27",
    "Super League Greece_2025-2026.csv": "Super League Greece 25/26",
    "Super League Greece_2024-2025.csv": "Super League Greece 24/25",
    "Super League Greece_2023-2024.csv": "Super League Greece 23/24",
    "Super League Greece_2022-2023.csv": "Super League Greece 22/23",
}

# ── Helpers ───────────────────────────────────────────────────────────────────


def read_csv(filepath: Path) -> list[dict[str, str]]:
    """Read a CSV, stripping whitespace from headers and values."""
    with open(filepath, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows: list[dict[str, str]] = []
        for row in reader:
            cleaned = {k.strip(): v.strip() for k, v in row.items() if k}
            rows.append(cleaned)
        return rows


def safe_int(val: str) -> int:
    """Convert a string to int, returning 0 on failure."""
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


# ── Qualifier predicates ─────────────────────────────────────────────────────


def is_qualifying_home_win(row: dict[str, str]) -> bool:
    """Home team won AND scored >= 2 goals."""
    return row.get("FTR", "") == "H" and safe_int(row.get("FTHG", "0")) >= 2


def is_qualifying_away_win(row: dict[str, str]) -> bool:
    """Away team won AND scored >= 2 goals."""
    return row.get("FTR", "") == "A" and safe_int(row.get("FTAG", "0")) >= 2


def is_high_corners(row: dict[str, str]) -> bool:
    """Total match corners (HC + AC) >= 10."""
    hc = safe_int(row.get("HC", "0"))
    ac = safe_int(row.get("AC", "0"))
    return (hc + ac) >= 10


# ── Data structures ──────────────────────────────────────────────────────────

# league -> team -> {"home": [rows], "away": [rows],
#                    "home_qual": set(idx), "away_qual": set(idx)}
LeagueData = dict[str, dict[str, dict]]


def _empty_team_record() -> dict:
    return {"home": [], "away": [], "home_qual": set(), "away_qual": set()}


def build_wins_data(base_dir: Path) -> LeagueData:
    """Build dataset for teams with wins scoring 2+ goals."""
    data: LeagueData = {}

    for filename, league_name in LEAGUE_FILES.items():
        filepath = base_dir / filename
        if not filepath.exists():
            continue

        rows = read_csv(filepath)
        teams: dict[str, dict] = defaultdict(_empty_team_record)

        for row in rows:
            home = row.get("HomeTeam", "").strip()
            away = row.get("AwayTeam", "").strip()
            if not home or not away:
                continue

            h_idx = len(teams[home]["home"])
            teams[home]["home"].append(row)
            if is_qualifying_home_win(row):
                teams[home]["home_qual"].add(h_idx)

            a_idx = len(teams[away]["away"])
            teams[away]["away"].append(row)
            if is_qualifying_away_win(row):
                teams[away]["away_qual"].add(a_idx)

        qualified = {
            team: info
            for team, info in teams.items()
            if info["home_qual"] or info["away_qual"]
        }
        if qualified:
            data[league_name] = dict(sorted(qualified.items()))

    return data


def build_corners_data(base_dir: Path) -> LeagueData:
    """Build dataset for teams involved in matches with 10+ total corners."""
    data: LeagueData = {}

    for filename, league_name in LEAGUE_FILES.items():
        filepath = base_dir / filename
        if not filepath.exists():
            continue

        rows = read_csv(filepath)
        teams: dict[str, dict] = defaultdict(_empty_team_record)

        for row in rows:
            home = row.get("HomeTeam", "").strip()
            away = row.get("AwayTeam", "").strip()
            if not home or not away:
                continue

            high = is_high_corners(row)

            h_idx = len(teams[home]["home"])
            teams[home]["home"].append(row)
            if high:
                teams[home]["home_qual"].add(h_idx)

            a_idx = len(teams[away]["away"])
            teams[away]["away"].append(row)
            if high:
                teams[away]["away_qual"].add(a_idx)

        qualified = {
            team: info
            for team, info in teams.items()
            if info["home_qual"] or info["away_qual"]
        }
        if qualified:
            data[league_name] = dict(sorted(qualified.items()))

    return data


# ── Rendering ─────────────────────────────────────────────────────────────────

HEADER_STYLE_GREEN = "bold white on dark_green"
HEADER_STYLE_YELLOW = "bold black on yellow"
TITLE_STYLE = "bold cyan"
LEAGUE_STYLE = "bold magenta"

QUAL_STYLE_WINS = "bold green"
QUAL_STYLE_CORNERS = "bold yellow"


def result_label(ftr: str, perspective_home: bool) -> Text:
    """Return a coloured W / D / L label."""
    if perspective_home:
        mapping = {"H": ("W", "bold green"), "D": ("D", "yellow"), "A": ("L", "bold red")}
    else:
        mapping = {"A": ("W", "bold green"), "D": ("D", "yellow"), "H": ("L", "bold red")}
    label, style = mapping.get(ftr, (ftr, ""))
    return Text(label, style=style)


def make_wins_table(
    team: str,
    venue: str,
    fixtures: list[dict[str, str]],
    qual_indices: set[int],
) -> Table | None:
    """Table for the 2+ goals wins analysis."""
    if not fixtures:
        return None

    venue_icon = "[H]" if venue == "HOME" else "[A]"
    title = f"{venue_icon}  {team} -- {venue}"
    tbl = Table(
        title=title,
        title_style=TITLE_STYLE,
        box=box.ROUNDED,
        show_lines=True,
        expand=False,
        border_style="bright_black",
        header_style=HEADER_STYLE_GREEN,
        row_styles=["", "dim"],
        padding=(0, 1),
    )

    tbl.add_column("#", justify="right", style="dim", width=3)
    tbl.add_column("Date", min_width=10)
    tbl.add_column("Home", min_width=16)
    tbl.add_column("Score", justify="center", min_width=5)
    tbl.add_column("Away", min_width=16)
    tbl.add_column("Result", justify="center", min_width=6)
    tbl.add_column("HT", justify="center", min_width=5)
    tbl.add_column("OK", justify="center", width=4)

    for idx, row in enumerate(fixtures):
        is_qual = idx in qual_indices
        style = QUAL_STYLE_WINS if is_qual else ""

        home = row.get("HomeTeam", "")
        away = row.get("AwayTeam", "")
        hg = row.get("FTHG", "")
        ag = row.get("FTAG", "")
        ftr = row.get("FTR", "")
        date = row.get("Date", "")
        hthg = row.get("HTHG", "")
        htag = row.get("HTAG", "")

        score = f"{hg} - {ag}"
        ht_score = f"{hthg} - {htag}" if hthg and htag else ""
        is_home = venue == "HOME"
        res = result_label(ftr, is_home)
        marker = Text("YES", style="bold green") if is_qual else Text("")

        tbl.add_row(
            str(idx + 1),
            Text(date, style=style),
            Text(home, style=style),
            Text(score, style=style),
            Text(away, style=style),
            res,
            Text(ht_score, style=style),
            marker,
            style=style if is_qual else None,
        )

    return tbl


def make_corners_table(
    team: str,
    venue: str,
    fixtures: list[dict[str, str]],
    qual_indices: set[int],
) -> Table | None:
    """Table for the 10+ corners analysis -- includes HC, AC, Total columns."""
    if not fixtures:
        return None

    venue_icon = "[H]" if venue == "HOME" else "[A]"
    title = f"{venue_icon}  {team} -- {venue}"
    tbl = Table(
        title=title,
        title_style=TITLE_STYLE,
        box=box.ROUNDED,
        show_lines=True,
        expand=False,
        border_style="bright_black",
        header_style=HEADER_STYLE_YELLOW,
        row_styles=["", "dim"],
        padding=(0, 1),
    )

    tbl.add_column("#", justify="right", style="dim", width=3)
    tbl.add_column("Date", min_width=10)
    tbl.add_column("Home", min_width=16)
    tbl.add_column("Score", justify="center", min_width=5)
    tbl.add_column("Away", min_width=16)
    tbl.add_column("Result", justify="center", min_width=6)
    tbl.add_column("HC", justify="center", width=4)
    tbl.add_column("AC", justify="center", width=4)
    tbl.add_column("Corners", justify="center", width=7)
    tbl.add_column("10+", justify="center", width=4)

    for idx, row in enumerate(fixtures):
        is_qual = idx in qual_indices
        style = QUAL_STYLE_CORNERS if is_qual else ""

        home = row.get("HomeTeam", "")
        away = row.get("AwayTeam", "")
        hg = row.get("FTHG", "")
        ag = row.get("FTAG", "")
        ftr = row.get("FTR", "")
        date = row.get("Date", "")
        hc = row.get("HC", "")
        ac = row.get("AC", "")
        total_corners = safe_int(hc) + safe_int(ac)

        score = f"{hg} - {ag}"
        is_home = venue == "HOME"
        res = result_label(ftr, is_home)
        marker = Text("YES", style="bold yellow") if is_qual else Text("")
        total_str = str(total_corners) if (hc or ac) else ""

        tbl.add_row(
            str(idx + 1),
            Text(date, style=style),
            Text(home, style=style),
            Text(score, style=style),
            Text(away, style=style),
            res,
            Text(hc, style=style),
            Text(ac, style=style),
            Text(total_str, style="bold" if is_qual else ""),
            marker,
            style=style if is_qual else None,
        )

    return tbl


def print_wins_league(console: Console, league: str, teams: dict[str, dict]) -> None:
    total_qual = sum(
        len(info["home_qual"]) + len(info["away_qual"]) for info in teams.values()
    )

    console.print()
    console.rule(f"[{LEAGUE_STYLE}]** {league} **[/]", style="magenta")
    console.print(
        f"  [dim]{len(teams)} team(s) with qualifying wins  |  "
        f"{total_qual} qualifying match(es) total[/dim]"
    )
    console.print()

    for team, info in teams.items():
        home_tbl = make_wins_table(team, "HOME", info["home"], info["home_qual"])
        away_tbl = make_wins_table(team, "AWAY", info["away"], info["away_qual"])

        if home_tbl:
            console.print(home_tbl)
            console.print()
        if away_tbl:
            console.print(away_tbl)
            console.print()


def print_corners_league(console: Console, league: str, teams: dict[str, dict]) -> None:
    total_qual = sum(
        len(info["home_qual"]) + len(info["away_qual"]) for info in teams.values()
    )

    console.print()
    console.rule(f"[{LEAGUE_STYLE}]** {league} **[/]", style="magenta")
    console.print(
        f"  [dim]{len(teams)} team(s) with 10+ corner matches  |  "
        f"{total_qual} qualifying match(es) total[/dim]"
    )
    console.print()

    for team, info in teams.items():
        home_tbl = make_corners_table(team, "HOME", info["home"], info["home_qual"])
        away_tbl = make_corners_table(team, "AWAY", info["away"], info["away_qual"])

        if home_tbl:
            console.print(home_tbl)
            console.print()
        if away_tbl:
            console.print(away_tbl)
            console.print()


# ── Main ──────────────────────────────────────────────────────────────────────


def _count_qual(data: LeagueData) -> tuple[int, int]:
    """Return (total_teams, total_qualifying_matches) across all leagues."""
    total_teams = sum(len(t) for t in data.values())
    total_matches = sum(
        len(info["home_qual"]) + len(info["away_qual"])
        for teams in data.values()
        for info in teams.values()
    )
    return total_teams, total_matches


def main() -> None:
    try:
        width = min(os.get_terminal_size().columns, 200)
    except OSError:
        width = 200
    console = Console(width=width, force_terminal=True)

    base_dir = Path(__file__).resolve().parent

    # ── Build both datasets ───────────────────────────────────────────────
    wins_data = build_wins_data(base_dir)
    corners_data = build_corners_data(base_dir)

    if not wins_data and not corners_data:
        console.print("[bold red]No qualifying matches found.[/bold red]")
        sys.exit(1)

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 1 : Wins with 2+ Goals
    # ═══════════════════════════════════════════════════════════════════════
    if wins_data:
        w_teams, w_matches = _count_qual(wins_data)
        console.print()
        console.print(
            Panel.fit(
                f"[bold white]Teams that WON with 2+ Goals Scored[/bold white]\n"
                f"[dim]2025-2026 Season  |  {len(wins_data)} league(s)  |  "
                f"{w_teams} team(s)  |  {w_matches} qualifying match(es)[/dim]\n\n"
                f"[green]Highlighted rows[/green] = Win with >= 2 goals scored",
                title="SECTION 1 -- Wins with 2+ Goals",
                border_style="bright_cyan",
                padding=(1, 4),
            )
        )

        for league_name in LEAGUE_FILES.values():
            if league_name in wins_data:
                print_wins_league(console, league_name, wins_data[league_name])

        console.print()
        console.rule("[bold cyan]End of Wins Report[/bold cyan]", style="cyan")

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 2 : 10+ Corners
    # ═══════════════════════════════════════════════════════════════════════
    if corners_data:
        c_teams, c_matches = _count_qual(corners_data)
        console.print()
        console.print()
        console.print(
            Panel.fit(
                f"[bold white]Matches with 10+ Total Corners[/bold white]\n"
                f"[dim]2025-2026 Season  |  {len(corners_data)} league(s)  |  "
                f"{c_teams} team(s)  |  {c_matches} qualifying match(es)[/dim]\n\n"
                f"[yellow]Highlighted rows[/yellow] = Match with >= 10 total corners\n"
                f"[dim]HC = Home Corners  |  AC = Away Corners[/dim]",
                title="SECTION 2 -- Matches with 10+ Corners",
                border_style="bright_yellow",
                padding=(1, 4),
            )
        )

        for league_name in LEAGUE_FILES.values():
            if league_name in corners_data:
                print_corners_league(console, league_name, corners_data[league_name])

        console.print()
        console.rule("[bold yellow]End of Corners Report[/bold yellow]", style="yellow")

    console.print()


if __name__ == "__main__":
    main()
