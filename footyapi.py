"""
Bzzoiro Sports Data (BSD) Football API integration for FootyStats Analyser.
Primary 26/27 data source for both completed results (data.js) and upcoming
fixtures (fixtures.js) across the 19 BSD-covered FootyStats leagues
(excludes Scottish League One for 26/27).

Historical seasons (19/20-25/26) continue loading from ./csv_cache/.
API key is read from BZZOIRO_API_KEY env var or --api-key (never hardcoded).

Usage:
    $env:BZZOIRO_API_KEY="your_token"
    .\\.venv\\Scripts\\python.exe footyapi.py --export-all
    .\\.venv\\Scripts\\python.exe footyapi.py --export-results --full-refresh
    .\\.venv\\Scripts\\python.exe footyapi.py --export-fixtures --days 14
    .\\.venv\\Scripts\\python.exe footyapi.py --date 2026-11-21
    .\\.venv\\Scripts\\python.exe footyapi.py --leagues
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import export_data

if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_URL = "https://sports.bzzoiro.com"
SEASON_LABEL = "26/27"
SEASON_START_DATE = "2026-07-01"
BSD_CACHE_DIR = "bsd_cache"
BSD_RESULTS_CACHE_FILE = "results_2627.json"

LEAGUE_ENDPOINTS = [
    f"{BASE_URL}/api/leagues/",
    f"{BASE_URL}/api/v2/leagues/",
    f"{BASE_URL}/api/football/leagues/",
]
EVENT_ENDPOINTS = [
    f"{BASE_URL}/api/events/",
    f"{BASE_URL}/api/v2/events/",
    f"{BASE_URL}/api/football/events/",
]
PREDICTION_ENDPOINTS = [
    f"{BASE_URL}/api/predictions/",
    f"{BASE_URL}/api/v2/predictions/",
]

# Verified 19 / 20 FootyStats leagues available in BSD API (Scottish League One excluded for 26/27)
AVAILABLE_LEAGUE_IDS: dict[int, str] = {
    1: "Premier League",
    12: "Championship",
    86: "League One",
    87: "League Two",
    91: "National League",
    13: "Scottish Premiership",
    3: "La Liga",
    38: "La Liga 2",
    5: "Bundesliga",
    94: "Bundesliga 2",
    4: "Serie A",
    100: "Serie B",
    6: "Ligue 1",
    89: "Ligue 2",
    10: "Eredivisie",
    2: "Primeira Liga",
    14: "Belgium First Division A",
    11: "Super Lig",
    24: "Super League Greece",
}

LEAGUE_NAME_TO_BSD_ID: dict[str, int] = {v: k for k, v in AVAILABLE_LEAGUE_IDS.items()}

LEAGUE_ID_TO_DIV: dict[int, str] = {
    1: "E0",
    12: "E1",
    86: "E2",
    87: "E3",
    91: "EC",
    13: "SC0",
    3: "SP1",
    38: "SP2",
    5: "D1",
    94: "D2",
    4: "I1",
    100: "I2",
    6: "F1",
    89: "F2",
    10: "N1",
    2: "P1",
    14: "B1",
    11: "T1",
    24: "G1",
}

BASE_LEAGUE_TO_COUNTRY: dict[str, str] = {
    "Premier League": "england",
    "Championship": "england",
    "League One": "england",
    "League Two": "england",
    "National League": "england",
    "Scottish Premiership": "scotland",
    "Scottish League One": "scotland",
    "La Liga": "spain",
    "La Liga 2": "spain",
    "Bundesliga": "germany",
    "Bundesliga 2": "germany",
    "Serie A": "italy",
    "Serie B": "italy",
    "Ligue 1": "france",
    "Ligue 2": "france",
    "Eredivisie": "netherlands",
    "Primeira Liga": "portugal",
    "Belgium First Division A": "belgium",
    "Super Lig": "turkey",
    "Super League Greece": "greece",
}

LEAGUE_ORDER: list[str] = list(AVAILABLE_LEAGUE_IDS.values())

# All 20 base leagues tracked in export_data.py (used for --leagues audit mode)
TRACKED_LEAGUES: list[dict[str, Any]] = [
    {"name": "Premier League", "countries": ["england", "united kingdom", "uk", "gb"], "aliases": ["premier league", "english premier league", "epl"]},
    {"name": "Championship", "countries": ["england", "united kingdom", "uk", "gb"], "aliases": ["championship", "efl championship", "english championship"]},
    {"name": "League One", "countries": ["england", "united kingdom", "uk", "gb"], "aliases": ["league one", "efl league one", "english league one"]},
    {"name": "League Two", "countries": ["england", "united kingdom", "uk", "gb"], "aliases": ["league two", "efl league two", "english league two"]},
    {"name": "National League", "countries": ["england", "united kingdom", "uk", "gb"], "aliases": ["national league", "vanarama national league", "english national league"]},
    {"name": "Scottish Premiership", "countries": ["scotland"], "aliases": ["scottish premiership", "premiership"]},
    {"name": "Scottish League One", "countries": ["scotland"], "aliases": ["scottish league one", "league one", "league 1", "scottish league 1"]},
    {"name": "La Liga", "countries": ["spain"], "aliases": ["la liga", "laliga", "laliga ea sports", "primera division"]},
    {"name": "La Liga 2", "countries": ["spain"], "aliases": ["la liga 2", "laliga 2", "laliga2", "laliga hypermotion", "segunda division"]},
    {"name": "Bundesliga", "countries": ["germany"], "aliases": ["bundesliga", "1 bundesliga"]},
    {"name": "Bundesliga 2", "countries": ["germany"], "aliases": ["bundesliga 2", "2 bundesliga"]},
    {"name": "Serie A", "countries": ["italy"], "aliases": ["serie a"]},
    {"name": "Serie B", "countries": ["italy"], "aliases": ["serie b"]},
    {"name": "Ligue 1", "countries": ["france"], "aliases": ["ligue 1", "ligue 1 mcdonalds", "ligue 1 uber eats"]},
    {"name": "Ligue 2", "countries": ["france"], "aliases": ["ligue 2", "ligue 2 bkt"]},
    {"name": "Eredivisie", "countries": ["netherlands", "holland"], "aliases": ["eredivisie"]},
    {"name": "Primeira Liga", "countries": ["portugal"], "aliases": ["primeira liga", "liga portugal", "liga portugal betclic"]},
    {"name": "Belgium First Division A", "countries": ["belgium"], "aliases": ["belgium first division a", "first division a", "pro league", "jupiler pro league", "belgian pro league"]},
    {"name": "Super Lig", "countries": ["turkey", "turkiye"], "aliases": ["super lig", "trendyol super lig"]},
    {"name": "Super League Greece", "countries": ["greece"], "aliases": ["super league greece", "super league", "super league 1", "stoiximan super league"]},
]

# Explicit BSD full club name (normalized) -> canonical football-data.co.uk / data.js name
BSD_TEAM_ALIASES: dict[str, str] = {
    # England
    "manchester united": "Man United",
    "manchester city": "Man City",
    "nottingham forest": "Nott'm Forest",
    "wolverhampton wanderers": "Wolves",
    "wolverhampton": "Wolves",
    "west bromwich albion": "West Brom",
    "west ham united": "West Ham",
    "tottenham hotspur": "Tottenham",
    "newcastle united": "Newcastle",
    "brighton hove albion": "Brighton",
    "queens park rangers": "QPR",
    "sheffield wednesday": "Sheffield Weds",
    "sheffield united": "Sheffield United",
    "milton keynes dons": "Milton Keynes Dons",
    "preston north end": "Preston",
    "oxford united": "Oxford",
    "cambridge united": "Cambridge",
    "peterborough united": "Peterborough",
    "rotherham united": "Rotherham",
    "colchester united": "Colchester",
    "carlisle united": "Carlisle",
    "hartlepool united": "Hartlepool",
    "scunthorpe united": "Scunthorpe",
    "sutton united": "Sutton",
    "boston united": "Boston Utd",
    "southend united": "Southend",
    "torquay united": "Torquay",
    "maidenhead united": "Maidenhead",
    "harrogate town": "Harrogate",
    "luton town": "Luton",
    "ipswich town": "Ipswich",
    "huddersfield town": "Huddersfield",
    "mansfield town": "Mansfield",
    "swindon town": "Swindon",
    "crawley town": "Crawley Town",
    "cheltenham town": "Cheltenham",
    "grimsby town": "Grimsby",
    "northampton town": "Northampton",
    "shrewsbury town": "Shrewsbury",
    "fleetwood town": "Fleetwood Town",
    "aldershot town": "Aldershot",
    "yeovil town": "Yeovil",
    "fc halifax town": "Halifax",
    "halifax town": "Halifax",
    "hull city": "Hull",
    "coventry city": "Coventry",
    "norwich city": "Norwich",
    "cardiff city": "Cardiff",
    "bristol city": "Bristol City",
    "stoke city": "Stoke",
    "swansea city": "Swansea",
    "birmingham city": "Birmingham",
    "lincoln city": "Lincoln",
    "leicester city": "Leicester",
    "bradford city": "Bradford",
    "exeter city": "Exeter",
    "salford city": "Salford",
    "york city": "York",
    "leeds united": "Leeds",
    "derby county": "Derby",
    "stockport county": "Stockport",
    "newport county": "Newport County",
    "notts county": "Notts County",
    "charlton athletic": "Charlton",
    "wigan athletic": "Wigan",
    "oldham athletic": "Oldham",
    "crewe alexandra": "Crewe",
    "bolton wanderers": "Bolton",
    "wycombe wanderers": "Wycombe",
    "doncaster rovers": "Doncaster",
    "tranmere rovers": "Tranmere",
    "bristol rovers": "Bristol Rvs",
    "forest green rovers": "Forest Green",
    "blackburn rovers": "Blackburn",
    "plymouth argyle": "Plymouth",
    "burton albion": "Burton",
    "accrington stanley": "Accrington",
    "liverpool fc": "Liverpool",
    "afc bournemouth": "Bournemouth",
    "afc wimbledon": "AFC Wimbledon",
    "afc fylde": "AFC Fylde",
    "barrow afc": "Barrow",
    "altrincham fc": "Altrincham",
    "worthing fc": "Worthing",
    "kidderminster harriers": "Kidderminster",
    "dagenham redbridge": "Dag and Red",
    "ebbsfleet united": "Ebbsfleet",
    "boreham wood": "Boreham Wood",
    "braintree town": "Braintree Town",
    "solihull moors": "Solihull",
    # Scotland
    "heart of midlothian": "Hearts",
    "dundee fc": "Dundee",
    "falkirk fc": "Falkirk",
    "st johnstone": "St Johnstone",
    "st mirren": "St Mirren",
    "ross county": "Ross County",
    "inverness caledonian thistle": "Inverness C",
    # Spain
    "atletico madrid": "Ath Madrid",
    "club atletico de madrid": "Ath Madrid",
    "athletic club": "Ath Bilbao",
    "athletic bilbao": "Ath Bilbao",
    "real betis": "Betis",
    "celta vigo": "Celta",
    "rc celta": "Celta",
    "deportivo alaves": "Alaves",
    "deportivo de a coruna": "La Coruna",
    "deportivo la coruna": "La Coruna",
    "rayo vallecano": "Vallecano",
    "rcd espanyol": "Espanol",
    "espanyol": "Espanol",
    "rcd mallorca": "Mallorca",
    "real sociedad": "Sociedad",
    "real sociedad b": "Sociedad B",
    "real valladolid": "Valladolid",
    "real oviedo": "Oviedo",
    "real zaragoza": "Zaragoza",
    "real sporting": "Sp Gijon",
    "sporting gijon": "Sp Gijon",
    "racing de santander": "Santander",
    "racing santander": "Santander",
    "real racing club": "Santander",
    "celta fortuna": "Celta B",
    "racing de ferrol": "Ferrol",
    "sd huesca": "Huesca",
    "sd eibar": "Eibar",
    "ud las palmas": "Las Palmas",
    "ud almeria": "Almeria",
    "cd tenerife": "Tenerife",
    "cd leganes": "Leganes",
    "cd mirandes": "Mirandes",
    "cd castellon": "Castellon",
    "cd eldense": "Eldense",
    "cd alaves": "Alaves",
    "ce sabadell": "Sabadell",
    "ca osasuna": "Osasuna",
    "cf burgos": "Burgos",
    "burgos cf": "Burgos",
    "cordoba cf": "Cordoba",
    "elche cf": "Elche",
    "levante ud": "Levante",
    "malaga cf": "Malaga",
    "granada cf": "Granada",
    "cadiz cf": "Cadiz",
    "fc cartagena": "Cartagena",
    "albacete balompie": "Albacete",
    "fc andorra": "Andorra",
    "sd amorebieta": "Amorebieta",
    # Germany
    "fc bayern munchen": "Bayern Munich",
    "bayern munchen": "Bayern Munich",
    "borussia dortmund": "Dortmund",
    "borussia m gladbach": "M'gladbach",
    "borussia monchengladbach": "M'gladbach",
    "bayer 04 leverkusen": "Leverkusen",
    "bayer leverkusen": "Leverkusen",
    "eintracht frankfurt": "Ein Frankfurt",
    "tsg hoffenheim": "Hoffenheim",
    "tsg 1899 hoffenheim": "Hoffenheim",
    "1 fc union berlin": "Union Berlin",
    "1 fc koln": "FC Koln",
    "1 fsv mainz 05": "Mainz",
    "fsv mainz 05": "Mainz",
    "fc augsburg": "Augsburg",
    "sc freiburg": "Freiburg",
    "vfb stuttgart": "Stuttgart",
    "vfl wolfsburg": "Wolfsburg",
    "sv werder bremen": "Werder Bremen",
    "1 fc heidenheim": "Heidenheim",
    "1 fc heidenheim 1846": "Heidenheim",
    "fc st pauli": "St Pauli",
    "vfl bochum 1848": "Bochum",
    "vfl bochum": "Bochum",
    "fc schalke 04": "Schalke 04",
    "hertha bsc": "Hertha",
    "hamburger sv": "Hamburg",
    "hannover 96": "Hannover",
    "fortuna dusseldorf": "Fortuna Dusseldorf",
    "karlsruher sc": "Karlsruhe",
    "1 fc kaiserslautern": "Kaiserslautern",
    "1 fc nurnberg": "Nurnberg",
    "1 fc magdeburg": "Magdeburg",
    "sc paderborn 07": "Paderborn",
    "spvgg greuther furth": "Greuther Furth",
    "sv darmstadt 98": "Darmstadt",
    "sv 07 elversberg": "Elversberg",
    "ssv jahn regensburg": "Regensburg",
    "ssv ulm 1846": "Ulm",
    "preussen munster": "Preussen Munster",
    "eintracht braunschweig": "Braunschweig",
    "holstein kiel": "Holstein Kiel",
    "arminia bielefeld": "Bielefeld",
    "dynamo dresden": "Dresden",
    "energie cottbus": "Cottbus",
    "hansa rostock": "Hansa Rostock",
    # Italy
    "ac milan": "Milan",
    "fc internazionale": "Inter",
    "inter milan": "Inter",
    "as roma": "Roma",
    "ssc napoli": "Napoli",
    "ss lazio": "Lazio",
    "hellas verona": "Verona",
    "acf fiorentina": "Fiorentina",
    "atalanta bc": "Atalanta",
    "bologna fc": "Bologna",
    "torino fc": "Torino",
    "genoa cfc": "Genoa",
    "cagliari calcio": "Cagliari",
    "udinese calcio": "Udinese",
    "us lecce": "Lecce",
    "empoli fc": "Empoli",
    "parma calcio 1913": "Parma",
    "como 1907": "Como",
    "venezia fc": "Venezia",
    "ac monza": "Monza",
    "l r vicenza": "Vicenza",
    "lr vicenza": "Vicenza",
    "fc sudtirol": "Sudtirol",
    "virtus entella": "Entella",
    "juve stabia": "Juve Stabia",
    "us cremonese": "Cremonese",
    "us catanzaro": "Catanzaro",
    "us sassuolo": "Sassuolo",
    "us salernitana": "Salernitana",
    "ssc bari": "Bari",
    "palermo fc": "Palermo",
    "pisa sc": "Pisa",
    "spezia calcio": "Spezia",
    "frosinone calcio": "Frosinone",
    "brescia calcio": "Brescia",
    "cesena fc": "Cesena",
    "modena fc": "Modena",
    "mantova 1911": "Mantova",
    "ac reggiana": "Reggiana",
    "cosenza calcio": "Cosenza",
    "as cittadella": "Cittadella",
    "carrarese calcio": "Carrarese",
    # France
    "paris saint germain": "Paris SG",
    "olympique lyonnais": "Lyon",
    "olympique de marseille": "Marseille",
    "as monaco": "Monaco",
    "losc lille": "Lille",
    "rc lens": "Lens",
    "rc strasbourg": "Strasbourg",
    "rc strasbourg alsace": "Strasbourg",
    "ogc nice": "Nice",
    "aj auxerre": "Auxerre",
    "stade brestois": "Brest",
    "stade brestois 29": "Brest",
    "stade rennais": "Rennes",
    "stade de reims": "Reims",
    "stade lavallois": "Laval",
    "stade malherbe caen": "Caen",
    "sm caen": "Caen",
    "as saint etienne": "St Etienne",
    "saint etienne": "St Etienne",
    "fc nantes": "Nantes",
    "toulouse fc": "Toulouse",
    "montpellier hsc": "Montpellier",
    "angers sco": "Angers",
    "le havre ac": "Le Havre",
    "fc lorient": "Lorient",
    "fc metz": "Metz",
    "paris fc": "Paris FC",
    "clermont foot": "Clermont",
    "grenoble foot 38": "Grenoble",
    "es troyes ac": "Troyes",
    "estac troyes": "Troyes",
    "sc bastia": "Bastia",
    "ac ajaccio": "Ajaccio",
    "amiens sc": "Amiens",
    "ea guingamp": "Guingamp",
    "pau fc": "Pau FC",
    "rodez af": "Rodez",
    "fc annecy": "Annecy",
    "usl dunkerque": "Dunkerque",
    "red star fc": "Red Star",
    "fc martigues": "Martigues",
    "us boulogne cote d opale": "Boulogne",
    "boulogne sur mer": "Boulogne",
    # Netherlands
    "psv eindhoven": "PSV Eindhoven",
    "afc ajax": "Ajax",
    "feyenoord rotterdam": "Feyenoord",
    "az alkmaar": "AZ Alkmaar",
    "fc twente": "Twente",
    "fc utrecht": "Utrecht",
    "fc groningen": "Groningen",
    "sc heerenveen": "Heerenveen",
    "nec nijmegen": "Nijmegen",
    "pec zwolle": "Zwolle",
    "sc cambuur": "Cambuur",
    "sc telstar": "Telstar",
    "sparta rotterdam": "Sparta Rotterdam",
    "go ahead eagles": "Go Ahead Eagles",
    "fortuna sittard": "For Sittard",
    "heracles almelo": "Heracles",
    "nac breda": "NAC Breda",
    "rkc waalwijk": "Waalwijk",
    "willem ii": "Willem II",
    "almere city fc": "Almere City",
    "excelsior rotterdam": "Excelsior",
    "fc volendam": "Volendam",
    "fc emmen": "FC Emmen",
    "ado den haag": "Den Haag",
    # Portugal
    "sporting cp": "Sp Lisbon",
    "sporting lisbon": "Sp Lisbon",
    "sl benfica": "Benfica",
    "fc porto": "Porto",
    "sc braga": "Sp Braga",
    "sporting braga": "Sp Braga",
    "academico viseu fc": "Academico Viseu",
    "academico viseu": "Academico Viseu",
    "vitoria sc": "Guimaraes",
    "vitoria de guimaraes": "Guimaraes",
    "fc famalicao": "Famalicao",
    "rio ave fc": "Rio Ave",
    "gil vicente fc": "Gil Vicente",
    "moreirense fc": "Moreirense",
    "casa pia ac": "Casa Pia",
    "estoril praia": "Estoril",
    "boavista fc": "Boavista",
    "fc arouca": "Arouca",
    "cd santa clara": "Santa Clara",
    "cd nacional": "Nacional",
    "sc farense": "Farense",
    "cf estrela da amadora": "Estrela",
    "estrela amadora": "Estrela",
    "avs futebol sad": "AVS",
    "cd tondela": "Tondela",
    "fc alverca": "Alverca",
    # Belgium
    "club brugge kv": "Club Brugge",
    "cercle brugge ksv": "Cercle Brugge",
    "krc genk": "Genk",
    "kaa gent": "Gent",
    "rsc anderlecht": "Anderlecht",
    "royal antwerp fc": "Antwerp",
    "royale union saint gilloise": "St. Gilloise",
    "union saint gilloise": "St. Gilloise",
    "standard liege": "Standard",
    "standard de liege": "Standard",
    "rc sporting charleroi": "Charleroi",
    "sporting charleroi": "Charleroi",
    "sint truidense vv": "St Truiden",
    "kv mechelen": "Mechelen",
    "kvc westerlo": "Westerlo",
    "oud heverlee leuven": "Oud-Heverlee Leuven",
    "oh leuven": "Oud-Heverlee Leuven",
    "kv kortrijk": "Kortrijk",
    "fcv dender eh": "Dender",
    "k beerschot va": "Beerschot VA",
    "sv zulte waregem": "Waregem",
    "raal la louviere": "RAAL La Louviere",
    "sk beveren": "Beveren",
    "lommel sk": "Lommel SK",
    # Turkey
    "galatasaray sk": "Galatasaray",
    "fenerbahce sk": "Fenerbahce",
    "besiktas jk": "Besiktas",
    "trabzonspor": "Trabzonspor",
    "istanbul basaksehir": "Buyuksehyr",
    "basaksehir fk": "Buyuksehyr",
    "caykur rizespor": "Rizespor",
    "gaziantep fk": "Gaziantep",
    "genclerbirligi": "Genclerbirligi",
    "kasimpasa": "Kasimpasa",
    "erzurumspor fk": "Erzurumspor",
    "corum fk": "Corum",
    "konyaspor": "Konyaspor",
    "alanyaspor": "Alanyaspor",
    "antalyaspor": "Antalyaspor",
    "kayserispor": "Kayserispor",
    "sivasspor": "Sivasspor",
    "samsunspor": "Samsunspor",
    "hatayspor": "Hatayspor",
    "adana demirspor": "Ad. Demirspor",
    "eyupspor": "Eyupspor",
    "goztepe": "Goztep",
    "bodrum fk": "Bodrumspor",
    "bodrumspor": "Bodrumspor",
    "fatih karagumruk": "Karagumruk",
    "kocaelispor": "Kocaelispor",
    "amedspor": "Amedspor",
    # Greece
    "aek athens": "AEK",
    "olympiacos fc": "Olympiakos",
    "olympiacos": "Olympiakos",
    "panathinaikos": "Panathinaikos",
    "paok": "PAOK",
    "paok thessaloniki": "PAOK",
    "aris thessaloniki": "Aris",
    "asteras tripolis": "Asteras Tripolis",
    "asteras aktor": "Asteras Tripolis",
    "atromitos athens": "Atromitos",
    "ofi crete": "OFI Crete",
    "volos nps": "Volos NFC",
    "nps volos": "Volos NFC",
    "pot iraklis": "Iraklis",
    "panetolikos": "Panetolikos",
    "panserraikos": "Panserraikos",
    "pas lamia": "Lamia",
    "lamia": "Lamia",
    "levadiakos": "Levadeiakos",
    "athens kallithea": "Kallithea",
    "ae larissa": "Larisa",
    "ps kalamata": "Kalamata",
}

FINISHED_STATUSES = {
    "finished",
    "ft",
    "aet",
    "pen",
    "after_penalties",
    "ended",
    "complete",
    "completed",
}

UPCOMING_STATUSES = {
    "notstarted",
    "not started",
    "scheduled",
    "ns",
    "upcoming",
    "tbd",
}


def norm(text: str | None) -> str:
    if not text:
        return ""
    s = str(text).replace("ı", "i").replace("İ", "I")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def strip_club_noise(text: str) -> str:
    n = norm(text)
    n = re.sub(
        r"\b(fc|afc|sc|sv|cd|ce|cf|ca|ud|sd|rc|rcd|as|ac|us|ss|ssc|ogc|aj|losc|vfl|vfb|tsg|fsv|krc|kv|kvc|kaa|rsc|sk|jk|fk|cf|sl|sm|ea|es|usl|spvgg|ssv|1|04|05|07|1846|1848|1899|1907|1911|1913|29|38|96|98)\b",
        " ",
        n,
    )
    return re.sub(r"\s+", " ", n).strip()


def base_league(name: str) -> str:
    return re.sub(r"\s+\d{2}/\d{2}$", "", name).strip()


def fetch_json(url: str, api_key: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Token {api_key}",
            "Accept": "application/json",
            "User-Agent": "FootyStats-Analyser/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_paginated(
    endpoints: list[str],
    api_key: str,
    params: dict[str, str] | None = None,
    list_keys: tuple[str, ...] = ("results", "data", "events", "leagues"),
) -> tuple[str, list[dict[str, Any]]]:
    errors: list[str] = []
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    for base_ep in endpoints:
        start_url = f"{base_ep}{qs}"
        try:
            url: str | None = start_url
            items: list[dict[str, Any]] = []
            seen_urls: set[str] = set()
            while url and url not in seen_urls:
                seen_urls.add(url)
                data = fetch_json(url, api_key)
                if isinstance(data, list):
                    items.extend(data)
                    url = None
                elif isinstance(data, dict):
                    batch = None
                    for key in list_keys:
                        if isinstance(data.get(key), list):
                            batch = data[key]
                            break
                    if batch:
                        items.extend(batch)
                    next_url = data.get("next")
                    if next_url and isinstance(next_url, str):
                        url = next_url if next_url.startswith("http") else f"{BASE_URL}{next_url}"
                    else:
                        url = None
                else:
                    url = None
            return start_url, items
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                pass
            errors.append(f"{start_url} -> HTTP {e.code}: {body}")
        except Exception as e:
            errors.append(f"{start_url} -> {type(e).__name__}: {e}")

    raise RuntimeError("Failed to fetch from BSD API:\n" + "\n".join(errors))


def extract_country(league: dict[str, Any]) -> str:
    c = league.get("country")
    if isinstance(c, dict):
        return str(c.get("name") or c.get("code") or "")
    return str(c or league.get("country_name") or "")


def extract_league_id(event: dict[str, Any]) -> int | None:
    lg = event.get("league")
    raw = lg.get("id") if isinstance(lg, dict) else (lg if isinstance(lg, int) else event.get("league_id"))
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def extract_team_name(event: dict[str, Any], side: str) -> str:
    val = event.get(f"{side}_team")
    if isinstance(val, dict):
        return str(val.get("name") or val.get("short_name") or "?")
    if val:
        return str(val)
    obj = event.get(f"{side}_team_obj")
    if isinstance(obj, dict):
        return str(obj.get("name") or obj.get("short_name") or "?")
    return "?"


def extract_team_short_name(event: dict[str, Any], side: str) -> str:
    obj = event.get(f"{side}_team_obj")
    if isinstance(obj, dict) and obj.get("short_name"):
        return str(obj["short_name"]).strip()
    return ""


def extract_score(event: dict[str, Any]) -> tuple[Any, Any, Any, Any]:
    h = event.get("home_score")
    a = event.get("away_score")
    ht_h = event.get("home_score_ht")
    ht_a = event.get("away_score_ht")

    if ht_h is None:
        ht_h = event.get("home_ht_score", event.get("ht_home_score"))
    if ht_a is None:
        ht_a = event.get("away_score_ht", event.get("away_ht_score", event.get("ht_away_score")))

    score_obj = event.get("score")
    if isinstance(score_obj, dict):
        if h is None:
            h = score_obj.get("home")
        if a is None:
            a = score_obj.get("away")
        if ht_h is None and isinstance(score_obj.get("halftime"), dict):
            ht_h = score_obj["halftime"].get("home")
            ht_a = score_obj["halftime"].get("away")
    return h, a, ht_h, ht_a


def extract_corners(event: dict[str, Any]) -> tuple[Any, Any]:
    hc = event.get("home_corners")
    ac = event.get("away_corners")
    if hc is not None and ac is not None:
        return hc, ac
    stats = event.get("live_stats") or event.get("statistics") or event.get("stats")
    if isinstance(stats, dict):
        home_s = stats.get("home") if isinstance(stats.get("home"), dict) else {}
        away_s = stats.get("away") if isinstance(stats.get("away"), dict) else {}
        hc = home_s.get("corner_kicks", home_s.get("corners"))
        ac = away_s.get("corner_kicks", away_s.get("corners"))
        if hc is not None and ac is not None:
            return hc, ac
    return None, None


def extract_kickoff_hm(event: dict[str, Any]) -> str:
    raw = str(event.get("event_date") or event.get("date") or event.get("start_time") or "")
    m = re.search(r"T(\d{2}:\d{2})", raw)
    return m.group(1) if m else ""


def parse_iso_to_ddmmyyyy_and_hm(iso_str: str) -> tuple[str, str, str]:
    """Return (DD/MM/YYYY, HH:MM, YYYY-MM-DD) from an ISO timestamp."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?", str(iso_str or "").strip())
    if not m:
        return "", "TBD", ""
    yyyy, mm, dd, hm = m.groups()
    return f"{dd}/{mm}/{yyyy}", hm or "TBD", f"{yyyy}-{mm}-{dd}"


def is_finished(event: dict[str, Any]) -> bool:
    status = norm(str(event.get("status") or ""))
    h, a, _, _ = extract_score(event)
    if h is None or a is None:
        return False
    return status in FINISHED_STATUSES or "finished" in status


def is_upcoming(event: dict[str, Any]) -> bool:
    status = norm(str(event.get("status") or ""))
    if status in UPCOMING_STATUSES:
        return True
    if "postpone" in status or "cancel" in status or "abandon" in status:
        return False
    if status in FINISHED_STATUSES or "finished" in status:
        return False
    h, a, _, _ = extract_score(event)
    return h is None and a is None


def format_status(event: dict[str, Any]) -> str:
    raw_status = str(event.get("status") or "").strip()
    low = norm(raw_status)
    if low in FINISHED_STATUSES or "finished" in low:
        return "FT"
    if low in UPCOMING_STATUSES:
        hm = extract_kickoff_hm(event)
        return hm or "SCHED"
    minute = event.get("current_minute") or event.get("minute")
    if minute:
        return f"{minute}'"
    return raw_status.upper()[:8] or "—"


def safe_float_opt(val: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        f = float(val)
        return round(f, 2) if f > 0 else None
    except (TypeError, ValueError):
        return None


def safe_int_zero(val: Any) -> int:
    if val is None or val == "":
        return 0
    try:
        return int(round(float(val)))
    except (TypeError, ValueError):
        return 0


def load_local_logos(base_dir: Path) -> dict[str, str]:
    logos_path = base_dir / "logos.js"
    if not logos_path.exists():
        return {}
    text = logos_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"var\s+TEAM_LOGOS\s*=\s*(\{.*?\});", text, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except Exception:
        return {}


class CanonicalTeamResolver:
    """Resolve BSD API club names to FootyStats canonical historical names."""

    def __init__(
        self,
        country_pools: dict[str, set[str]],
        global_pool: set[str],
    ) -> None:
        self.country_pools = country_pools
        self.global_pool = global_pool

        self._country_exact: dict[str, dict[str, str]] = {}
        self._country_stripped: dict[str, dict[str, list[str]]] = {}
        for country, names in country_pools.items():
            exact_map: dict[str, str] = {}
            stripped_map: dict[str, list[str]] = {}
            for name in sorted(names):
                exact_map[norm(name)] = name
                st = strip_club_noise(name)
                if st:
                    stripped_map.setdefault(st, []).append(name)
            self._country_exact[country] = exact_map
            self._country_stripped[country] = stripped_map

        self._global_exact: dict[str, str] = {norm(n): n for n in sorted(global_pool)}
        self.unmatched: dict[tuple[str, str], str] = {}

    def resolve(self, raw_name: str, base_lg: str, short_name: str = "") -> str:
        name = str(raw_name or "").strip()
        if not name:
            return ""
        country = BASE_LEAGUE_TO_COUNTRY.get(base_lg, "")
        c_exact = self._country_exact.get(country, {})
        c_stripped = self._country_stripped.get(country, {})

        # 1. Exact match in country pool
        n = norm(name)
        if n in c_exact:
            return c_exact[n]

        # 2. Explicit BSD alias map
        alias = BSD_TEAM_ALIASES.get(n)
        if alias:
            return alias

        # 3. Short name exact match or alias
        if short_name:
            sn = norm(short_name)
            if sn in c_exact:
                return c_exact[sn]
            s_alias = BSD_TEAM_ALIASES.get(sn)
            if s_alias:
                return s_alias

        # 4. Global exact match (e.g. from logos.js)
        if n in self._global_exact:
            return self._global_exact[n]

        # 5. Stripped noise match within the same country (only if unambiguous!)
        for candidate in (name, short_name):
            if not candidate:
                continue
            st = strip_club_noise(candidate)
            if st and st in c_stripped and len(c_stripped[st]) == 1:
                # Guard against matching a B-team to a first team
                cand_is_b = bool(re.search(r"(^| )b($| )", norm(candidate)))
                hit_is_b = bool(re.search(r"(^| )b($| )", norm(c_stripped[st][0])))
                if cand_is_b == hit_is_b:
                    return c_stripped[st][0]

        # 6. Fallback to clean BSD name and record for audit
        self.unmatched[(base_lg, name)] = short_name
        return name


def load_historical_csv_data(
    base_dir: Path,
) -> tuple[dict[str, list[list[Any]]], dict[str, set[str]], set[str]]:
    """Load 19/20-25/26 historical seasons from ./csv_cache/ (zero network calls if cached)."""
    cache_dir = base_dir / export_data.CACHE_DIR_NAME
    hist_by_league: dict[str, list[list[Any]]] = {}
    country_pools: dict[str, set[str]] = {}
    global_pool: set[str] = set()

    for url, league_name in export_data.LEAGUE_FILES.items():
        text = export_data.fetch_csv_text(url, cache_dir, refresh=False)
        if text is None:
            continue
        rows = export_data.parse_csv(text)
        matches: list[list[Any]] = []
        bl = base_league(league_name)
        country = BASE_LEAGUE_TO_COUNTRY.get(bl, "")
        for row in rows:
            m = export_data.match_to_compact(row)
            if not m[1] or not m[2] or not m[5]:
                continue
            matches.append(m)
            global_pool.add(m[1])
            global_pool.add(m[2])
            if country:
                country_pools.setdefault(country, set()).update((m[1], m[2]))
        hist_by_league[league_name] = matches

    # Also seed global pool from logos.js so newly promoted clubs align with existing badges
    for team_key in load_local_logos(base_dir).keys():
        global_pool.add(team_key)

    return hist_by_league, country_pools, global_pool


def extract_live_attack_stats(event: dict[str, Any]) -> dict[str, Any]:
    """Extract shots on target, big chances, and xGOT from BSD live_stats."""
    stats = event.get("live_stats") or event.get("statistics") or event.get("stats")
    if not isinstance(stats, dict):
        return {}
    home_s = stats.get("home") if isinstance(stats.get("home"), dict) else {}
    away_s = stats.get("away") if isinstance(stats.get("away"), dict) else {}
    out: dict[str, Any] = {}
    for side_prefix, bucket in (("h", home_s), ("a", away_s)):
        sot = bucket.get("shots_on_target")
        bc = bucket.get("big_chances")
        xgot = bucket.get("expected_goals_on_target")
        if sot is not None:
            try:
                out[f"{side_prefix}sot"] = int(sot)
            except (TypeError, ValueError):
                pass
        if bc is not None:
            try:
                out[f"{side_prefix}bc"] = int(bc)
            except (TypeError, ValueError):
                pass
        if xgot is not None:
            try:
                f = float(xgot)
                if f >= 0:
                    out[f"{side_prefix}xgot"] = round(f, 2)
            except (TypeError, ValueError):
                pass
    return out


def extract_injury_counts(event: dict[str, Any]) -> dict[str, int] | None:
    """Count injured/doubtful players per side from BSD unavailable_players."""
    unavail = event.get("unavailable_players")
    if not isinstance(unavail, dict):
        return None
    h_list = unavail.get("home") if isinstance(unavail.get("home"), list) else []
    a_list = unavail.get("away") if isinstance(unavail.get("away"), list) else []
    if not h_list and not a_list:
        return None
    return {"h": len(h_list), "a": len(a_list)}


def slim_bsd_event(ev: dict[str, Any]) -> dict[str, Any]:
    """Store only the essential fields needed for data.js & rich bsd2627 metadata in bsd_cache."""
    h, a, ht_h, ht_a = extract_score(ev)
    hc, ac = extract_corners(ev)
    atk = extract_live_attack_stats(ev)
    slim: dict[str, Any] = {
        "id": ev.get("id"),
        "league_id": extract_league_id(ev),
        "event_date": ev.get("event_date"),
        "round_number": ev.get("round_number"),
        "status": ev.get("status"),
        "home_team": extract_team_name(ev, "home"),
        "away_team": extract_team_name(ev, "away"),
        "home_short": extract_team_short_name(ev, "home"),
        "away_short": extract_team_short_name(ev, "away"),
        "home_score": h,
        "away_score": a,
        "home_score_ht": ht_h,
        "away_score_ht": ht_a,
        "home_corners": hc,
        "away_corners": ac,
        "actual_home_xg": ev.get("actual_home_xg"),
        "actual_away_xg": ev.get("actual_away_xg"),
        "odds_home": ev.get("odds_home"),
        "odds_draw": ev.get("odds_draw"),
        "odds_away": ev.get("odds_away"),
        "odds_btts_yes": ev.get("odds_btts_yes"),
        "odds_btts_no": ev.get("odds_btts_no"),
        "odds_over_25": ev.get("odds_over_25"),
        "odds_under_25": ev.get("odds_under_25"),
    }
    if ev.get("is_local_derby"):
        slim["derby"] = 1
    slim.update(atk)
    return slim


def sync_bsd_2627_results_cache(
    api_key: str,
    base_dir: Path,
    full_refresh: bool = False,
    lookback_days: int = 10,
) -> dict[str, dict[str, Any]]:
    """Fetch 26/27 finished matches from BSD API into ./bsd_cache/results_2627.json."""
    cache_dir = base_dir / BSD_CACHE_DIR
    cache_dir.mkdir(exist_ok=True)
    cache_path = cache_dir / BSD_RESULTS_CACHE_FILE

    cached_events: dict[str, dict[str, Any]] = {}
    if cache_path.exists() and not full_refresh:
        try:
            loaded = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("events"), dict):
                cached_events = loaded["events"]
        except Exception as exc:
            print(f"Warning: could not read {cache_path.name} ({exc}); doing full refresh.")

    today = dt.date.today()
    today_iso = today.isoformat()

    if not cached_events or full_refresh:
        print(f"Full BSD 26/27 sync ({SEASON_START_DATE} -> {today_iso}) across {len(AVAILABLE_LEAGUE_IDS)} leagues...")
        cached_events = {}
        for lg_id, lg_name in AVAILABLE_LEAGUE_IDS.items():
            _, evs = fetch_paginated(
                EVENT_ENDPOINTS,
                api_key,
                params={
                    "league": str(lg_id),
                    "date_from": SEASON_START_DATE,
                    "date_to": today_iso,
                },
            )
            fin_count = 0
            for ev in evs:
                if not is_finished(ev):
                    continue
                ev_id = ev.get("id")
                if ev_id is None:
                    continue
                cached_events[str(ev_id)] = slim_bsd_event(ev)
                fin_count += 1
            print(f"  [{lg_id:>3}] {lg_name:<25} -> {fin_count} finished matches")
    else:
        start_iso = (today - dt.timedelta(days=lookback_days)).isoformat()
        print(f"Incremental BSD 26/27 sync ({start_iso} -> {today_iso})...")
        _, evs = fetch_paginated(
            EVENT_ENDPOINTS,
            api_key,
            params={"date_from": start_iso, "date_to": today_iso},
        )
        added_or_updated = 0
        for ev in evs:
            lg_id = extract_league_id(ev)
            if lg_id not in AVAILABLE_LEAGUE_IDS:
                continue
            if not is_finished(ev):
                continue
            ev_id = ev.get("id")
            if ev_id is None:
                continue
            cached_events[str(ev_id)] = slim_bsd_event(ev)
            added_or_updated += 1
        print(f"  Upserted {added_or_updated} recent finished match(es); total cached: {len(cached_events)}")

    cache_payload = {
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "season": SEASON_LABEL,
        "count": len(cached_events),
        "events": cached_events,
    }
    cache_path.write_text(
        json.dumps(cache_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return cached_events


def run_export_results(
    api_key: str,
    base_dir: Path,
    full_refresh: bool = False,
) -> int:
    print("Loading historical 19/20-25/26 seasons from ./csv_cache/...")
    hist_by_league, country_pools, global_pool = load_historical_csv_data(base_dir)
    resolver = CanonicalTeamResolver(country_pools, global_pool)

    bsd_events = sync_bsd_2627_results_cache(api_key, base_dir, full_refresh=full_refresh)

    # Group 26/27 BSD events by base league
    bsd_by_league: dict[str, list[dict[str, Any]]] = {lg: [] for lg in LEAGUE_ORDER}
    for ev in bsd_events.values():
        lg_id = ev.get("league_id")
        if lg_id in AVAILABLE_LEAGUE_IDS:
            bsd_by_league[AVAILABLE_LEAGUE_IDS[lg_id]].append(ev)

    leagues_order: list[str] = []
    seen_leagues: dict[str, int] = {}
    all_matches: list[list[Any]] = []
    bsd2627_meta: dict[str, dict[str, Any]] = {}

    def ensure_league_idx(lg_name: str) -> int:
        if lg_name not in seen_leagues:
            seen_leagues[lg_name] = len(leagues_order)
            leagues_order.append(lg_name)
        return seen_leagues[lg_name]

    # Build league order matching export_data.py: 26/27 first (for 19 BSD leagues), then historical seasons
    base_order_all: list[str] = []
    hist_seasons_by_base: dict[str, list[str]] = {}
    for _, lg_full in export_data.LEAGUE_FILES.items():
        bl = base_league(lg_full)
        if bl not in base_order_all:
            base_order_all.append(bl)
        if not lg_full.endswith(SEASON_LABEL):
            hist_seasons_by_base.setdefault(bl, []).append(lg_full)

    bsd_match_total = 0
    for bl in base_order_all:
        # 1) 26/27 from BSD API (excludes Scottish League One per user choice)
        if bl in bsd_by_league:
            lg_2627 = f"{bl} {SEASON_LABEL}"
            lg_idx = ensure_league_idx(lg_2627)
            evs_sorted = sorted(
                bsd_by_league[bl],
                key=lambda e: (str(e.get("event_date") or ""), int(e.get("id") or 0)),
            )
            for ev in evs_sorted:
                date_ddmmyyyy, _, _ = parse_iso_to_ddmmyyyy_and_hm(ev.get("event_date") or "")
                if not date_ddmmyyyy:
                    continue
                home = resolver.resolve(ev.get("home_team") or "", bl, ev.get("home_short") or "")
                away = resolver.resolve(ev.get("away_team") or "", bl, ev.get("away_short") or "")
                if not home or not away:
                    continue
                fthg = safe_int_zero(ev.get("home_score"))
                ftag = safe_int_zero(ev.get("away_score"))
                ftr = "H" if fthg > ftag else ("A" if ftag > fthg else "D")
                hthg = safe_int_zero(ev.get("home_score_ht"))
                htag = safe_int_zero(ev.get("away_score_ht"))
                hc = safe_int_zero(ev.get("home_corners"))
                ac = safe_int_zero(ev.get("away_corners"))
                tc = hc + ac
                w2h = 1 if (ftr == "H" and fthg >= 2) else 0
                w2a = 1 if (ftr == "A" and ftag >= 2) else 0
                c10 = 1 if tc >= 10 else 0

                all_matches.append(
                    [date_ddmmyyyy, home, away, fthg, ftag, ftr, hthg, htag, hc, ac, tc, w2h, w2a, c10, lg_idx]
                )
                bsd_match_total += 1

                # Store rich 26/27 BSD fields under the hood for the xG/chance model & future UI upgrades
                meta_entry: dict[str, Any] = {"id": ev.get("id")}
                if ev.get("actual_home_xg") is not None:
                    meta_entry["hxg"] = round(float(ev["actual_home_xg"]), 2)
                if ev.get("actual_away_xg") is not None:
                    meta_entry["axg"] = round(float(ev["actual_away_xg"]), 2)
                for k_extra in ("hsot", "asot", "hbc", "abc", "hxgot", "axgot", "derby"):
                    if ev.get(k_extra) is not None:
                        meta_entry[k_extra] = ev[k_extra]
                for src_k, dst_k in (
                    ("odds_home", "oh"),
                    ("odds_draw", "od"),
                    ("odds_away", "oa"),
                    ("odds_btts_yes", "by"),
                    ("odds_btts_no", "bn"),
                    ("odds_over_25", "o25"),
                    ("odds_under_25", "u25"),
                ):
                    v = safe_float_opt(ev.get(src_k))
                    if v is not None:
                        meta_entry[dst_k] = v
                bsd2627_meta[f"{lg_2627}|{date_ddmmyyyy}|{home}|{away}"] = meta_entry

        # 2) Historical seasons (25/26..19/20) from ./csv_cache/
        for hist_lg in hist_seasons_by_base.get(bl, []):
            hist_matches = hist_by_league.get(hist_lg)
            if not hist_matches:
                continue
            lg_idx = ensure_league_idx(hist_lg)
            for m in hist_matches:
                row_copy = list(m)
                row_copy.append(lg_idx)
                all_matches.append(row_copy)

    # Dictionary-encode team names
    all_teams = sorted({m[1] for m in all_matches} | {m[2] for m in all_matches})
    team_to_idx = {name: idx for idx, name in enumerate(all_teams)}
    for m in all_matches:
        m[1] = team_to_idx[m[1]]
        m[2] = team_to_idx[m[2]]

    payload = {
        "source2627": "bsd",
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "l": leagues_order,
        "t": all_teams,
        "m": all_matches,
        "bsd2627": bsd2627_meta,
    }

    out_path = base_dir / "data.js"
    json_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(f"var FOOTYDATA = {json_str};\n", encoding="utf-8")

    sz = out_path.stat().st_size / 1024
    print(
        f"\nExported data.js: {len(all_matches):,} total matches ({bsd_match_total:,} from BSD 26/27) | "
        f"{len(leagues_order)} leagues | {len(all_teams)} teams | {sz:.0f} KB -> {out_path.name}"
    )

    if resolver.unmatched:
        print(f"\nNew / unmapped BSD team names ({len(resolver.unmatched)}):")
        for (bl, raw_t), short_t in sorted(resolver.unmatched.items()):
            extra = f" (short: {short_t})" if short_t and short_t != raw_t else ""
            print(f"  [{bl}] {raw_t}{extra}")
    return 0


def fetch_upcoming_predictions_map(api_key: str) -> dict[int, dict[str, Any]]:
    """Fetch all upcoming BSD ML predictions keyed by BSD event ID.

    Note: /api/predictions/ returns next=null even when count > page size, so we
    explicitly step through offset/limit pages until all predictions are fetched.
    """
    preds: list[dict[str, Any]] = []
    limit = 200
    offset = 0
    total_count: int | None = None
    try:
        while True:
            qs = urllib.parse.urlencode(
                {"upcoming": "true", "limit": str(limit), "offset": str(offset)}
            )
            data = fetch_json(f"{PREDICTION_ENDPOINTS[0]}?{qs}", api_key)
            if isinstance(data, list):
                preds.extend(data)
                break
            if not isinstance(data, dict):
                break
            batch = data.get("results") or []
            if not isinstance(batch, list) or not batch:
                break
            preds.extend(batch)
            if total_count is None and isinstance(data.get("count"), int):
                total_count = data["count"]
            offset += len(batch)
            if total_count is not None and offset >= total_count:
                break
            if len(batch) < limit:
                break
    except Exception as exc:
        print(f"Warning: could not fetch BSD predictions ({exc}); continuing with {len(preds)} loaded.")

    by_event: dict[int, dict[str, Any]] = {}
    for p in preds:
        ev = p.get("event")
        ev_id = ev.get("id") if isinstance(ev, dict) else p.get("event_id")
        if ev_id is None:
            continue
        try:
            eid = int(ev_id)
        except (TypeError, ValueError):
            continue

        recs: list[str] = []
        if p.get("winner_recommend"):
            recs.append("winner")
        elif p.get("favorite_recommend"):
            recs.append("favorite")
        if p.get("over_25_recommend"):
            recs.append("over_25")
        if p.get("btts_recommend"):
            recs.append("btts")

        entry: dict[str, Any] = {}
        if p.get("predicted_result"):
            entry["res"] = str(p["predicted_result"]).upper()
        for src_k, dst_k in (
            ("prob_home_win", "ph"),
            ("prob_draw", "pd"),
            ("prob_away_win", "pa"),
            ("expected_home_goals", "xhg"),
            ("expected_away_goals", "xag"),
            ("prob_over_25", "o25"),
            ("prob_btts_yes", "btts"),
        ):
            v = safe_float_opt(p.get(src_k))
            if v is not None:
                entry[dst_k] = v
        if p.get("most_likely_score"):
            entry["score"] = str(p["most_likely_score"]).strip()
        if p.get("confidence") is not None:
            try:
                entry["conf"] = round(float(p["confidence"]), 2)
            except (TypeError, ValueError):
                pass
        if recs:
            entry["rec"] = recs
        if entry:
            by_event[eid] = entry
    return by_event


def run_export_fixtures(
    api_key: str,
    base_dir: Path,
    days: int = 14,
) -> int:
    _, country_pools, global_pool = load_historical_csv_data(base_dir)
    resolver = CanonicalTeamResolver(country_pools, global_pool)

    today = dt.date.today()
    date_from = today.isoformat()
    date_to = (today + dt.timedelta(days=days)).isoformat()
    print(f"Fetching upcoming BSD fixtures ({date_from} -> {date_to}) across {len(AVAILABLE_LEAGUE_IDS)} leagues...")

    _, all_events = fetch_paginated(
        EVENT_ENDPOINTS,
        api_key,
        params={"date_from": date_from, "date_to": date_to},
    )
    preds_map = fetch_upcoming_predictions_map(api_key)
    print(f"Loaded {len(preds_map)} upcoming BSD ML predictions.")

    fixtures: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    n_ff = 0
    n_ai_prev = 0
    n_ai_pred = 0

    for ev in all_events:
        lg_id = extract_league_id(ev)
        if lg_id not in AVAILABLE_LEAGUE_IDS:
            continue
        if not is_upcoming(ev):
            continue
        ev_id = ev.get("id")
        if ev_id is not None:
            if int(ev_id) in seen_ids:
                continue
            seen_ids.add(int(ev_id))

        league_name = AVAILABLE_LEAGUE_IDS[lg_id]
        div = LEAGUE_ID_TO_DIV[lg_id]
        date_ddmmyyyy, time_hm, sort_date = parse_iso_to_ddmmyyyy_and_hm(ev.get("event_date") or "")
        if not date_ddmmyyyy:
            continue

        home = resolver.resolve(extract_team_name(ev, "home"), league_name, extract_team_short_name(ev, "home"))
        away = resolver.resolve(extract_team_name(ev, "away"), league_name, extract_team_short_name(ev, "away"))
        if not home or not away:
            continue

        oh = safe_float_opt(ev.get("odds_home"))
        od = safe_float_opt(ev.get("odds_draw"))
        oa = safe_float_opt(ev.get("odds_away"))
        odds = {"h": oh, "d": od, "a": oa} if (oh or od or oa) else None

        by = safe_float_opt(ev.get("odds_btts_yes"))
        bn = safe_float_opt(ev.get("odds_btts_no"))
        btts = {"yes": by, "no": bn} if (by or bn) else None

        ou_vals = {
            "o15": safe_float_opt(ev.get("odds_over_15")),
            "u15": safe_float_opt(ev.get("odds_under_15")),
            "o25": safe_float_opt(ev.get("odds_over_25")),
            "u25": safe_float_opt(ev.get("odds_under_25")),
            "o35": safe_float_opt(ev.get("odds_over_35")),
            "u35": safe_float_opt(ev.get("odds_under_35")),
        }
        ou = {k: v for k, v in ou_vals.items() if v is not None} or None

        venue_obj = ev.get("venue")
        venue_name = venue_obj.get("name") if isinstance(venue_obj, dict) else None

        raw_ff = ev.get("funfacts")
        funfacts = [
            str(item.get("sentence")).strip()
            for item in (raw_ff if isinstance(raw_ff, list) else [])
            if isinstance(item, dict) and item.get("sentence")
        ]

        ai_preview_obj = ev.get("ai_preview")
        ai_preview_text = (
            str(ai_preview_obj.get("text")).strip()
            if isinstance(ai_preview_obj, dict) and ai_preview_obj.get("text")
            else None
        )

        ai_pred = preds_map.get(int(ev_id)) if ev_id is not None else None
        inj_counts = extract_injury_counts(ev)
        is_derby = bool(ev.get("is_local_derby"))

        fx_obj: dict[str, Any] = {
            "div": div,
            "league": league_name,
            "date": date_ddmmyyyy,
            "time": time_hm,
            "home": home,
            "away": away,
            "odds": odds,
            "event_id": ev_id,
            "round": ev.get("round_number"),
            "_sort": sort_date,
        }
        if btts:
            fx_obj["btts"] = btts
        if ou:
            fx_obj["ou"] = ou
        if venue_name:
            fx_obj["venue"] = venue_name
        if is_derby:
            fx_obj["derby"] = True
        if inj_counts:
            fx_obj["inj"] = inj_counts
        if funfacts:
            fx_obj["funfacts"] = funfacts
            n_ff += 1
        if ai_preview_text:
            fx_obj["ai_preview"] = ai_preview_text
            n_ai_prev += 1
        if ai_pred:
            fx_obj["ai_pred"] = ai_pred
            n_ai_pred += 1
        fixtures.append(fx_obj)

    fixtures.sort(key=lambda f: (f["league"], f["_sort"], f["time"], f["home"]))
    for f in fixtures:
        f.pop("_sort", None)

    leagues_with_fixtures = sorted({f["league"] for f in fixtures})
    payload = {
        "source": "bsd",
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "leagues": leagues_with_fixtures,
        "fixtures": fixtures,
    }

    out_path = base_dir / "fixtures.js"
    json_str = json.dumps(payload, ensure_ascii=False, indent=2)
    out_path.write_text(f"var FOOTYFIXTURES = {json_str};\n", encoding="utf-8")

    print(
        f"Exported fixtures.js: {len(fixtures)} upcoming fixtures across "
        f"{len(leagues_with_fixtures)} leagues "
        f"(ai_pred: {n_ai_pred}, ai_preview: {n_ai_prev}, funfacts: {n_ff}) -> {out_path.name}"
    )
    if resolver.unmatched:
        print(f"New / unmapped BSD fixture team names ({len(resolver.unmatched)}):")
        for (bl, raw_t), short_t in sorted(resolver.unmatched.items()):
            extra = f" (short: {short_t})" if short_t and short_t != raw_t else ""
            print(f"  [{bl}] {raw_t}{extra}")
    return 0


def match_league(target: dict[str, Any], api_leagues: list[dict[str, Any]]) -> dict[str, Any] | None:
    target_countries = {norm(c) for c in target["countries"]}
    target_aliases = [norm(a) for a in target["aliases"]]

    for lg in api_leagues:
        lg_name = norm(lg.get("name") or lg.get("title"))
        lg_country = norm(extract_country(lg))
        if lg_country in target_countries and lg_name in target_aliases:
            return lg

    for lg in api_leagues:
        lg_name = norm(lg.get("name") or lg.get("title"))
        lg_country = norm(extract_country(lg))
        if not lg_country and lg_name in target_aliases:
            return lg

    for lg in api_leagues:
        lg_name = norm(lg.get("name") or lg.get("title"))
        lg_country = norm(extract_country(lg))
        if lg_country in target_countries:
            for alias in target_aliases:
                if re.search(rf"(^| ){re.escape(alias)}($| )", lg_name):
                    if "2" not in alias and re.search(r"(^| )2($| )", lg_name):
                        continue
                    return lg

    return None


def run_league_audit(api_key: str, list_all: bool) -> int:
    endpoint, api_leagues = fetch_paginated(LEAGUE_ENDPOINTS, api_key)
    print(f"Endpoint: {endpoint}")
    print(f"Total leagues returned by BSD API: {len(api_leagues)}\n")

    matched = 0
    print(f"{'FootyStats League':<28} | {'Status':<7} | {'BSD API Match (ID / Country / Name)'}")
    print("-" * 88)
    for target in TRACKED_LEAGUES:
        m = match_league(target, api_leagues)
        if m:
            matched += 1
            lg_id = m.get("id", "?")
            lg_country = extract_country(m) or "—"
            lg_name = m.get("name") or m.get("title") or "?"
            print(f"{target['name']:<28} | FOUND   | [{lg_id}] {lg_country} — {lg_name}")
        else:
            print(f"{target['name']:<28} | MISSING | —")

    print("-" * 88)
    print(f"Coverage: {matched} / {len(TRACKED_LEAGUES)} FootyStats leagues accessible.\n")

    if list_all:
        print("All leagues returned by BSD API:")
        for lg in sorted(api_leagues, key=lambda x: (extract_country(x), str(x.get("name") or ""))):
            print(f"  [{lg.get('id', '?')}] {extract_country(lg) or '—'} — {lg.get('name') or lg.get('title')}")
    return 0


def run_today_results(
    api_key: str,
    target_date: str,
    finished_only: bool,
    as_json: bool,
) -> int:
    endpoint, all_events = fetch_paginated(
        EVENT_ENDPOINTS,
        api_key,
        params={"date_from": target_date, "date_to": target_date},
    )

    filtered: list[tuple[str, dict[str, Any]]] = []
    for ev in all_events:
        lg_id = extract_league_id(ev)
        if lg_id not in AVAILABLE_LEAGUE_IDS:
            continue
        if finished_only and not is_finished(ev):
            continue
        filtered.append((AVAILABLE_LEAGUE_IDS[lg_id], ev))

    if as_json:
        print(
            json.dumps(
                {
                    "date": target_date,
                    "endpoint": endpoint,
                    "total_api_events": len(all_events),
                    "matched_count": len(filtered),
                    "events": [ev for _, ev in filtered],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    finished_cnt = sum(1 for _, ev in filtered if is_finished(ev))
    print(f"Date: {target_date} | Endpoint: {endpoint}")
    print(
        f"FootyStats Leagues (19 tracked; excluding Scottish League One): "
        f"{len(filtered)} match(es) ({finished_cnt} finished) out of {len(all_events)} API events\n"
    )

    if not filtered:
        print("No matches found for your 19 available FootyStats leagues on this date.")
        return 0

    grouped: dict[str, list[dict[str, Any]]] = {}
    for lg_name, ev in filtered:
        grouped.setdefault(lg_name, []).append(ev)

    for lg_name in LEAGUE_ORDER:
        matches = grouped.get(lg_name)
        if not matches:
            continue
        matches.sort(key=lambda e: str(e.get("event_date") or e.get("date") or ""))
        print(f"== {lg_name} ({len(matches)}) ==")
        for ev in matches:
            status = format_status(ev)
            home = extract_team_name(ev, "home")
            away = extract_team_name(ev, "away")
            h, a, ht_h, ht_a = extract_score(ev)
            score_str = f"{h} - {a}" if (h is not None and a is not None) else "vs"
            extras: list[str] = []
            if ht_h is not None and ht_a is not None:
                extras.append(f"HT {ht_h}-{ht_a}")
            hc, ac = extract_corners(ev)
            if hc is not None and ac is not None:
                extras.append(f"Cnr {hc}-{ac} ({int(hc) + int(ac)})")
            extra_str = f"  [{', '.join(extras)}]" if extras else ""
            print(f"  [{status:<5}] {home:>24}  {score_str:^7}  {away:<24}{extra_str}")
        print()

    return 0


def resolve_team_logo(team_name: str, logos_map: dict[str, str]) -> str:
    if not logos_map:
        return ""
    if team_name in logos_map:
        return logos_map[team_name]
    n = norm(team_name)
    alias_key = BSD_TEAM_ALIASES.get(n)
    if alias_key and alias_key in logos_map:
        return logos_map[alias_key]
    for k, v in logos_map.items():
        if norm(k) == n:
            return v
    stripped = strip_club_noise(team_name)
    for k, v in logos_map.items():
        if norm(k) == stripped:
            return v
    return ""


def run_export_pl_html(
    api_key: str,
    html_path: Path,
    date_from: str,
    date_to: str,
) -> int:
    if not html_path.exists():
        print(f"Error: Template file not found: {html_path}", file=sys.stderr)
        return 1

    _, all_events = fetch_paginated(
        EVENT_ENDPOINTS,
        api_key,
        params={"date_from": date_from, "date_to": date_to},
    )
    pl_events = [e for e in all_events if extract_league_id(e) == 1]
    pl_events.sort(key=lambda e: str(e.get("event_date") or ""))

    logos_map = load_local_logos(html_path.parent)
    enriched: list[dict[str, Any]] = []

    for ev in pl_events:
        detail: dict[str, Any] = {}
        try:
            detail = fetch_json(f"{BASE_URL}/api/events/{ev['id']}/", api_key)
        except Exception as exc:
            print(f"Warning: detail fetch failed for event {ev.get('id')}: {exc}", file=sys.stderr)

        home_name = extract_team_name(ev, "home")
        away_name = extract_team_name(ev, "away")
        home_obj = ev.get("home_team_obj") if isinstance(ev.get("home_team_obj"), dict) else {}
        away_obj = ev.get("away_team_obj") if isinstance(ev.get("away_team_obj"), dict) else {}

        enriched.append(
            {
                "id": ev.get("id"),
                "event_date": ev.get("event_date"),
                "round_number": ev.get("round_number"),
                "status": ev.get("status"),
                "home_team": home_name,
                "away_team": away_name,
                "home_short": home_obj.get("short_name") or home_name,
                "away_short": away_obj.get("short_name") or away_name,
                "home_logo": resolve_team_logo(home_name, logos_map),
                "away_logo": resolve_team_logo(away_name, logos_map),
                "home_score": ev.get("home_score"),
                "away_score": ev.get("away_score"),
                "odds_home": ev.get("odds_home"),
                "odds_draw": ev.get("odds_draw"),
                "odds_away": ev.get("odds_away"),
                "odds_btts_yes": ev.get("odds_btts_yes"),
                "odds_btts_no": ev.get("odds_btts_no"),
                "actual_home_xg": ev.get("actual_home_xg"),
                "actual_away_xg": ev.get("actual_away_xg"),
                "home_form": detail.get("home_form"),
                "away_form": detail.get("away_form"),
            }
        )

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "date_range": f"PREMIER LEAGUE · {date_from}"
        if date_from == date_to
        else f"PREMIER LEAGUE · {date_from} TO {date_to}",
        "fixtures": enriched,
    }

    html_text = html_path.read_text(encoding="utf-8")
    marker_re = re.compile(
        r"/\* __PL_FIXTURES_DATA_START__ \*/.*?/\* __PL_FIXTURES_DATA_END__ \*/",
        re.S,
    )
    if not marker_re.search(html_text):
        print(f"Error: Data markers not found in {html_path}", file=sys.stderr)
        return 1

    replacement = (
        "/* __PL_FIXTURES_DATA_START__ */\n"
        f"      const PL_PAYLOAD = {json.dumps(payload, indent=2, ensure_ascii=False)};\n"
        "      /* __PL_FIXTURES_DATA_END__ */"
    )
    updated_html = marker_re.sub(lambda _: replacement, html_text, count=1)
    html_path.write_text(updated_html, encoding="utf-8")

    print(f"Exported {len(enriched)} Premier League fixture(s) ({date_from} to {date_to}) -> {html_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="BSD Football API 26/27 data exporter & CLI for FootyStats"
    )
    parser.add_argument("--api-key", help="BSD API token (defaults to BZZOIRO_API_KEY env var)")
    parser.add_argument(
        "--export-results",
        action="store_true",
        help="Export 26/27 BSD results + 19/20-25/26 cached CSVs into data.js",
    )
    parser.add_argument(
        "--export-fixtures",
        action="store_true",
        help="Export upcoming BSD fixtures (with 1X2, BTTS & O/U odds) into fixtures.js",
    )
    parser.add_argument(
        "--export-all",
        action="store_true",
        help="Run both --export-results and --export-fixtures",
    )
    parser.add_argument(
        "--full-refresh",
        action="store_true",
        help="Force full 26/27 season sync from 2026-07-01 instead of incremental cache update",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=14,
        help="Upcoming fixtures lookahead window in days for --export-fixtures (default: 14)",
    )
    parser.add_argument(
        "--date",
        default=dt.date.today().isoformat(),
        help="Date to query in YYYY-MM-DD format for CLI results view (default: today)",
    )
    parser.add_argument("--finished-only", action="store_true", help="Only show completed matches")
    parser.add_argument("--json", action="store_true", help="Print raw filtered JSON response")
    parser.add_argument("--leagues", action="store_true", help="Run league coverage audit")
    parser.add_argument("--list-all", action="store_true", help="With --leagues, list all API leagues")
    parser.add_argument(
        "--export-pl-html",
        metavar="HTML_FILE",
        help="Fetch upcoming Premier League fixtures and inject into HTML_FILE",
    )
    parser.add_argument("--date-from", help="Start date (YYYY-MM-DD) for --export-pl-html")
    parser.add_argument("--date-to", help="End date (YYYY-MM-DD) for --export-pl-html")
    args = parser.parse_args()

    api_key = (args.api_key or os.environ.get("BZZOIRO_API_KEY") or "").strip()
    if not api_key:
        print("Error: Set BZZOIRO_API_KEY environment variable or pass --api-key.", file=sys.stderr)
        return 1

    base_dir = Path(__file__).resolve().parent

    if args.export_all:
        rc1 = run_export_results(api_key, base_dir, full_refresh=args.full_refresh)
        rc2 = run_export_fixtures(api_key, base_dir, days=args.days)
        return rc1 or rc2
    if args.export_results:
        return run_export_results(api_key, base_dir, full_refresh=args.full_refresh)
    if args.export_fixtures:
        return run_export_fixtures(api_key, base_dir, days=args.days)
    if args.export_pl_html:
        today = dt.date.today()
        d_from = args.date_from or today.isoformat()
        d_to = args.date_to or (today + dt.timedelta(days=1)).isoformat()
        return run_export_pl_html(api_key, Path(args.export_pl_html), d_from, d_to)
    if args.leagues:
        return run_league_audit(api_key, args.list_all)
    return run_today_results(api_key, args.date, args.finished_only, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
