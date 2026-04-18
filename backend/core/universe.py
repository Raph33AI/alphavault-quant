# ============================================================
# ALPHAVAULT QUANT — Trading Universe v2.0
# 550+ symboles Yahoo Finance organisés par secteur
# Source unique de vérité pour le backend Python
# ============================================================

from typing import Dict, List

UNIVERSE_BY_SECTOR: Dict[str, List[str]] = {

    "Technology": [
        "AAPL", "MSFT", "NVDA", "AVGO", "AMD", "INTC", "QCOM", "TXN",
        "AMAT", "LRCX", "KLAC", "ADI", "MU", "ON", "SWKS", "MCHP",
        "CDNS", "SNPS", "FTNT", "CTSH", "AKAM", "WDC", "DELL", "HPE",
        "HPQ", "EPAM", "KEYS", "MPWR", "ENTG", "NXPI", "STX", "NTAP",
        "PSTG", "SMCI", "GLOB", "FLIR", "LOGI", "ZBRA", "TRMB", "NOVT",
        "IIVI", "II", "CRUS", "SLAB", "SIMO", "ALGM", "ONTO", "FORM",
    ],

    "Software/Cloud": [
        "CRM", "ADBE", "NOW", "INTU", "TEAM", "WDAY", "DDOG", "SNOW",
        "ZS", "CRWD", "OKTA", "NET", "HUBS", "VEEV", "MDB", "CFLT",
        "S", "ASAN", "GTLB", "TWLO", "ZM", "DOCU", "PAYC", "PCTY",
        "TTD", "SHOP", "MELI", "SQ", "AFRM", "SOFI", "BOX", "DOCN",
        "RNG", "FIVN", "SMAR", "BRZE", "BILL", "DLO", "SEMR", "SPT",
        "ALTR", "FRSH", "AI", "BBAI", "PLTR", "PATH", "UIPATH",
        "PTC", "ANSS", "MANH", "EPIQ", "BSY",
    ],

    "Communication Services": [
        "GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "VZ", "T",
        "TMUS", "CHTR", "LYV", "EA", "TTWO", "SNAP", "PINS", "SPOT",
        "OMC", "PARA", "WBD", "MTCH", "RBLX", "TME", "NTES", "BILI",
        "ZG", "IAC", "FOXA", "FOX", "LBRDA", "LBRDK", "FWONA",
        "IACI", "DV", "MGNI", "APP", "PUBM", "CRTO",
    ],

    "Consumer Discretionary": [
        "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG",
        "TJX", "CMG", "ORLY", "AZO", "ROST", "DHI", "LEN", "MAR",
        "HLT", "GM", "F", "APTV", "UBER", "LYFT", "ABNB", "EXPE",
        "CCL", "RCL", "NCLH", "DAL", "UAL", "AAL", "LUV", "RIVN",
        "DKNG", "MGM", "WYNN", "LVS", "POOL", "WHR", "RL", "PVH",
        "TPR", "VFC", "HBI", "SKX", "DECK", "ONON", "CROX", "COLM",
        "YETI", "CVNA", "KMX", "AN", "PAG", "GPC", "LKQ", "BWA",
        "APTV", "VC", "LEA", "DRH", "RHP", "HST", "SHO", "PK",
    ],

    "Consumer Staples": [
        "WMT", "PG", "KO", "PEP", "COST", "PM", "MO", "MDLZ",
        "CL", "EL", "KHC", "GIS", "HSY", "CLX", "KMB", "TSN",
        "HRL", "STZ", "KR", "SFM", "BJ", "GO", "CASY", "CHEF",
        "CAG", "CPB", "MKC", "SJM", "THS", "CENT", "FLO", "LANC",
        "CALM", "SAFM", "POST", "BRBR", "VITL", "MGPI",
    ],

    "Healthcare": [
        "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR",
        "BMY", "AMGN", "MDT", "ISRG", "SYK", "BSX", "EW", "REGN",
        "GILD", "VRTX", "BIIB", "ILMN", "IQV", "MRNA", "PFE",
        "DXCM", "ALGN", "IDXX", "HUM", "CI", "CVS", "ELV", "CNC",
        "MCK", "CAH", "ABC", "HOLX", "BDX", "MTD", "WAT", "A",
        "GEHC", "RMD", "PODD", "TNDM", "INSP", "NVST", "HAYW",
        "COO", "TFX", "HSIC", "PDCO", "PRGO", "JAZZ", "ALKS",
        "EXEL", "BMRN", "SRPT", "RARE", "ACAD", "SAGE",
    ],

    "Biotechnology": [
        "GILD", "BIIB", "MRNA", "REGN", "VRTX", "BMRN", "EXEL",
        "ALNY", "IONS", "NBIX", "SGEN", "RCUS", "ARWR", "AKBA",
        "CRNX", "DNLI", "KYMR", "MGNX", "PTGX", "RVMD", "ROIV",
        "DAWN", "CYTK", "IMVT", "PRAX", "KROS", "ACMR", "ARQT",
        "DERM", "RCKT", "ERAS", "NUVL", "BPMC", "KRTX", "RVNC",
        "INVA", "VERV", "BEAM", "EDIT", "CRSP", "NTLA", "SGMO",
        "FATE", "SANA", "BLUE", "SURF", "VCEL", "IOVA",
    ],

    "Financials": [
        "JPM", "BAC", "WFC", "GS", "MS", "BLK", "SPGI", "MCO",
        "COF", "AXP", "V", "MA", "PYPL", "SCHW", "CB", "AIG",
        "PGR", "ALL", "TRV", "MET", "PRU", "AFL", "USB", "PNC",
        "TFC", "FITB", "KEY", "RF", "HBAN", "CFG", "STT", "BK",
        "CME", "CBOE", "ICE", "NDAQ", "MSCI", "FDS", "HOOD",
        "RJF", "LPLA", "IBKR", "VIRT", "MKTX", "PIPR", "SF",
        "COWN", "GHL", "EVR", "LAZ", "HLI", "FHN", "WAL",
        "PACW", "OFG", "CFFN", "FFIN", "BOKF", "EWBC", "HOPE",
        "BANC", "CADE", "RBCAA", "CHCO", "BMTC", "NYCB",
        "ALLY", "SYF", "DFS", "OMF", "CACC", "SC", "OPRT",
        "TREE", "RATE", "OPEN", "UWMC", "RKT",
    ],

    "Industrials": [
        "HON", "UPS", "RTX", "CAT", "DE", "ETN", "GE", "LMT",
        "NOC", "GD", "BA", "MMM", "EMR", "ITW", "ROK", "PH",
        "DOV", "FAST", "SWK", "SNA", "GNRC", "XYL", "ROP", "FDX",
        "NSC", "UNP", "CSX", "JBHT", "ODFL", "EXPD", "CHRW",
        "GWW", "URI", "PCAR", "CTAS", "VRSK", "RSG", "WM",
        "AXON", "LHX", "HII", "TXT", "HWM", "CARR", "OTIS",
        "TT", "IR", "AME", "HUBB", "REXR", "AAON", "BLDR",
        "EXP", "MLM", "VMC", "STRL", "DY", "PWR", "MTZ",
        "EME", "MYRG", "WLDN", "TTEK", "AECOM", "ACM",
        "J", "KBR", "ROAD", "ARCB", "SAIA", "LSTR", "ECHO",
        "XPO", "GXO", "HUBG", "RXO", "AAWW", "ATSG",
    ],

    "Energy": [
        "XOM", "CVX", "COP", "EOG", "PXD", "MPC", "VLO", "PSX",
        "HES", "DVN", "OXY", "SLB", "HAL", "BKR", "CTRA", "EQT",
        "APA", "FANG", "MRO", "KMI", "WMB", "OKE", "LNG",
        "AR", "RRC", "SW", "CHK", "SM", "MTDR", "ESTE",
        "NOG", "FLNG", "TTE", "DINO", "VVV", "PARR",
        "DKL", "CAPL", "CVRR", "PBF", "CVI",
    ],

    "Materials": [
        "LIN", "APD", "SHW", "PPG", "ECL", "NEM", "FCX", "NUE",
        "STLD", "ALB", "CF", "MOS", "VMC", "MLM", "GOLD", "WPM",
        "AA", "X", "CLF", "MP", "RGLD", "PAAS", "MAG", "EXK",
        "AG", "HL", "CDE", "FSM", "GATO", "SILV",
        "CC", "OLN", "KRO", "EMN", "AXTA", "HUN", "RPM",
        "AVY", "SEE", "SLGN", "PKG", "IP", "WRK", "SON",
    ],

    "Real Estate": [
        "PLD", "AMT", "CCI", "EQIX", "SPG", "O", "WELL", "EQR",
        "AVB", "ARE", "BXP", "IRM", "SBAC", "PSA", "EXR", "VICI",
        "GLPI", "NNN", "WPC", "CUBE", "LSI", "NSA", "REXR",
        "FR", "EGP", "STAG", "TRNO", "IIPR", "COLD", "NLCP",
        "GMRE", "NTST", "PSTL", "ADC", "EPRT", "SRC", "PINE",
        "GOOD", "LAND", "STRW", "CLPR", "NXRT", "IRT", "NHI",
        "LTC", "SBRA", "CTRE", "HR", "DOC", "PEAK", "OHI",
    ],

    "Utilities": [
        "NEE", "DUK", "SO", "D", "EXC", "AEP", "XEL", "SRE",
        "ED", "ETR", "PPL", "DTE", "FE", "CMS", "WEC", "ES",
        "AES", "NRG", "AEE", "CNP", "PEG", "EVRG", "AVA",
        "IDACORP", "OGE", "NWE", "SR", "SPWR", "RUN", "NOVA",
        "ENPH", "FSLR", "SEDG", "ARRY", "NEP", "BEP", "AY",
        "CWEN", "CLNC", "HASI", "EVA", "GPRE",
    ],

    "ETFs_US_Broad": [
        "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "IVV",
        "RSP", "MDY", "IJR", "IWB", "IWF", "IWD",
        "VUG", "VTV", "VTWO", "VXF", "VXUS",
    ],

    "ETFs_Sector": [
        "XLF", "XLK", "XLE", "XLV", "XLI", "XLP",
        "XLU", "XLRE", "XLC", "XLB", "XLY", "XBI",
        "IBB", "SMH", "SOXX", "ARKK", "ARKG", "ARKW",
        "ARKF", "ARKQ", "PRNT", "IZRL", "BOTZ",
        "HACK", "BUG", "CLOU", "WCLD", "SKYY",
        "FINX", "KBWB", "KRE", "KIE", "IAI",
        "MLPA", "AMLP", "TAN", "FAN", "ICLN", "CNRG",
    ],

    "ETFs_Fixed_Income": [
        "TLT", "IEF", "SHY", "AGG", "BND", "LQD", "HYG",
        "JNK", "VCIT", "VCSH", "MUB", "TIPS", "TIP",
        "BKLN", "FLOT", "FLRN", "NEAR", "JPST",
        "EMB", "PCY", "IAGG",
    ],

    "ETFs_Commodities_Macro": [
        "GLD", "SLV", "IAU", "SIVR", "PDBC", "DJP",
        "USO", "UNG", "CORN", "WEAT", "SOYB",
        "DBC", "GSG", "COMT", "COMB",
        "EFA", "EEM", "VWO", "IDEV", "ACWI",
        "EWJ", "EWZ", "EWY", "EWG", "EWT", "FXI",
        "MCHI", "KWEB", "CQQQ", "ASHR",
    ],

    "ETFs_Leveraged_Inverse": [
        "SOXL", "TQQQ", "SPXL", "TECL", "FNGU", "LABU",
        "SQQQ", "SH", "PSQ", "SPXS", "UVXY", "VXX",
        "SVXY", "BITO", "IBIT", "FBTC", "ETHE",
    ],

    "Crypto_Digital": [
        "COIN", "MSTR", "RIOT", "MARA", "HUT", "CLSK",
        "BTBT", "CIFR", "IREN", "HIVE", "BITF", "WULF",
        "BSRT", "CORZ", "ARBK",
    ],

    "International_ADR_Europe": [
        "ASML", "SAP", "NVO", "AZN", "GSK", "BP", "SHEL",
        "TTE", "ULVR", "HSBC", "UBS", "CS", "ING",
        "SAN", "BBVA", "AIR", "EADSF", "VOD",
        "BCS", "RIO", "BHP", "VALE",
        "ABBN", "NOVN", "ROG", "NESN",
    ],

    "International_ADR_Asia": [
        "TSM", "TM", "SONY", "HMC", "KYOC", "MFG",
        "BABA", "JD", "PDD", "BIDU", "NIO", "LI", "XPEV",
        "SE", "GRAB", "GRAB", "CPNG", "TIGR",
        "FLUT", "KB", "SHG", "ACMR",
        "INFY", "WIT", "HDB", "IBN",
    ],

    "International_ADR_Americas": [
        "MELI", "NU", "STNE", "PAGS", "VTEX",
        "ARCO", "VIST", "YPF", "CEPU",
        "BSAC", "BCH", "CIB", "GGB", "SID",
        "EC", "ECOPETROL", "TD", "RY", "BNS", "BMO",
    ],

    "Small_Cap_Growth": [
        "CELH", "HIMS", "TMDX", "RXRX", "ACVA",
        "AMBA", "SWAV", "AGIO", "ACLX", "ADMA",
        "AVPT", "CLOV", "DM", "EVGO", "BLNK",
        "CHPT", "WKHS", "GOEV", "HYLN", "NKLA",
        "JOBY", "ACHR", "LILM", "BLADE", "RKLB",
        "SPCE", "LUNR", "RDW", "AST", "SATL",
    ],
}

# ── Core universe (toujours traité en priorité, intraday + LLM) ──
CORE_UNIVERSE: List[str] = [
    # Macro ETFs
    "SPY", "QQQ", "IWM", "GLD", "TLT",
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
    "META", "TSLA", "AVGO", "AMD",
    # Financials
    "JPM", "GS", "V", "MA",
    # Healthcare
    "UNH", "LLY", "JNJ",
    # Energy / Materials
    "XOM", "CVX",
    # Consumer
    "HD", "COST", "WMT",
]

def get_full_universe(
    include_etfs:    bool = True,
    include_adr:     bool = True,
    include_crypto:  bool = True,
    include_smallcap:bool = True,
    include_biotech: bool = True,
) -> List[str]:
    """
    Retourne la liste complète dédupliquée (~550+ symboles).
    Le core universe est toujours en tête pour priorité de traitement.
    """
    seen   = set()
    result = []

    def _add(syms: List[str]):
        for s in syms:
            if s and s not in seen:
                seen.add(s)
                result.append(s)

    # Core toujours en premier
    _add(CORE_UNIVERSE)

    # Filtre optionnel par catégorie
    SKIP_KEYS = set()
    if not include_etfs:
        SKIP_KEYS.update([
            "ETFs_US_Broad", "ETFs_Sector", "ETFs_Fixed_Income",
            "ETFs_Commodities_Macro", "ETFs_Leveraged_Inverse",
        ])
    if not include_adr:
        SKIP_KEYS.update([
            "International_ADR_Europe", "International_ADR_Asia",
            "International_ADR_Americas",
        ])
    if not include_crypto:
        SKIP_KEYS.add("Crypto_Digital")
    if not include_smallcap:
        SKIP_KEYS.add("Small_Cap_Growth")
    if not include_biotech:
        SKIP_KEYS.add("Biotechnology")

    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if sector not in SKIP_KEYS:
            _add(syms)

    return result

def get_sector(symbol: str) -> str:
    """Retourne le secteur d'un symbole."""
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if symbol in syms:
            return sector
    return "Other"

def get_core_universe() -> List[str]:
    return list(CORE_UNIVERSE)

def get_etf_universe() -> List[str]:
    result = []
    for key in ["ETFs_US_Broad", "ETFs_Sector", "ETFs_Fixed_Income",
                "ETFs_Commodities_Macro", "ETFs_Leveraged_Inverse"]:
        result.extend(UNIVERSE_BY_SECTOR.get(key, []))
    return list(dict.fromkeys(result))

# ── Stats ──────────────────────────────────────────────────────
FULL_UNIVERSE = get_full_universe()
TOTAL_SYMBOLS = len(FULL_UNIVERSE)
TOTAL_SECTORS = len(UNIVERSE_BY_SECTOR)

if __name__ == "__main__":
    print(f"\nFull universe : {TOTAL_SYMBOLS} symbols | {TOTAL_SECTORS} sectors")
    print(f"Core          : {len(CORE_UNIVERSE)} symbols")
    print(f"\nBreakdown par secteur:")
    for s, syms in UNIVERSE_BY_SECTOR.items():
        print(f"  {s:35s}: {len(syms):3d}")
    print(f"\nTotal vérifié : {TOTAL_SYMBOLS}")