# ============================================================
# ALPHAVAULT QUANT — Trading Universe
# ~300 symboles Yahoo Finance organisés par secteur
# Source unique de vérité pour le backend Python
# Cohérent avec le WatchlistManager JS (~700 front-end)
# ============================================================

from typing import Dict, List

# ── Par secteur ──────────────────────────────────────────────
UNIVERSE_BY_SECTOR: Dict[str, List[str]] = {

    "Technology": [
        "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "AMD", "INTC", "QCOM",
        "TXN", "AMAT", "LRCX", "KLAC", "ADI", "MU", "ON", "SWKS",
        "CDNS", "SNPS", "FTNT", "CTSH", "AKAM", "WDC", "DELL",
        "HPE", "HPQ", "EPAM", "KEYS", "MPWR", "ENTG",
    ],

    "Software/Cloud": [
        "CRM", "ADBE", "NOW", "INTU", "TEAM", "WDAY",
        "DDOG", "SNOW", "ZS", "CRWD", "OKTA", "NET", "HUBS", "VEEV",
        "MDB", "CFLT", "S", "ASAN", "GTLB", "TWLO", "ZM", "DOCU",
        "PAYC", "PCTY", "TTD", "SHOP", "MELI", "SQ", "AFRM", "SOFI",
        "BOX", "DOCN", "RNG", "FIVN",
    ],

    "Communication Services": [
        "GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "VZ", "T",
        "TMUS", "CHTR", "LYV", "EA", "TTWO", "SNAP", "PINS", "SPOT",
        "OMC", "PARA", "WBD", "MTCH", "RBLX",
    ],

    "Consumer Discretionary": [
        "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG",
        "TJX", "CMG", "ORLY", "AZO", "ROST", "DHI", "LEN", "MAR",
        "HLT", "GM", "F", "APTV", "UBER", "LYFT", "ABNB", "EXPE",
        "CCL", "RCL", "NCLH", "DAL", "UAL", "AAL", "LUV", "RIVN",
        "DKNG", "MGM", "WYNN", "LVS",
    ],

    "Consumer Staples": [
        "WMT", "PG", "KO", "PEP", "COST", "PM", "MO", "MDLZ",
        "CL", "EL", "KHC", "GIS", "HSY", "CLX", "KMB", "TSN",
        "HRL", "STZ", "KR", "SFM",
    ],

    "Healthcare": [
        "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR",
        "BMY", "AMGN", "MDT", "ISRG", "SYK", "BSX", "EW", "REGN",
        "GILD", "VRTX", "BIIB", "ILMN", "IQV", "MRNA", "PFE",
        "DXCM", "ALGN", "IDXX", "HUM", "CI", "CVS", "ELV", "CNC",
        "MCK", "CAH", "ABC", "HOLX", "BDX", "MTD", "WAT",
    ],

    "Financials": [
        "JPM", "BAC", "WFC", "GS", "MS", "BLK", "SPGI", "MCO",
        "COF", "AXP", "V", "MA", "PYPL", "SCHW", "CB", "AIG",
        "PGR", "ALL", "TRV", "MET", "PRU", "AFL", "USB", "PNC",
        "TFC", "FITB", "KEY", "RF", "HBAN", "CFG", "STT", "BK",
        "CME", "CBOE", "ICE", "NDAQ", "MSCI", "FDS", "HOOD",
        "RJF", "LPLA",
    ],

    "Industrials": [
        "HON", "UPS", "RTX", "CAT", "DE", "ETN", "GE", "LMT",
        "NOC", "GD", "BA", "MMM", "EMR", "ITW", "ROK", "PH",
        "DOV", "FAST", "SWK", "SNA", "GNRC", "XYL", "ROP", "FDX",
        "NSC", "UNP", "CSX", "JBHT", "ODFL", "EXPD", "CHRW",
        "GWW", "URI", "PCAR", "CTAS", "VRSK", "RSG", "WM",
        "AXON", "L3H", "HII", "TXT", "HWM",
    ],

    "Energy": [
        "XOM", "CVX", "COP", "EOG", "PXD", "MPC", "VLO", "PSX",
        "HES", "DVN", "OXY", "SLB", "HAL", "BKR", "CTRA", "EQT",
        "APA", "FANG", "MRO", "KMI", "WMB", "OKE", "LNG",
    ],

    "Materials": [
        "LIN", "APD", "SHW", "PPG", "ECL", "NEM", "FCX", "NUE",
        "STLD", "ALB", "CF", "MOS", "VMC", "MLM", "GOLD", "WPM",
        "AA", "X", "CLF", "MP",
    ],

    "Real Estate": [
        "PLD", "AMT", "CCI", "EQIX", "SPG", "O", "WELL", "EQR",
        "AVB", "ARE", "BXP", "IRM", "SBAC", "PSA", "EXR", "VICI",
        "GLPI", "NNN", "WPC",
    ],

    "Utilities": [
        "NEE", "DUK", "SO", "D", "EXC", "AEP", "XEL", "SRE",
        "ED", "ETR", "PPL", "DTE", "FE", "CMS", "WEC", "ES",
        "AES", "NRG", "AEE", "CNP",
    ],

    "Crypto/Digital": [
        "COIN", "MSTR", "RIOT", "MARA", "HUT", "CLSK",
    ],

    "ETFs": [
        "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "IVV",
        "EFA", "EEM", "GLD", "SLV", "TLT", "HYG", "LQD",
        "VNQ", "XLF", "XLK", "XLE", "XLV", "XLI", "XLP",
        "XLU", "XLRE", "XLC", "XLB", "XLY", "XBI", "IBB",
        "SMH", "SOXX", "ARKK", "ARKG", "ARKW",
        "SOXL", "TQQQ", "SPXL", "SQQQ", "SH", "BITO",
    ],

    "International ADR": [
        "TSM", "ASML", "SAP", "NVO", "TM", "SONY",
        "BABA", "JD", "NIO", "LI", "XPEV",
        "RIO", "BHP", "VALE", "AZN", "GSK", "BP", "SHEL",
        "SE", "GRAB",
    ],
}

# ── Core universe (toujours traité en priorité) ───────────────
CORE_UNIVERSE: List[str] = [
    "SPY", "QQQ", "IWM", "GLD", "TLT",
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
    "META", "TSLA", "JPM", "GS", "V",
    "UNH", "LLY", "XOM", "HD", "COST",
]

# ── ETF-only universe (régimes macro) ─────────────────────────
ETF_UNIVERSE: List[str] = UNIVERSE_BY_SECTOR["ETFs"]

def get_full_universe(include_etfs: bool = True,
                      include_adr:   bool = True) -> List[str]:
    """Retourne la liste complète dédupliquée, core en premier."""
    seen   = set()
    result = []

    def _add(syms):
        for s in syms:
            if s not in seen:
                seen.add(s)
                result.append(s)

    _add(CORE_UNIVERSE)
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if not include_etfs and sector == "ETFs":
            continue
        if not include_adr and sector == "International ADR":
            continue
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

# ── Stats ──────────────────────────────────────────────────────
FULL_UNIVERSE     = get_full_universe()
TOTAL_SYMBOLS     = len(FULL_UNIVERSE)
TOTAL_SECTORS     = len(UNIVERSE_BY_SECTOR)

if __name__ == "__main__":
    print(f"Full universe: {TOTAL_SYMBOLS} symbols | {TOTAL_SECTORS} sectors")
    print(f"Core: {len(CORE_UNIVERSE)}")
    for s, syms in UNIVERSE_BY_SECTOR.items():
        print(f"  {s:25s}: {len(syms)}")