# ============================================================
# ALPHAVAULT QUANT — Trading Universe v3.0
# ~900+ symboles Yahoo Finance organisés par secteur
# ✅ US Stocks + ETFs (ADR pour international US-listé)
# ✅ NOUVEAUTÉ v3.0 : Tickers directs internationaux
#    Format yfinance : "MC.PA" / "7203.T" / "HSBA.L" / "SAP.DE"
#    → yfinance natif | IBKR routing via ibkr_executor.py v3.0
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

    "Software_Cloud": [
        "CRM", "ADBE", "NOW", "INTU", "TEAM", "WDAY", "DDOG", "SNOW",
        "ZS", "CRWD", "OKTA", "NET", "HUBS", "VEEV", "MDB", "CFLT",
        "S", "ASAN", "GTLB", "TWLO", "ZM", "DOCU", "PAYC", "PCTY",
        "TTD", "SHOP", "MELI", "SQ", "AFRM", "SOFI", "BOX", "DOCN",
        "RNG", "FIVN", "SMAR", "BRZE", "BILL", "DLO", "SEMR", "SPT",
        "ALTR", "FRSH", "AI", "BBAI", "PLTR", "PATH",
        "PTC", "ANSS", "MANH", "BSY",
    ],

    "Communication_Services": [
        "GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "VZ", "T",
        "TMUS", "CHTR", "LYV", "EA", "TTWO", "SNAP", "PINS", "SPOT",
        "OMC", "PARA", "WBD", "MTCH", "RBLX", "TME", "NTES", "BILI",
        "ZG", "IAC", "FOXA", "FOX", "FWONA",
        "DV", "MGNI", "APP", "PUBM", "CRTO",
    ],

    "Consumer_Discretionary": [
        "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG",
        "TJX", "CMG", "ORLY", "AZO", "ROST", "DHI", "LEN", "MAR",
        "HLT", "GM", "F", "APTV", "UBER", "LYFT", "ABNB", "EXPE",
        "CCL", "RCL", "NCLH", "DAL", "UAL", "AAL", "LUV", "RIVN",
        "DKNG", "MGM", "WYNN", "LVS", "POOL", "WHR", "RL", "PVH",
        "TPR", "VFC", "HBI", "SKX", "DECK", "ONON", "CROX", "COLM",
        "YETI", "CVNA", "KMX", "AN", "PAG", "GPC", "LKQ", "BWA",
        "VC", "LEA", "DRH", "RHP", "HST", "SHO", "PK",
    ],

    "Consumer_Staples": [
        "WMT", "PG", "KO", "PEP", "COST", "PM", "MO", "MDLZ",
        "CL", "EL", "KHC", "GIS", "HSY", "CLX", "KMB", "TSN",
        "HRL", "STZ", "KR", "SFM", "BJ", "GO", "CASY", "CHEF",
        "CAG", "CPB", "MKC", "SJM", "THS", "CENT", "FLO", "LANC",
        "CALM", "POST", "BRBR", "VITL", "MGPI",
    ],

    "Healthcare": [
        "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR",
        "BMY", "AMGN", "MDT", "ISRG", "SYK", "BSX", "EW", "REGN",
        "GILD", "VRTX", "BIIB", "ILMN", "IQV", "MRNA", "PFE",
        "DXCM", "ALGN", "IDXX", "HUM", "CI", "CVS", "ELV", "CNC",
        "MCK", "CAH", "ABC", "HOLX", "BDX", "MTD", "WAT", "A",
        "GEHC", "RMD", "PODD", "TNDM", "INSP", "NVST",
        "COO", "TFX", "HSIC", "PDCO", "PRGO", "JAZZ", "ALKS",
        "EXEL", "BMRN", "SRPT", "RARE", "ACAD",
    ],

    "Biotechnology": [
        "GILD", "BIIB", "MRNA", "REGN", "VRTX", "BMRN", "EXEL",
        "ALNY", "IONS", "NBIX", "RCUS", "ARWR",
        "CRNX", "DNLI", "KYMR", "MGNX", "PTGX", "RVMD", "ROIV",
        "CYTK", "IMVT", "PRAX", "KROS", "ARQT",
        "RCKT", "ERAS", "NUVL", "BPMC", "KRTX", "RVNC",
        "VERV", "BEAM", "EDIT", "CRSP", "NTLA",
        "FATE", "SANA", "BLUE", "IOVA",
    ],

    "Financials": [
        "JPM", "BAC", "WFC", "GS", "MS", "BLK", "SPGI", "MCO",
        "COF", "AXP", "V", "MA", "PYPL", "SCHW", "CB", "AIG",
        "PGR", "ALL", "TRV", "MET", "PRU", "AFL", "USB", "PNC",
        "TFC", "FITB", "KEY", "RF", "HBAN", "CFG", "STT", "BK",
        "CME", "CBOE", "ICE", "NDAQ", "MSCI", "FDS", "HOOD",
        "RJF", "LPLA", "IBKR", "VIRT", "MKTX", "PIPR", "SF",
        "GHL", "EVR", "LAZ", "HLI", "FHN", "WAL",
        "BOKF", "EWBC", "HOPE", "BANC", "CADE",
        "ALLY", "SYF", "DFS", "OMF", "CACC",
        "TREE", "UWMC", "RKT",
    ],

    "Industrials": [
        "HON", "UPS", "RTX", "CAT", "DE", "ETN", "GE", "LMT",
        "NOC", "GD", "BA", "MMM", "EMR", "ITW", "ROK", "PH",
        "DOV", "FAST", "SWK", "SNA", "GNRC", "XYL", "ROP", "FDX",
        "NSC", "UNP", "CSX", "JBHT", "ODFL", "EXPD", "CHRW",
        "GWW", "URI", "PCAR", "CTAS", "VRSK", "RSG", "WM",
        "AXON", "LHX", "HII", "TXT", "HWM", "CARR", "OTIS",
        "TT", "IR", "AME", "HUBB", "BLDR",
        "EXP", "MLM", "VMC", "STRL", "DY", "PWR", "MTZ",
        "EME", "MYRG", "TTEK", "AECOM",
        "XPO", "GXO", "HUBG", "RXO",
    ],

    "Energy": [
        "XOM", "CVX", "COP", "EOG", "PXD", "MPC", "VLO", "PSX",
        "HES", "DVN", "OXY", "SLB", "HAL", "BKR", "CTRA", "EQT",
        "APA", "FANG", "MRO", "KMI", "WMB", "OKE", "LNG",
        "AR", "RRC", "CHK", "SM", "MTDR",
        "NOG", "FLNG", "DINO", "PBF", "CVI",
    ],

    "Materials": [
        "LIN", "APD", "SHW", "PPG", "ECL", "NEM", "FCX", "NUE",
        "STLD", "ALB", "CF", "MOS", "VMC", "MLM", "GOLD", "WPM",
        "AA", "X", "CLF", "MP", "RGLD", "PAAS",
        "AG", "HL", "CDE", "FSM",
        "CC", "OLN", "KRO", "EMN", "AXTA", "HUN", "RPM",
        "AVY", "SEE", "SLGN", "PKG", "IP", "WRK", "SON",
    ],

    "Real_Estate": [
        "PLD", "AMT", "CCI", "EQIX", "SPG", "O", "WELL", "EQR",
        "AVB", "ARE", "BXP", "IRM", "SBAC", "PSA", "EXR", "VICI",
        "GLPI", "NNN", "WPC", "CUBE", "LSI", "NSA", "REXR",
        "FR", "EGP", "STAG", "TRNO", "IIPR", "COLD",
        "ADC", "EPRT", "SRC",
        "NHI", "LTC", "SBRA", "CTRE", "HR", "DOC", "PEAK", "OHI",
    ],

    "Utilities": [
        "NEE", "DUK", "SO", "D", "EXC", "AEP", "XEL", "SRE",
        "ED", "ETR", "PPL", "DTE", "FE", "CMS", "WEC", "ES",
        "AES", "NRG", "AEE", "CNP", "PEG", "EVRG",
        "ENPH", "FSLR", "SEDG", "ARRY", "NEP", "BEP", "AY",
        "CWEN", "HASI",
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
        "ARKF", "ARKQ", "BOTZ",
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
        "DBC", "GSG",
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
        "CORZ", "ARBK",
    ],

    # ── ADRs US-listés (heures NYSE/NASDAQ) ────────────────
    "International_ADR_Europe": [
        "ASML", "SAP", "NVO", "AZN", "GSK", "BP", "SHEL",
        "TTE", "VOD",
        "BCS", "RIO", "BHP", "VALE",
        "UBS", "ING", "SAN", "BBVA",
    ],

    "International_ADR_Asia": [
        "TSM", "TM", "SONY", "HMC", "KYOC", "MFG",
        "BABA", "JD", "PDD", "BIDU", "NIO", "LI", "XPEV",
        "SE", "GRAB", "CPNG",
        "KB", "INFY", "WIT", "HDB", "IBN",
    ],

    "International_ADR_Americas": [
        "MELI", "NU", "STNE", "PAGS", "VTEX",
        "VIST", "YPF",
        "BSAC", "BCH", "CIB", "GGB",
        "TD", "RY", "BNS", "BMO",
    ],

    # ── ✅ NOUVEAUTÉ v3.0 : Tickers directs Europe ─────────
    # Format yfinance natif — routing IBKR via ibkr_executor.py v3.0
    # Trading Permissions requises sur compte IBKR
    "International_Direct_Europe": [
        # France — Euronext Paris (SBF)
        "MC.PA",   # LVMH
        "OR.PA",   # L'Oréal
        "TTE.PA",  # TotalEnergies
        "SAN.PA",  # Sanofi
        "AIR.PA",  # Airbus
        "BNP.PA",  # BNP Paribas
        "ACA.PA",  # Crédit Agricole
        "SU.PA",   # Schneider Electric
        "DG.PA",   # Vinci
        "RMS.PA",  # Hermès
        "KER.PA",  # Kering
        "CAP.PA",  # Capgemini
        "ORA.PA",  # Orange
        "VIE.PA",  # Veolia

        # Netherlands — Euronext Amsterdam (AEB)
        "ASML.AS", # ASML (direct + ADR)
        "HEIA.AS", # Heineken
        "PHIA.AS", # Philips
        "UNA.AS",  # Unilever
        "NN.AS",   # NN Group
        "RAND.AS", # Randstad
        "IMCD.AS", # IMCD
        "WKL.AS",  # Wolters Kluwer

        # Germany — Frankfurt XETRA (IBIS)
        "SAP.DE",  # SAP
        "SIE.DE",  # Siemens
        "BAYN.DE", # Bayer
        "EOAN.DE", # E.ON
        "MBG.DE",  # Mercedes-Benz
        "BMW.DE",  # BMW
        "VOW3.DE", # Volkswagen
        "ALV.DE",  # Allianz
        "MUV2.DE", # Munich Re
        "DTE.DE",  # Deutsche Telekom
        "DBK.DE",  # Deutsche Bank
        "ADS.DE",  # Adidas
        "1COV.DE", # Covestro
        "DHER.DE", # Delivery Hero

        # United Kingdom — LSE (LSE)
        "HSBA.L",  # HSBC
        "BP.L",    # BP
        "SHEL.L",  # Shell
        "GSK.L",   # GSK
        "AZN.L",   # AstraZeneca
        "ULVR.L",  # Unilever UK
        "RIO.L",   # Rio Tinto
        "AAL.L",   # Anglo American
        "LLOY.L",  # Lloyds Banking
        "BARC.L",  # Barclays
        "VOD.L",   # Vodafone
        "BT-A.L",  # BT Group
        "DGE.L",   # Diageo
        "RB.L",    # Reckitt

        # Switzerland — SIX (EBS)
        "NESN.SW", # Nestlé
        "NOVN.SW", # Novartis
        "ROG.SW",  # Roche
        "ABBN.SW", # ABB
        "UBSG.SW", # UBS Group
        "CSGN.SW", # Credit Suisse (surveillance)
        "ZURN.SW", # Zurich Insurance
        "LONN.SW", # Lonza

        # Denmark — Copenhagen (CPH)
        "NOVO-B.CO", # Novo Nordisk
        "MAERSK-B.CO", # A.P. Moller-Maersk
        "ORSTED.CO",   # Ørsted
        "CARL-B.CO",   # Carlsberg

        # Sweden — Stockholm (SFB)
        "VOLV-B.ST", # Volvo
        "ERIC-B.ST", # Ericsson
        "ATCO-A.ST", # Atlas Copco
        "SEB-A.ST",  # SEB Bank
        "SWED-A.ST", # Swedbank
        "HM-B.ST",   # H&M

        # Norway — Oslo (OSE)
        "EQNR.OL", # Equinor
        "TEL.OL",  # Telenor
        "DNB.OL",  # DNB Bank
        "MOWI.OL", # Mowi (salmon)

        # Spain — Madrid (BME)
        "ITX.MC",  # Inditex (Zara)
        "IBE.MC",  # Iberdrola
        "SAN.MC",  # Banco Santander
        "BBVA.MC", # BBVA
        "REP.MC",  # Repsol

        # Italy — Milan (BVME)
        "ENI.MI",  # ENI
        "ENEL.MI", # Enel
        "ISP.MI",  # Intesa Sanpaolo
        "UCG.MI",  # UniCredit
        "LUX.MI",  # Luxottica (EssilorLuxottica)
        "STM.MI",  # STMicroelectronics
    ],

    # ── ✅ NOUVEAUTÉ v3.0 : Tickers directs Asie-Pacifique ─
    "International_Direct_Asia": [
        # Japan — Tokyo (TSEJ)
        "7203.T",  # Toyota
        "6758.T",  # Sony
        "9984.T",  # SoftBank
        "6861.T",  # Keyence
        "8306.T",  # Mitsubishi UFJ
        "7974.T",  # Nintendo
        "9432.T",  # NTT
        "6501.T",  # Hitachi
        "6902.T",  # DENSO
        "4519.T",  # Chugai Pharmaceutical
        "4568.T",  # Daiichi Sankyo
        "8058.T",  # Mitsubishi Corp
        "8001.T",  # Itochu
        "3382.T",  # Seven & i Holdings
        "9433.T",  # KDDI
        "7267.T",  # Honda
        "6752.T",  # Panasonic
        "4543.T",  # Terumo
        "6594.T",  # Nidec
        "4661.T",  # Oriental Land (Tokyo Disney)

        # Hong Kong — HKEX
        "0700.HK", # Tencent
        "9988.HK", # Alibaba (HK)
        "0941.HK", # China Mobile
        "1398.HK", # ICBC
        "3690.HK", # Meituan
        "2318.HK", # Ping An Insurance
        "1299.HK", # AIA Group
        "0005.HK", # HSBC Holdings (HK)
        "2269.HK", # WuXi Biologics
        "9999.HK", # NetEase (HK)
        "1810.HK", # Xiaomi
        "9618.HK", # JD.com (HK)

        # Australia — ASX
        "CBA.AX",  # Commonwealth Bank
        "BHP.AX",  # BHP Group
        "CSL.AX",  # CSL (biotech)
        "ANZ.AX",  # ANZ Bank
        "WBC.AX",  # Westpac
        "NAB.AX",  # National Australia Bank
        "WES.AX",  # Wesfarmers
        "WOW.AX",  # Woolworths
        "MQG.AX",  # Macquarie Group
        "RIO.AX",  # Rio Tinto (AX)
        "FMG.AX",  # Fortescue Metals

        # South Korea — KSE
        "005930.KS", # Samsung Electronics
        "000660.KS", # SK Hynix
        "035420.KS", # NAVER
        "005490.KS", # POSCO
        "051910.KS", # LG Chem
        "035720.KS", # Kakao

        # Singapore — SGX
        "D05.SI",  # DBS Group
        "O39.SI",  # OCBC
        "U11.SI",  # UOB
        "C6L.SI",  # Singapore Airlines
        "Z74.SI",  # Singtel
    ],

    # ── ✅ NOUVEAUTÉ v3.0 : Tickers directs Canada ─────────
    "International_Direct_Canada": [
        # Toronto Stock Exchange (TSX)
        "SHOP.TO",  # Shopify
        "RY.TO",    # Royal Bank of Canada
        "TD.TO",    # TD Bank
        "BNS.TO",   # Bank of Nova Scotia
        "BMO.TO",   # Bank of Montreal
        "CNR.TO",   # Canadian National Railway
        "ENB.TO",   # Enbridge
        "TRP.TO",   # TC Energy
        "ABX.TO",   # Barrick Gold
        "NTR.TO",   # Nutrien
        "SU.TO",    # Suncor Energy
        "CNQ.TO",   # Canadian Natural Resources
        "ATD.TO",   # Alimentation Couche-Tard
        "MFC.TO",   # Manulife
        "SLF.TO",   # Sun Life Financial
        "T.TO",     # Telus
        "BCE.TO",   # BCE Inc
        "CCO.TO",   # Cameco
        "WCN.TO",   # Waste Connections
        "TRI.TO",   # Thomson Reuters
        "CP.TO",    # Canadian Pacific
        "QSR.TO",   # Restaurant Brands
    ],

    "Small_Cap_Growth": [
        "CELH", "HIMS", "TMDX", "RXRX", "ACVA",
        "AMBA", "SWAV", "AGIO", "ACLX", "ADMA",
        "AVPT", "EVGO", "BLNK",
        "CHPT", "JOBY", "ACHR", "RKLB",
        "SPCE", "LUNR", "RDW", "AST",
    ],
}

# ── Core universe (toujours traité en priorité, intraday + LLM) ──
CORE_UNIVERSE: List[str] = [
    # Macro ETFs
    "SPY", "QQQ", "IWM", "GLD", "TLT",
    # Mega-cap tech US
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
    "META", "TSLA", "AVGO", "AMD",
    # Financials US
    "JPM", "GS", "V", "MA",
    # Healthcare US
    "UNH", "LLY", "JNJ",
    # Energy / Materials US
    "XOM", "CVX",
    # Consumer US
    "HD", "COST", "WMT",
    # Top internationaux directs (liquides, données fiables)
    "ASML.AS", "SAP.DE", "NESN.SW", "NOVO-B.CO",
    "MC.PA", "HSBA.L", "AZN.L",
    "7203.T", "0700.HK", "TSM",
    "SHOP.TO", "RY.TO",
]

# ── Catégories "data only" (formation modèles, pas ordres réels) ─
# Ces tickers sont dans l'univers pour l'entraînement ML
# mais ne sont pas exécutés si la session est fermée
DATA_ONLY_CATEGORIES = {
    "International_Direct_Asia",    # Heures asiatiques (marché fermé pendant US)
    "International_Direct_Europe",  # Heures EU (partiellement ouvertes pendant US)
    "International_Direct_Canada",  # TSX = mêmes heures que US ✅ (peut être exécuté)
}

def get_full_universe(
    include_etfs:          bool = True,
    include_adr:           bool = True,
    include_crypto:        bool = True,
    include_smallcap:      bool = True,
    include_biotech:       bool = True,
    include_international: bool = True,
) -> List[str]:
    """
    Retourne la liste complète dédupliquée (~900+ symboles).
    Le core universe est toujours en tête pour priorité de traitement.

    Args:
        include_international: Inclure les tickers directs EU/Asie/Canada
                               (format yfinance : "MC.PA", "7203.T", etc.)
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

    # Filtres optionnels
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
    if not include_international:
        SKIP_KEYS.update([
            "International_Direct_Europe",
            "International_Direct_Asia",
            "International_Direct_Canada",
        ])

    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if sector not in SKIP_KEYS:
            _add(syms)

    return result

def get_us_tradeable_universe() -> List[str]:
    """
    Retourne uniquement les symboles tradables pendant les heures US.
    Exclut les tickers asiatiques (marchés fermés 9h30-16h EST).
    Inclut EU (partiellement ouvert) et Canada (même heures).
    """
    skip = {"International_Direct_Asia"}
    seen, result = set(), []

    def _add(syms):
        for s in syms:
            if s and s not in seen:
                seen.add(s)
                result.append(s)

    _add(CORE_UNIVERSE)
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if sector not in skip:
            _add(syms)
    return result

def get_international_direct_universe() -> List[str]:
    """Retourne uniquement les tickers directs internationaux (non-ADR)."""
    result = []
    for key in [
        "International_Direct_Europe",
        "International_Direct_Asia",
        "International_Direct_Canada",
    ]:
        result.extend(UNIVERSE_BY_SECTOR.get(key, []))
    return list(dict.fromkeys(result))

def get_sector(symbol: str) -> str:
    """Retourne le secteur d'un symbole."""
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        if symbol in syms:
            return sector
    return "Other"

def get_exchange_from_ticker(symbol: str) -> str:
    """
    Retourne l'exchange IBKR attendu pour un ticker yfinance.
    Utilisé pour le routage dans ibkr_executor.py v3.0.
    """
    SUFFIX_MAP = {
        ".PA": "SBF",   ".AS": "AEB",   ".DE": "IBIS",  ".L":  "LSE",
        ".SW": "EBS",   ".CO": "CPH",   ".ST": "SFB",   ".OL": "OSE",
        ".MC": "BME",   ".MI": "BVME",  ".T":  "TSEJ",  ".HK": "HKEX",
        ".AX": "ASX",   ".SI": "SGX",   ".KS": "KSE",   ".TO": "TSX",
        ".TW": "TWSE",  ".NS": "NSE",   ".BO": "BSE",   ".SA": "BOVESPA",
    }
    sym_upper = symbol.upper()
    for suffix, exchange in sorted(SUFFIX_MAP.items(), key=lambda x: -len(x[0])):
        if sym_upper.endswith(suffix.upper()):
            return exchange
    return "SMART"  # US par défaut

def get_core_universe() -> List[str]:
    return list(CORE_UNIVERSE)

def get_etf_universe() -> List[str]:
    result = []
    for key in [
        "ETFs_US_Broad", "ETFs_Sector", "ETFs_Fixed_Income",
        "ETFs_Commodities_Macro", "ETFs_Leveraged_Inverse",
    ]:
        result.extend(UNIVERSE_BY_SECTOR.get(key, []))
    return list(dict.fromkeys(result))

# ── Stats ───────────────────────────────────────────────────────
FULL_UNIVERSE          = get_full_universe()
US_TRADEABLE_UNIVERSE  = get_us_tradeable_universe()
INTL_DIRECT_UNIVERSE   = get_international_direct_universe()
TOTAL_SYMBOLS          = len(FULL_UNIVERSE)
TOTAL_SECTORS          = len(UNIVERSE_BY_SECTOR)

if __name__ == "__main__":
    print(f"\n{'='*55}")
    print(f"  AlphaVault Universe v3.0")
    print(f"{'='*55}")
    print(f"  Full universe        : {TOTAL_SYMBOLS} symbols")
    print(f"  US tradeable         : {len(US_TRADEABLE_UNIVERSE)} symbols")
    print(f"  International direct : {len(INTL_DIRECT_UNIVERSE)} symbols")
    print(f"  Core universe        : {len(CORE_UNIVERSE)} symbols")
    print(f"  Total sectors        : {TOTAL_SECTORS}")
    print(f"\n  Breakdown par secteur:")
    for s, syms in UNIVERSE_BY_SECTOR.items():
        intl = "🌍" if "International_Direct" in s else "  "
        print(f"    {intl} {s:40s}: {len(syms):3d}")
    print(f"\n  Exemples tickers directs :")
    test_tickers = ["MC.PA", "SAP.DE", "HSBA.L", "ASML.AS",
                    "NESN.SW", "7203.T", "0700.HK", "SHOP.TO"]
    for t in test_tickers:
        exch = get_exchange_from_ticker(t)
        print(f"    {t:15s} → IBKR exchange: {exch}")
    print(f"{'='*55}\n")