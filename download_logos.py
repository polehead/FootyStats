"""
FootyStats — Team Logo Downloader & Registry Generator
Fetches transparent club crests from football-logos.cc and saves them locally in ./logos/
Generates logos.js mapping team names to local logo assets.
"""

import os
import re
import json
import gzip
import urllib.request
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

LOGOS_DIR = os.path.join(os.path.dirname(__file__), "logos")
LOGOS_JS = os.path.join(os.path.dirname(__file__), "logos.js")

# Manual aliases for FootyStats abbreviations and regional naming conventions
ALIASES = {
    "AEK": "aek-athens",
    "Academico Viseu": "academico-de-viseu-fc",
    "Ad. Demirspor": "adana-demirspor",
    "Airdrie Utd": "airdrieonians-fc",
    "Alaves": "deportivo-alaves",
    "Alessandria": "us-alessandria-calcio-1912",
    "Almere City": "almere-city-fc",
    "Altay": "altay-sk",
    "Amedspor": "amed-sk",
    "Aris": "aris-thessaloniki",
    "Asteras Tripolis": "asteras-tripolis",
    "Ath Bilbao": "athletic-club",
    "Ath Madrid": "atletico-madrid",
    "Aves": "avs-futebol-sad",
    "AVS": "avs-futebol-sad",
    "Bayern Munich": "bayern-munchen",
    "Beerschot VA": "k-beerschot-va",
    "Belenenses": "os-belenenses",
    "Betis": "real-betis",
    "Bielefeld": "arminia-bielefeld",
    "Blackburn": "blackburn-rovers",
    "Bochum": "vfl-bochum",
    "Bodrumspor": "bodrum-fk",
    "Bolton": "bolton-wanderers",
    "Boston Utd": "boston-united",
    "Braunschweig": "eintracht-braunschweig",
    "Brighton": "brighton-and-hove-albion",
    "Bristol Rvs": "bristol-rovers",
    "Burton": "burton-albion",
    "Buyuksehyr": "istanbul-basaksehir",
    "Caen": "stade-malherbe-caen",
    "Cambridge": "cambridge-united",
    "Cardiff": "cardiff-city",
    "Carlisle": "carlisle-united",
    "Casa Pia": "casa-pia-ac",
    "Celta": "celta-vigo",
    "Celta B": "celta-vigo",
    "Charlton": "charlton-athletic",
    "Chateauroux": "lb-chateauroux",
    "Cheltenham": "cheltenham-town",
    "Clermont": "clermont-foot",
    "Colchester": "colchester-united",
    "Como": "como-1907",
    "Cottbus": "energie-cottbus",
    "Coventry": "coventry-city",
    "Crawley Town": "crawley-town",
    "Crewe": "crewe-alexandra",
    "Dag and Red": "dagenham-and-redbridge",
    "Darmstadt": "sv-darmstadt-98",
    "Den Haag": "ado-den-haag",
    "Dender": "fcv-dender-eh",
    "Denizlispor": "denizlispor",
    "Derby": "derby-county",
    "Dijon": "dijon-fco",
    "Doncaster": "doncaster-rovers",
    "Dortmund": "borussia-dortmund",
    "Dresden": "dynamo-dresden",
    "Dundee United": "dundee-united",
    "Dunfermline": "dunfermline-athletic",
    "Ein Frankfurt": "eintracht-frankfurt",
    "Elversberg": "sv-elversberg",
    "Erzgebirge Aue": "fc-erzgebirge-aue",
    "Erzurum BB": "erzurumspor-fk",
    "Erzurumspor": "erzurumspor-fk",
    "Espanol": "espanyol",
    "Estoril": "estoril-praia",
    "Estrela": "estrela-da-amadora",
    "Excelsior": "sbv-excelsior",
    "Exeter": "exeter-city",
    "FC Koln": "koln",
    "Falkirk": "falkirk-fc",
    "Farense": "sc-farense",
    "Ferrol": "racing-de-ferrol",
    "Fleetwood Town": "fleetwood-town",
    "For Sittard": "fortuna-sittard",
    "Forest Green": "forest-green-rovers",
    "Fortuna Dusseldorf": "fortuna-dusseldorf",
    "Freiburg": "sc-freiburg",
    "Fylde": "afc-fylde",
    "Gaziantep": "gaziantep-fk",
    "Genclerbirligi": "genclerbirligi-sk",
    "Giannina": "pas-giannina",
    "Gil Vicente": "gil-vicente-fc",
    "Gillingham": "gillingham-fc",
    "Giresunspor": "giresunspor",
    "Girona": "girona-fc",
    "Goztep": "goztepe",
    "Granada": "granada-cf",
    "Grenoble": "grenoble-foot-38",
    "Greuther Furth": "spvgg-greuther-furth",
    "Grimsby": "grimsby-town",
    "Guimaraes": "vitoria-guimaraes",
    "Guingamp": "en-avant-guingamp",
    "Halifax": "fc-halifax-town",
    "Hamburg": "hamburger-sv",
    "Hamilton": "hamilton-academical",
    "Hannover": "hannover-96",
    "Harrogate": "harrogate-town",
    "Hartlepool": "hartlepool-united",
    "Hatayspor": "hatayspor",
    "Heracles": "heracles-almelo",
    "Hertha": "hertha-bsc",
    "Huddersfield": "huddersfield-town",
    "Hull": "hull-city",
    "Ibiza": "ud-ibiza",
    "Ingolstadt": "fc-ingolstadt-04",
    "Inter": "inter-milan",
    "Inverness C": "inverness-caledonian-thistle",
    "Ionikos": "ionikos-nikeas",
    "Ipswich": "ipswich-town",
    "Iraklis": "iraklis-thessaloniki",
    "Istanbulspor": "istanbulspor",
    "Juve Stabia": "ss-juve-stabia",
    "Kaiserslautern": "1-fc-kaiserslautern",
    "Kalamata": "ps-kalamata",
    "Karagumruk": "fatih-karagumruk-sk",
    "Karlsruhe": "karlsruher-sc",
    "Kasimpasa": "kasimpasa-sk",
    "Kayserispor": "kayserispor",
    "Kidderminster": "kidderminster-harriers",
    "Kifisia": "ae-kifisia",
    "King’s Lynn": "kings-lynn-town",
    "Kocaelispor": "kocaelispor",
    "Konyaspor": "konyaspor",
    "Kortrijk": "kv-kortrijk",
    "La Coruna": "deportivo-de-la-coruna",
    "Lamia": "pas-lamia-1964",
    "Larisa": "ael-larissa",
    "Las Palmas": "ud-las-palmas",
    "Le Havre": "le-havre-ac",
    "Le Mans": "le-mans-fc",
    "Leeds": "leeds-united",
    "Leicester": "leicester-city",
    "Lens": "rc-lens",
    "Levadeiakos": "levadiakos",
    "Leverkusen": "bayer-leverkusen",
    "Lincoln": "lincoln-city",
    "Lommel SK": "lommel-sk",
    "Luton": "luton-town",
    "M'gladbach": "borussia-monchengladbach",
    "Magdeburg": "1-fc-magdeburg",
    "Mainz": "1-fsv-mainz-05",
    "Malaga": "malaga-cf",
    "Mallorca": "rcd-mallorca",
    "Man City": "manchester-city",
    "Man United": "manchester-united",
    "Mansfield": "mansfield-town",
    "Mantova": "mantova-1911",
    "Maritimo": "cs-maritimo",
    "Marseille": "olympique-marseille",
    "Mechelen": "kv-mechelen",
    "Milan": "ac-milan",
    "Milton Keynes Dons": "mk-dons",
    "Moreirense": "moreirense-fc",
    "Morton": "greenock-morton",
    "Mouscron": "royal-excel-mouscron",
    "NAC Breda": "nac-breda",
    "Nacional": "cd-nacional",
    "Newcastle": "newcastle-united",
    "Newport County": "newport",
    "Nijmegen": "nec-nijmegen",
    "Nimes": "nimes-olympique",
    "Niort": "chamois-niortais",
    "Northampton": "northampton-town",
    "Norwich": "norwich-city",
    "Nott'm Forest": "nottingham-forest",
    "Notts County": "notts-county",
    "Nurnberg": "1-fc-nurnberg",
    "OFI Crete": "ofi-crete",
    "Oldham": "oldham-athletic",
    "Oostende": "kv-oostende",
    "Osnabruck": "vfl-osnabruck",
    "Oud-Heverlee Leuven": "oh-leuven",
    "Oxford": "oxford-united",
    "Oxford City": "oxford-city",
    "PAOK": "paok-thessaloniki",
    "PSV Eindhoven": "psv",
    "Pacos Ferreira": "fc-pacos-de-ferreira",
    "Paderborn": "sc-paderborn-07",
    "Palermo": "palermo-fc",
    "Panathinaikos": "panathinaikos",
    "Panetolikos": "panetolikos",
    "Panionios": "panionios",
    "Panserraikos": "panserraikos",
    "Paris SG": "paris-saint-germain",
    "Pau FC": "pau-fc",
    "Pendikspor": "pendikspor",
    "Peterboro": "peterborough-united",
    "Plymouth": "plymouth-argyle",
    "Portsmouth": "portsmouth-fc",
    "Preston": "preston-north-end",
    "Preußen Münster": "sc-preussen-munster",
    "QPR": "queens-park-rangers",
    "Queen of Sth": "queen-of-the-south",
    "Queens Park": "queens-park-fc",
    "Quevilly Rouen": "quevilly-rouen-metropole",
    "RAAL La Louviere": "raal-la-louviere",
    "RWD Molenbeek": "rwdm",
    "Raith Rvs": "raith-rovers",
    "Red Star": "red-star-fc",
    "Regensburg": "ssv-jahn-regensburg",
    "Reims": "stade-de-reims",
    "Rennes": "stade-rennais",
    "Rizespor": "caykur-rizespor",
    "Rodez": "rodez-af",
    "Rotherham": "rotherham-united",
    "Salford": "salford-city",
    "Samsunspor": "samsunspor",
    "Sandhausen": "sv-sandhausen",
    "Santa Clara": "cd-santa-clara",
    "Santander": "racing-de-santander",
    "Schalke 04": "schalke-04",
    "Scunthorpe": "scunthorpe-united",
    "Setubal": "vitoria-setubal",
    "Sheffield United": "sheffield-united",
    "Sheffield Weds": "sheffield-wednesday",
    "Shrewsbury": "shrewsbury-town",
    "Sivasspor": "sivasspor",
    "Sociedad": "real-sociedad",
    "Sociedad B": "real-sociedad",
    "Solihull": "solihull-moors",
    "Southampton": "southampton-fc",
    "Southend": "southend-united",
    "Sp Braga": "sporting-braga",
    "Sp Gijon": "sporting-gijon",
    "Sp Lisbon": "sporting-cp",
    "St Etienne": "as-saint-etienne",
    "St Johnstone": "st-johnstone-fc",
    "St Mirren": "st-mirren-fc",
    "St Pauli": "fc-st-pauli",
    "St Truiden": "sint-truidense-vv",
    "St. Gilloise": "royale-union-saint-gilloise",
    "Standard": "standard-liege",
    "Stevenage": "stevenage-fc",
    "Stockport": "stockport-county",
    "Stoke": "stoke-city",
    "Strasbourg": "rc-strasbourg",
    "Stuttgart": "vfb-stuttgart",
    "Sudtirol": "fc-sudtirol",
    "Swansea": "swansea-city",
    "Swindon": "swindon-town",
    "Tottenham": "tottenham-hotspur",
    "Trabzonspor": "trabzonspor",
    "Tranmere": "tranmere-rovers",
    "Ulm": "ssv-ulm-1846",
    "Umraniyespor": "umraniyespor",
    "Union Berlin": "1-fc-union-berlin",
    "VVV Venlo": "vvv-venlo",
    "Valenciennes": "valenciennes-fc",
    "Vallecano": "rayo-vallecano",
    "Villarreal B": "villarreal",
    "Vizela": "fc-vizela",
    "Volos NFC": "volos-fc",
    "Waalwijk": "rkc-waalwijk",
    "Waasland-Beveren": "sk-beveren",
    "Walsall": "walsall-fc",
    "Waregem": "zulte-waregem",
    "Watford": "watford-fc",
    "Wealdstone": "wealdstone-fc",
    "Wehen": "sv-wehen-wiesbaden",
    "West Brom": "west-bromwich-albion",
    "West Ham": "west-ham-united",
    "Westerlo": "kvc-westerlo",
    "Weymouth": "weymouth-fc",
    "Wigan": "wigan-athletic",
    "Willem II": "willem-ii",
    "Wolfsburg": "vfl-wolfsburg",
    "Wolves": "wolverhampton-wanderers",
    "Wrexham": "wrexham-afc",
    "Wurzburger Kickers": "fc-wurzburger-kickers",
    "Wycombe": "wycombe-wanderers",
    "Xanthi": "ao-xanthi",
    "Yeni Malatyaspor": "yeni-malatyaspor",
    "Yeovil": "yeovil-town",
    "York": "york-city",
    "Zwolle": "pec-zwolle"
}

def extract_teams():
    data_file = os.path.join(os.path.dirname(__file__), "data.js")
    with open(data_file, "r", encoding="utf-8") as f:
        line = f.readline()
    m = re.search(r'"t":\s*(\[[^\]]+\])', line)
    if not m:
        raise ValueError("Could not find team list 't' in data.js")
    teams = json.loads(m.group(1))

    # Also check fixtures.js for any upcoming teams
    fix_file = os.path.join(os.path.dirname(__file__), "fixtures.js")
    if os.path.exists(fix_file):
        with open(fix_file, "r", encoding="utf-8") as f:
            content = f.read()
        for hm in re.findall(r'"home":\s*"([^"]+)"', content):
            if hm not in teams:
                teams.append(hm)
        for am in re.findall(r'"away":\s*"([^"]+)"', content):
            if am not in teams:
                teams.append(am)

    return sorted(list(set(teams)))

def fetch_sitemap_catalog():
    print("Fetching image sitemap from football-logos.cc...")
    req = urllib.request.Request("https://football-logos.cc/image-sitemap.xml.gz", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
        gz_data = resp.read()
    xml_data = gzip.decompress(gz_data).decode("utf-8", errors="ignore")
    locs = re.findall(r'<image:loc>([^<]+)</image:loc>', xml_data)

    catalog = {}
    for url in locs:
        m = re.search(r'/logos/([^/]+)/700x700/([^/]+)\.([a-f0-9]+)\.png', url)
        if m:
            country, slug, h = m.groups()
            if '--' not in slug:
                catalog[slug] = url
                catalog[f"{country}/{slug}"] = url
    print(f"Loaded {len(catalog)} current crest entries from sitemap.")
    return catalog

def normalize_slug(name):
    s = name.lower().strip().replace("'", "").replace(".", "").replace("&", "and")
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

def resolve_team_logo_url(name, catalog):
    if name in ALIASES:
        target = ALIASES[name]
        if target in catalog:
            return catalog[target]

    s = normalize_slug(name)
    if s in catalog:
        return catalog[s]

    # Try common suffixes
    for suffix in ['-fc', '-cf', '-afc', '-sc', '-sk', '-rovers', '-wanderers', '-city', '-town', '-united', '-athletic']:
        if s + suffix in catalog:
            return catalog[s + suffix]

    # Try common prefixes
    for prefix in ['real-', 'deportivo-', 'ac-', 'as-', 'fc-', 'sc-', 'cf-', 'borussia-', 'bayer-', 'vfb-', 'spvgg-', '1-fc-']:
        if prefix + s in catalog:
            return catalog[prefix + s]

    return None

def download_and_generate():
    os.makedirs(LOGOS_DIR, exist_ok=True)
    teams = extract_teams()
    print(f"Found {len(teams)} unique teams in FootyStats dataset.")

    catalog = fetch_sitemap_catalog()

    logo_mapping = {}
    downloaded = 0
    cached = 0
    failed = 0

    for idx, team in enumerate(teams):
        url = resolve_team_logo_url(team, catalog)
        if not url:
            failed += 1
            continue

        slug = normalize_slug(team)
        filename = f"{slug}.png"
        filepath = os.path.join(LOGOS_DIR, filename)
        rel_path = f"./logos/{filename}"

        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            cached += 1
            logo_mapping[team] = rel_path
            continue

        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                data = resp.read()
                if len(data) > 0:
                    with open(filepath, "wb") as f_out:
                        f_out.write(data)
                    downloaded += 1
                    logo_mapping[team] = rel_path
                else:
                    failed += 1
        except Exception as e:
            failed += 1
            print(f"Error downloading {team} ({url}): {e}")

    print(f"Finished! Downloaded: {downloaded}, Cached: {cached}, Missing/Failed: {failed}")
    print(f"Total logos mapped: {len(logo_mapping)} / {len(teams)} ({len(logo_mapping)/len(teams)*100:.1f}%)")

    # Generate logos.js
    js_content = "/* FootyStats — Local Team Logos Registry */\n"
    js_content += "var TEAM_LOGOS = " + json.dumps(logo_mapping, indent=2, sort_keys=True) + ";\n"
    js_content += "if (typeof module !== 'undefined' && module.exports) {\n"
    js_content += "  module.exports = TEAM_LOGOS;\n"
    js_content += "}\n"

    with open(LOGOS_JS, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"Successfully generated {LOGOS_JS} with {len(logo_mapping)} club crests.")

if __name__ == "__main__":
    download_and_generate()
