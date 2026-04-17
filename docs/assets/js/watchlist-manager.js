// ============================================================
// watchlist-manager.js — AlphaVault Quant v3.0
// ✅ ~700 symboles Yahoo Finance (S&P500 + NASDAQ100 + ETFs + Popular)
// ✅ Gestion watchlist localStorage
// ✅ Secteurs, pagination, search
// ✅ Données live : price, financials, news, earnings via Finance Hub
// ============================================================

const WatchlistManager = (() => {

  // ── Finance Hub URL ──────────────────────────────────────
  const YAHOO_PROXY = 'https://yahoo-proxy.raphnardone.workers.dev';

  // ── LocalStorage Keys ────────────────────────────────────
  const LS_KEY       = 'av_watchlist_v2';
  const LS_STARRED   = 'av_starred_v2';
  const PAGE_SIZE    = 50;

  // ── State ────────────────────────────────────────────────
  let _currentPage    = 1;
  let _currentSector  = 'All';
  let _currentSearch  = '';
  let _signalData     = {};   // Latest signal data from JSON
  let _liveCache      = {};   // Live price cache { sym: { price, chg, ... } }
  let _watchlist      = [];
  let _starred        = [];

  // ════════════════════════════════════════════════════════
  // UNIVERSE COMPLET (~700 symboles Yahoo Finance)
  // ════════════════════════════════════════════════════════
  const UNIVERSE = {

    // ── Technology ─────────────────────────────────────────
    Technology: [
      { s:'AAPL',  n:'Apple Inc.' },
      { s:'MSFT',  n:'Microsoft Corp.' },
      { s:'NVDA',  n:'NVIDIA Corp.' },
      { s:'AVGO',  n:'Broadcom Inc.' },
      { s:'ORCL',  n:'Oracle Corp.' },
      { s:'AMD',   n:'Advanced Micro Devices' },
      { s:'INTC',  n:'Intel Corp.' },
      { s:'QCOM',  n:'Qualcomm Inc.' },
      { s:'TXN',   n:'Texas Instruments' },
      { s:'AMAT',  n:'Applied Materials' },
      { s:'LRCX',  n:'Lam Research' },
      { s:'KLAC',  n:'KLA Corp.' },
      { s:'ADI',   n:'Analog Devices' },
      { s:'MCHP',  n:'Microchip Technology' },
      { s:'CDNS',  n:'Cadence Design' },
      { s:'SNPS',  n:'Synopsys Inc.' },
      { s:'ANSS',  n:'ANSYS Inc.' },
      { s:'FTNT',  n:'Fortinet Inc.' },
      { s:'CTSH',  n:'Cognizant Technology' },
      { s:'IT',    n:'Gartner Inc.' },
      { s:'AKAM',  n:'Akamai Technologies' },
      { s:'CDW',   n:'CDW Corp.' },
      { s:'NTAP',  n:'NetApp Inc.' },
      { s:'WDC',   n:'Western Digital' },
      { s:'STX',   n:'Seagate Technology' },
      { s:'HPE',   n:'Hewlett Packard Enterprise' },
      { s:'HPQ',   n:'HP Inc.' },
      { s:'DELL',  n:'Dell Technologies' },
      { s:'ZBRA',  n:'Zebra Technologies' },
      { s:'KEYS',  n:'Keysight Technologies' },
      { s:'TDY',   n:'Teledyne Technologies' },
      { s:'MPWR',  n:'Monolithic Power Systems' },
      { s:'ENTG',  n:'Entegris Inc.' },
      { s:'SWKS',  n:'Skyworks Solutions' },
      { s:'QRVO',  n:'Qorvo Inc.' },
      { s:'JNPR',  n:'Juniper Networks' },
      { s:'MU',    n:'Micron Technology' },
      { s:'ON',    n:'ON Semiconductor' },
      { s:'GEN',   n:'Gen Digital Inc.' },
      { s:'CTXS',  n:'Citrix Systems' },
      { s:'FFIV',  n:'F5 Inc.' },
      { s:'GDDY',  n:'GoDaddy Inc.' },
      { s:'SAIC',  n:'Science Applications' },
      { s:'BAH',   n:'Booz Allen Hamilton' },
      { s:'LDOS',  n:'Leidos Holdings' },
      { s:'CACI',  n:'CACI International' },
      { s:'EPAM',  n:'EPAM Systems' },
      { s:'DXC',   n:'DXC Technology' },
    ],

    // ── Communication Services ─────────────────────────────
    'Comm. Services': [
      { s:'GOOGL', n:'Alphabet Inc. (A)' },
      { s:'GOOG',  n:'Alphabet Inc. (C)' },
      { s:'META',  n:'Meta Platforms' },
      { s:'NFLX',  n:'Netflix Inc.' },
      { s:'DIS',   n:'Walt Disney Co.' },
      { s:'CMCSA', n:'Comcast Corp.' },
      { s:'VZ',    n:'Verizon Communications' },
      { s:'T',     n:'AT&T Inc.' },
      { s:'TMUS',  n:'T-Mobile US' },
      { s:'CHTR',  n:'Charter Communications' },
      { s:'FOX',   n:'Fox Corp. (B)' },
      { s:'FOXA',  n:'Fox Corp. (A)' },
      { s:'OMC',   n:'Omnicom Group' },
      { s:'IPG',   n:'Interpublic Group' },
      { s:'NWSA',  n:'News Corp (A)' },
      { s:'PARA',  n:'Paramount Global' },
      { s:'WBD',   n:'Warner Bros. Discovery' },
      { s:'LYV',   n:'Live Nation Entertainment' },
      { s:'EA',    n:'Electronic Arts' },
      { s:'TTWO',  n:'Take-Two Interactive' },
      { s:'MTCH',  n:'Match Group' },
      { s:'RBLX',  n:'Roblox Corp.' },
      { s:'SNAP',  n:'Snap Inc.' },
      { s:'PINS',  n:'Pinterest Inc.' },
      { s:'SPOT',  n:'Spotify Technology' },
      { s:'LUMN',  n:'Lumen Technologies' },
    ],

    // ── Consumer Discretionary ─────────────────────────────
    'Cons. Discret.': [
      { s:'AMZN',  n:'Amazon.com' },
      { s:'TSLA',  n:'Tesla Inc.' },
      { s:'HD',    n:'Home Depot Inc.' },
      { s:'MCD',   n:"McDonald's Corp." },
      { s:'NKE',   n:'Nike Inc.' },
      { s:'LOW',   n:"Lowe's Companies" },
      { s:'SBUX',  n:'Starbucks Corp.' },
      { s:'BKNG',  n:'Booking Holdings' },
      { s:'TJX',   n:'TJX Companies' },
      { s:'CMG',   n:'Chipotle Mexican Grill' },
      { s:'ORLY',  n:"O'Reilly Automotive" },
      { s:'AZO',   n:'AutoZone Inc.' },
      { s:'ROST',  n:'Ross Stores Inc.' },
      { s:'DHI',   n:'D.R. Horton Inc.' },
      { s:'LEN',   n:'Lennar Corp.' },
      { s:'PHM',   n:'PulteGroup Inc.' },
      { s:'MAR',   n:'Marriott International' },
      { s:'HLT',   n:'Hilton Worldwide' },
      { s:'GM',    n:'General Motors' },
      { s:'F',     n:'Ford Motor Co.' },
      { s:'APTV',  n:'Aptiv PLC' },
      { s:'GNTX',  n:'Gentex Corp.' },
      { s:'BWA',   n:'BorgWarner Inc.' },
      { s:'MHK',   n:'Mohawk Industries' },
      { s:'POOL',  n:'Pool Corp.' },
      { s:'NVR',   n:'NVR Inc.' },
      { s:'TOL',   n:'Toll Brothers Inc.' },
      { s:'RIVN',  n:'Rivian Automotive' },
      { s:'LCID',  n:'Lucid Group' },
      { s:'UBER',  n:'Uber Technologies' },
      { s:'LYFT',  n:'Lyft Inc.' },
      { s:'ABNB',  n:'Airbnb Inc.' },
      { s:'EXPE',  n:'Expedia Group' },
      { s:'TRIP',  n:'TripAdvisor Inc.' },
      { s:'DKNG',  n:'DraftKings Inc.' },
      { s:'MGM',   n:'MGM Resorts' },
      { s:'WYNN',  n:'Wynn Resorts' },
      { s:'LVS',   n:'Las Vegas Sands' },
      { s:'CCL',   n:'Carnival Corp.' },
      { s:'RCL',   n:'Royal Caribbean' },
      { s:'NCLH',  n:'Norwegian Cruise Line' },
      { s:'DAL',   n:'Delta Air Lines' },
      { s:'UAL',   n:'United Airlines' },
      { s:'AAL',   n:'American Airlines' },
      { s:'LUV',   n:'Southwest Airlines' },
      { s:'ALK',   n:'Alaska Air Group' },
    ],

    // ── Consumer Staples ───────────────────────────────────
    'Cons. Staples': [
      { s:'WMT',   n:'Walmart Inc.' },
      { s:'PG',    n:'Procter & Gamble' },
      { s:'KO',    n:'Coca-Cola Co.' },
      { s:'PEP',   n:'PepsiCo Inc.' },
      { s:'COST',  n:'Costco Wholesale' },
      { s:'PM',    n:'Philip Morris International' },
      { s:'MO',    n:'Altria Group' },
      { s:'MDLZ',  n:'Mondelez International' },
      { s:'CL',    n:'Colgate-Palmolive' },
      { s:'EL',    n:'Estee Lauder Companies' },
      { s:'KHC',   n:'Kraft Heinz Co.' },
      { s:'GIS',   n:'General Mills' },
      { s:'K',     n:"Kellogg's Co." },
      { s:'HSY',   n:'Hershey Co.' },
      { s:'SJM',   n:'J.M. Smucker' },
      { s:'CAG',   n:'Conagra Brands' },
      { s:'MKC',   n:'McCormick & Co.' },
      { s:'CLX',   n:'Clorox Co.' },
      { s:'CHD',   n:'Church & Dwight' },
      { s:'KMB',   n:'Kimberly-Clark' },
      { s:'TSN',   n:'Tyson Foods' },
      { s:'HRL',   n:'Hormel Foods' },
      { s:'TAP',   n:'Molson Coors Beverage' },
      { s:'STZ',   n:'Constellation Brands' },
      { s:'BG',    n:'Bunge Global' },
      { s:'KR',    n:'Kroger Co.' },
      { s:'SFM',   n:'Sprouts Farmers Market' },
      { s:'GO',    n:'Grocery Outlet Holding' },
    ],

    // ── Healthcare ─────────────────────────────────────────
    Healthcare: [
      { s:'UNH',   n:'UnitedHealth Group' },
      { s:'JNJ',   n:'Johnson & Johnson' },
      { s:'LLY',   n:'Eli Lilly & Co.' },
      { s:'ABBV',  n:'AbbVie Inc.' },
      { s:'MRK',   n:'Merck & Co.' },
      { s:'TMO',   n:'Thermo Fisher Scientific' },
      { s:'ABT',   n:'Abbott Laboratories' },
      { s:'DHR',   n:'Danaher Corp.' },
      { s:'BMY',   n:'Bristol-Myers Squibb' },
      { s:'AMGN',  n:'Amgen Inc.' },
      { s:'MDT',   n:'Medtronic PLC' },
      { s:'ISRG',  n:'Intuitive Surgical' },
      { s:'SYK',   n:'Stryker Corp.' },
      { s:'BSX',   n:'Boston Scientific' },
      { s:'EW',    n:'Edwards Lifesciences' },
      { s:'REGN',  n:'Regeneron Pharmaceuticals' },
      { s:'GILD',  n:'Gilead Sciences' },
      { s:'VRTX',  n:'Vertex Pharmaceuticals' },
      { s:'BIIB',  n:'Biogen Inc.' },
      { s:'ILMN',  n:'Illumina Inc.' },
      { s:'IQV',   n:'IQVIA Holdings' },
      { s:'ZBH',   n:'Zimmer Biomet Holdings' },
      { s:'BAX',   n:'Baxter International' },
      { s:'BDX',   n:'Becton Dickinson' },
      { s:'HOLX',  n:'Hologic Inc.' },
      { s:'DXCM',  n:'DexCom Inc.' },
      { s:'ALGN',  n:'Align Technology' },
      { s:'IDXX',  n:'IDEXX Laboratories' },
      { s:'MTD',   n:'Mettler-Toledo International' },
      { s:'WAT',   n:'Waters Corp.' },
      { s:'MRNA',  n:'Moderna Inc.' },
      { s:'PFE',   n:'Pfizer Inc.' },
      { s:'CTLT',  n:'Catalent Inc.' },
      { s:'TECH',  n:'Bio-Techne Corp.' },
      { s:'CRL',   n:'Charles River Laboratories' },
      { s:'HUM',   n:'Humana Inc.' },
      { s:'CI',    n:'Cigna Group' },
      { s:'CVS',   n:'CVS Health Corp.' },
      { s:'ELV',   n:'Elevance Health' },
      { s:'CNC',   n:'Centene Corp.' },
      { s:'MOH',   n:'Molina Healthcare' },
      { s:'MCK',   n:'McKesson Corp.' },
      { s:'CAH',   n:'Cardinal Health' },
      { s:'ABC',   n:'AmerisourceBergen' },
    ],

    // ── Financials ─────────────────────────────────────────
    Financials: [
      { s:'JPM',   n:'JPMorgan Chase' },
      { s:'BAC',   n:'Bank of America' },
      { s:'WFC',   n:'Wells Fargo & Co.' },
      { s:'GS',    n:'Goldman Sachs' },
      { s:'MS',    n:'Morgan Stanley' },
      { s:'BLK',   n:'BlackRock Inc.' },
      { s:'SPGI',  n:'S&P Global Inc.' },
      { s:'MCO',   n:"Moody's Corp." },
      { s:'COF',   n:'Capital One Financial' },
      { s:'AXP',   n:'American Express' },
      { s:'V',     n:'Visa Inc.' },
      { s:'MA',    n:'Mastercard Inc.' },
      { s:'PYPL',  n:'PayPal Holdings' },
      { s:'SCHW',  n:'Charles Schwab' },
      { s:'CB',    n:'Chubb Ltd.' },
      { s:'AIG',   n:'American International Group' },
      { s:'PGR',   n:'Progressive Corp.' },
      { s:'ALL',   n:'Allstate Corp.' },
      { s:'TRV',   n:'Travelers Companies' },
      { s:'MET',   n:'MetLife Inc.' },
      { s:'PRU',   n:'Prudential Financial' },
      { s:'HIG',   n:'Hartford Financial Services' },
      { s:'AFL',   n:'Aflac Inc.' },
      { s:'USB',   n:'U.S. Bancorp' },
      { s:'PNC',   n:'PNC Financial Services' },
      { s:'TFC',   n:'Truist Financial' },
      { s:'FITB',  n:'Fifth Third Bancorp' },
      { s:'KEY',   n:'KeyCorp' },
      { s:'RF',    n:'Regions Financial' },
      { s:'HBAN',  n:'Huntington Bancshares' },
      { s:'CFG',   n:'Citizens Financial Group' },
      { s:'ZION',  n:'Zions Bancorporation' },
      { s:'CMA',   n:'Comerica Inc.' },
      { s:'NTRS',  n:'Northern Trust' },
      { s:'STT',   n:'State Street Corp.' },
      { s:'BK',    n:'Bank of New York Mellon' },
      { s:'RJF',   n:'Raymond James Financial' },
      { s:'LPLA',  n:'LPL Financial Holdings' },
      { s:'NDAQ',  n:'Nasdaq Inc.' },
      { s:'ICE',   n:'Intercontinental Exchange' },
      { s:'CME',   n:'CME Group' },
      { s:'CBOE',  n:'Cboe Global Markets' },
      { s:'FDS',   n:'FactSet Research Systems' },
      { s:'MSCI',  n:'MSCI Inc.' },
      { s:'HOOD',  n:'Robinhood Markets' },
    ],

    // ── Industrials ────────────────────────────────────────
    Industrials: [
      { s:'HON',   n:'Honeywell International' },
      { s:'UPS',   n:'United Parcel Service' },
      { s:'RTX',   n:'Raytheon Technologies' },
      { s:'CAT',   n:'Caterpillar Inc.' },
      { s:'DE',    n:'Deere & Company' },
      { s:'ETN',   n:'Eaton Corp.' },
      { s:'GE',    n:'General Electric' },
      { s:'LMT',   n:'Lockheed Martin' },
      { s:'NOC',   n:'Northrop Grumman' },
      { s:'GD',    n:'General Dynamics' },
      { s:'BA',    n:'Boeing Co.' },
      { s:'MMM',   n:'3M Co.' },
      { s:'EMR',   n:'Emerson Electric' },
      { s:'ITW',   n:'Illinois Tool Works' },
      { s:'ROK',   n:'Rockwell Automation' },
      { s:'PH',    n:'Parker-Hannifin Corp.' },
      { s:'DOV',   n:'Dover Corp.' },
      { s:'IEX',   n:'IDEX Corp.' },
      { s:'FAST',  n:'Fastenal Co.' },
      { s:'SWK',   n:'Stanley Black & Decker' },
      { s:'SNA',   n:'Snap-on Inc.' },
      { s:'GNRC',  n:'Generac Holdings' },
      { s:'XYL',   n:'Xylem Inc.' },
      { s:'ROP',   n:'Roper Technologies' },
      { s:'FDX',   n:'FedEx Corp.' },
      { s:'NSC',   n:'Norfolk Southern' },
      { s:'UNP',   n:'Union Pacific Corp.' },
      { s:'CSX',   n:'CSX Corp.' },
      { s:'JBHT',  n:'J.B. Hunt Transport' },
      { s:'ODFL',  n:'Old Dominion Freight Line' },
      { s:'EXPD',  n:'Expeditors International' },
      { s:'CHRW',  n:'C.H. Robinson Worldwide' },
      { s:'GWW',   n:'W.W. Grainger' },
      { s:'URI',   n:'United Rentals' },
      { s:'PCAR',  n:'PACCAR Inc.' },
      { s:'CTAS',  n:'Cintas Corp.' },
      { s:'VRSK',  n:'Verisk Analytics' },
      { s:'RSG',   n:'Republic Services' },
      { s:'WM',    n:'Waste Management' },
      { s:'AWK',   n:'American Water Works' },
      { s:'CPRT',  n:'Copart Inc.' },
      { s:'BR',    n:'Broadridge Financial' },
      { s:'L3H',   n:'L3Harris Technologies' },
      { s:'HII',   n:'Huntington Ingalls' },
      { s:'TXT',   n:'Textron Inc.' },
      { s:'HWM',   n:'Howmet Aerospace' },
      { s:'AXON',  n:'Axon Enterprise' },
    ],

    // ── Energy ─────────────────────────────────────────────
    Energy: [
      { s:'XOM',   n:'Exxon Mobil' },
      { s:'CVX',   n:'Chevron Corp.' },
      { s:'COP',   n:'ConocoPhillips' },
      { s:'EOG',   n:'EOG Resources' },
      { s:'PXD',   n:'Pioneer Natural Resources' },
      { s:'MPC',   n:'Marathon Petroleum' },
      { s:'VLO',   n:'Valero Energy' },
      { s:'PSX',   n:'Phillips 66' },
      { s:'HES',   n:'Hess Corp.' },
      { s:'DVN',   n:'Devon Energy' },
      { s:'OXY',   n:'Occidental Petroleum' },
      { s:'SLB',   n:'SLB (Schlumberger)' },
      { s:'HAL',   n:'Halliburton Co.' },
      { s:'BKR',   n:'Baker Hughes' },
      { s:'CTRA',  n:'Coterra Energy' },
      { s:'EQT',   n:'EQT Corp.' },
      { s:'APA',   n:'APA Corp.' },
      { s:'OVV',   n:'Ovintiv Inc.' },
      { s:'FANG',  n:'Diamondback Energy' },
      { s:'MRO',   n:'Marathon Oil Corp.' },
      { s:'CNX',   n:'CNX Resources' },
      { s:'CHK',   n:'Chesapeake Energy' },
      { s:'AM',    n:'Antero Midstream' },
      { s:'TRGP',  n:'Targa Resources' },
      { s:'KMI',   n:'Kinder Morgan' },
      { s:'WMB',   n:'Williams Companies' },
      { s:'OKE',   n:'ONEOK Inc.' },
      { s:'LNG',   n:'Cheniere Energy' },
    ],

    // ── Materials ──────────────────────────────────────────
    Materials: [
      { s:'LIN',   n:'Linde PLC' },
      { s:'APD',   n:'Air Products & Chemicals' },
      { s:'SHW',   n:'Sherwin-Williams' },
      { s:'PPG',   n:'PPG Industries' },
      { s:'ECL',   n:'Ecolab Inc.' },
      { s:'IFF',   n:'International Flavors' },
      { s:'NEM',   n:'Newmont Corp.' },
      { s:'FCX',   n:'Freeport-McMoRan' },
      { s:'NUE',   n:'Nucor Corp.' },
      { s:'STLD',  n:'Steel Dynamics' },
      { s:'RS',    n:'Reliance Steel & Aluminum' },
      { s:'WRK',   n:'WestRock Co.' },
      { s:'ALB',   n:'Albemarle Corp.' },
      { s:'FMC',   n:'FMC Corp.' },
      { s:'CF',    n:'CF Industries Holdings' },
      { s:'MOS',   n:'Mosaic Co.' },
      { s:'VMC',   n:'Vulcan Materials' },
      { s:'MLM',   n:'Martin Marietta Materials' },
      { s:'CCK',   n:'Crown Holdings' },
      { s:'RPM',   n:'RPM International' },
      { s:'GOLD',  n:'Barrick Gold' },
      { s:'PAAS',  n:'Pan American Silver' },
      { s:'WPM',   n:'Wheaton Precious Metals' },
      { s:'AA',    n:'Alcoa Corp.' },
      { s:'X',     n:'United States Steel' },
      { s:'CLF',   n:'Cleveland-Cliffs' },
      { s:'MP',    n:'MP Materials' },
    ],

    // ── Real Estate ────────────────────────────────────────
    'Real Estate': [
      { s:'PLD',   n:'Prologis Inc.' },
      { s:'AMT',   n:'American Tower' },
      { s:'CCI',   n:'Crown Castle' },
      { s:'EQIX',  n:'Equinix Inc.' },
      { s:'SPG',   n:'Simon Property Group' },
      { s:'O',     n:'Realty Income Corp.' },
      { s:'WELL',  n:'Welltower Inc.' },
      { s:'EQR',   n:'Equity Residential' },
      { s:'AVB',   n:'AvalonBay Communities' },
      { s:'ARE',   n:'Alexandria Real Estate' },
      { s:'BXP',   n:'Boston Properties' },
      { s:'VNO',   n:'Vornado Realty Trust' },
      { s:'IRM',   n:'Iron Mountain' },
      { s:'SBAC',  n:'SBA Communications' },
      { s:'PSA',   n:'Public Storage' },
      { s:'EXR',   n:'Extra Space Storage' },
      { s:'CUBE',  n:'CubeSmart' },
      { s:'NSA',   n:'National Storage Affiliates' },
      { s:'REXR',  n:'Rexford Industrial Realty' },
      { s:'VICI',  n:'VICI Properties' },
      { s:'GLPI',  n:'Gaming & Leisure Properties' },
      { s:'EPR',   n:'EPR Properties' },
      { s:'NNN',   n:'NNN REIT Inc.' },
      { s:'WPC',   n:'W. P. Carey Inc.' },
      { s:'STOR',  n:'STORE Capital' },
    ],

    // ── Utilities ──────────────────────────────────────────
    Utilities: [
      { s:'NEE',   n:'NextEra Energy' },
      { s:'DUK',   n:'Duke Energy' },
      { s:'SO',    n:'Southern Co.' },
      { s:'D',     n:'Dominion Energy' },
      { s:'EXC',   n:'Exelon Corp.' },
      { s:'AEP',   n:'American Electric Power' },
      { s:'XEL',   n:'Xcel Energy' },
      { s:'SRE',   n:'Sempra Energy' },
      { s:'ED',    n:'Consolidated Edison' },
      { s:'ETR',   n:'Entergy Corp.' },
      { s:'PPL',   n:'PPL Corp.' },
      { s:'DTE',   n:'DTE Energy' },
      { s:'FE',    n:'FirstEnergy Corp.' },
      { s:'CMS',   n:'CMS Energy' },
      { s:'WEC',   n:'WEC Energy Group' },
      { s:'ES',    n:'Eversource Energy' },
      { s:'EVRG',  n:'Evergy Inc.' },
      { s:'NI',    n:'NiSource Inc.' },
      { s:'LNT',   n:'Alliant Energy' },
      { s:'PNW',   n:'Pinnacle West Capital' },
      { s:'AES',   n:'AES Corp.' },
      { s:'NRG',   n:'NRG Energy' },
      { s:'AEE',   n:'Ameren Corp.' },
      { s:'CNP',   n:'CenterPoint Energy' },
      { s:'OGE',   n:'OGE Energy Corp.' },
    ],

    // ── Software & Cloud ───────────────────────────────────
    'Software/Cloud': [
      { s:'CRM',   n:'Salesforce Inc.' },
      { s:'ADBE',  n:'Adobe Inc.' },
      { s:'NOW',   n:'ServiceNow Inc.' },
      { s:'INTU',  n:'Intuit Inc.' },
      { s:'TEAM',  n:'Atlassian Corp.' },
      { s:'WDAY',  n:'Workday Inc.' },
      { s:'DDOG',  n:'Datadog Inc.' },
      { s:'SNOW',  n:'Snowflake Inc.' },
      { s:'ZS',    n:'Zscaler Inc.' },
      { s:'CRWD',  n:'CrowdStrike Holdings' },
      { s:'OKTA',  n:'Okta Inc.' },
      { s:'NET',   n:'Cloudflare Inc.' },
      { s:'HUBS',  n:'HubSpot Inc.' },
      { s:'VEEV',  n:'Veeva Systems' },
      { s:'SPLK',  n:'Splunk Inc.' },
      { s:'MDB',   n:'MongoDB Inc.' },
      { s:'ESTC',  n:'Elastic NV' },
      { s:'CFLT',  n:'Confluent Inc.' },
      { s:'S',     n:'SentinelOne Inc.' },
      { s:'ASAN',  n:'Asana Inc.' },
      { s:'GTLB',  n:'GitLab Inc.' },
      { s:'SMAR',  n:'Smartsheet Inc.' },
      { s:'BOX',   n:'Box Inc.' },
      { s:'DOCN',  n:'DigitalOcean Holdings' },
      { s:'TWLO',  n:'Twilio Inc.' },
      { s:'ZM',    n:'Zoom Video Communications' },
      { s:'DOCU',  n:'DocuSign Inc.' },
      { s:'FIVN',  n:'Five9 Inc.' },
      { s:'RNG',   n:'RingCentral Inc.' },
      { s:'PAYC',  n:'Paycom Software' },
      { s:'PCTY',  n:'Paylocity Holding' },
      { s:'COUP',  n:'Coupa Software' },
      { s:'TTAN',  n:'Titan Machinery' },
      { s:'TTD',   n:'Trade Desk Inc.' },
      { s:'PUBM',  n:'PubMatic Inc.' },
      { s:'APPS',  n:'Digital Turbine' },
      { s:'RGEN',  n:'Repligen Corp.' },
      { s:'GLBE',  n:'Global-E Online' },
      { s:'SHOP',  n:'Shopify Inc.' },
      { s:'MELI',  n:'MercadoLibre Inc.' },
      { s:'SQ',    n:'Block Inc.' },
      { s:'AFRM',  n:'Affirm Holdings' },
      { s:'SOFI',  n:'SoFi Technologies' },
      { s:'UPST',  n:'Upstart Holdings' },
      { s:'LMND',  n:'Lemonade Inc.' },
    ],

    // ── Crypto & Blockchain ────────────────────────────────
    'Crypto/Digital': [
      { s:'COIN',  n:'Coinbase Global' },
      { s:'MSTR',  n:'MicroStrategy' },
      { s:'RIOT',  n:'Riot Platforms' },
      { s:'MARA',  n:'Marathon Digital Holdings' },
      { s:'HUT',   n:'Hut 8 Mining' },
      { s:'CLSK',  n:'CleanSpark Inc.' },
      { s:'BTBT',  n:'Bit Digital' },
      { s:'CIFR',  n:'Cipher Mining' },
      { s:'WULF',  n:'TeraWulf Inc.' },
    ],

    // ── ETFs ───────────────────────────────────────────────
    ETFs: [
      { s:'SPY',   n:'SPDR S&P 500 ETF' },
      { s:'QQQ',   n:'Invesco Nasdaq 100 ETF' },
      { s:'IWM',   n:'iShares Russell 2000 ETF' },
      { s:'DIA',   n:'SPDR Dow Jones ETF' },
      { s:'VTI',   n:'Vanguard Total Stock Market' },
      { s:'VOO',   n:'Vanguard S&P 500 ETF' },
      { s:'IVV',   n:'iShares Core S&P 500' },
      { s:'EFA',   n:'iShares MSCI EAFE ETF' },
      { s:'EEM',   n:'iShares MSCI Emerging Markets' },
      { s:'GLD',   n:'SPDR Gold Shares' },
      { s:'SLV',   n:'iShares Silver Trust' },
      { s:'USO',   n:'United States Oil Fund' },
      { s:'TLT',   n:'iShares 20+ Year Treasury' },
      { s:'HYG',   n:'iShares High Yield Corporate Bond' },
      { s:'LQD',   n:'iShares Investment Grade Corporate' },
      { s:'VNQ',   n:'Vanguard Real Estate ETF' },
      { s:'XLF',   n:'Financial Select Sector SPDR' },
      { s:'XLK',   n:'Technology Select Sector SPDR' },
      { s:'XLE',   n:'Energy Select Sector SPDR' },
      { s:'XLV',   n:'Health Care Select Sector SPDR' },
      { s:'XLI',   n:'Industrial Select Sector SPDR' },
      { s:'XLP',   n:'Consumer Staples Select Sector' },
      { s:'XLU',   n:'Utilities Select Sector SPDR' },
      { s:'XLRE',  n:'Real Estate Select Sector SPDR' },
      { s:'XLC',   n:'Communication Services Select' },
      { s:'XLB',   n:'Materials Select Sector SPDR' },
      { s:'XLY',   n:'Consumer Discret. Select Sector' },
      { s:'XBI',   n:'SPDR Biotech ETF' },
      { s:'IBB',   n:'iShares Nasdaq Biotech ETF' },
      { s:'SMH',   n:'VanEck Semiconductor ETF' },
      { s:'SOXX',  n:'iShares Semiconductor ETF' },
      { s:'ARKK',  n:'ARK Innovation ETF' },
      { s:'ARKG',  n:'ARK Genomic Revolution ETF' },
      { s:'ARKW',  n:'ARK Next Gen Internet ETF' },
      { s:'ARKF',  n:'ARK Fintech Innovation ETF' },
      { s:'BOTZ',  n:'Global X Robotics & AI ETF' },
      { s:'ICLN',  n:'iShares Global Clean Energy' },
      { s:'FINX',  n:'Global X FinTech ETF' },
      { s:'ROBO',  n:'ROBO Global Robotics ETF' },
      { s:'VGT',   n:'Vanguard Information Technology' },
      { s:'VOOG',  n:'Vanguard S&P 500 Growth ETF' },
      { s:'VUG',   n:'Vanguard Growth ETF' },
      { s:'VEA',   n:'Vanguard FTSE Developed Markets' },
      { s:'VWO',   n:'Vanguard FTSE Emerging Markets' },
      { s:'AGG',   n:'iShares Core US Aggregate Bond' },
      { s:'BND',   n:'Vanguard Total Bond Market' },
      { s:'SHY',   n:'iShares 1-3 Year Treasury' },
      { s:'IEF',   n:'iShares 7-10 Year Treasury' },
      { s:'GOVT',  n:'iShares US Treasury Bond ETF' },
      { s:'BITO',  n:'ProShares Bitcoin Strategy ETF' },
      { s:'SOXL',  n:'Direxion Semiconductor Bull 3x' },
      { s:'TQQQ',  n:'ProShares UltraPro QQQ 3x' },
      { s:'SPXL',  n:'Direxion Daily S&P 500 Bull 3x' },
      { s:'SQQQ',  n:'ProShares UltraPro Short QQQ' },
      { s:'SH',    n:'ProShares Short S&P 500' },
    ],

    // ── International ──────────────────────────────────────
    International: [
      { s:'TSM',   n:'Taiwan Semiconductor (ADR)' },
      { s:'ASML',  n:'ASML Holding (ADR)' },
      { s:'SAP',   n:'SAP SE (ADR)' },
      { s:'NVO',   n:'Novo Nordisk (ADR)' },
      { s:'NESN',  n:'Nestle SA (ADR)' },
      { s:'TM',    n:'Toyota Motor (ADR)' },
      { s:'HMC',   n:'Honda Motor (ADR)' },
      { s:'SONY',  n:'Sony Group (ADR)' },
      { s:'NMR',   n:'Nomura Holdings (ADR)' },
      { s:'BIDU',  n:'Baidu Inc. (ADR)' },
      { s:'BABA',  n:'Alibaba Group (ADR)' },
      { s:'JD',    n:'JD.com Inc. (ADR)' },
      { s:'NIO',   n:'NIO Inc. (ADR)' },
      { s:'LI',    n:'Li Auto Inc. (ADR)' },
      { s:'XPEV',  n:'XPeng Inc. (ADR)' },
      { s:'RIO',   n:'Rio Tinto (ADR)' },
      { s:'BHP',   n:'BHP Group (ADR)' },
      { s:'VALE',  n:'Vale SA (ADR)' },
      { s:'AZN',   n:'AstraZeneca PLC (ADR)' },
      { s:'GSK',   n:'GSK PLC (ADR)' },
      { s:'BP',    n:'BP PLC (ADR)' },
      { s:'SHEL',  n:'Shell PLC (ADR)' },
      { s:'SAN',   n:'Banco Santander (ADR)' },
      { s:'DB',    n:'Deutsche Bank (ADR)' },
      { s:'SHOP',  n:'Shopify Inc. (NYSE)' },
      { s:'SE',    n:'Sea Limited (ADR)' },
      { s:'GRAB',  n:'Grab Holdings (ADR)' },
    ],

  };

  // ── Flat list + lookup ────────────────────────────────────
  const ALL_SYMBOLS_FLAT = [];
  const SYMBOL_META      = {};    // { sym: { name, sector } }

  Object.entries(UNIVERSE).forEach(([sector, stocks]) => {
    stocks.forEach(({ s, n }) => {
      if (!SYMBOL_META[s]) {
        ALL_SYMBOLS_FLAT.push(s);
        SYMBOL_META[s] = { name: n, sector };
      }
    });
  });

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  function init() {
    _loadFromStorage();
    _buildSectorTabs();
    _buildAddForm();
    console.log(`✅ WatchlistManager — ${ALL_SYMBOLS_FLAT.length} symbols | watchlist: ${_watchlist.length}`);
  }

  // ── Load from localStorage ───────────────────────────────
  function _loadFromStorage() {
    try {
      const saved = localStorage.getItem(LS_KEY);
      _watchlist  = saved ? JSON.parse(saved) : _defaultWatchlist();
      const savedStarred = localStorage.getItem(LS_STARRED);
      _starred    = savedStarred ? JSON.parse(savedStarred) : [];
    } catch(e) {
      _watchlist  = _defaultWatchlist();
      _starred    = [];
    }
  }

  function _defaultWatchlist() {
    // Default: first 60 symbols across key sectors
    return [
      'SPY','QQQ','IWM',
      'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA',
      'JPM','GS','BAC','V','MA',
      'UNH','LLY','JNJ','ABBV','MRK',
      'XOM','CVX','COP',
      'HD','MCD','COST','WMT',
      'NEE','DUK',
      'LIN','SHW',
      'CRM','ADBE','NOW','INTU',
      'AMD','INTC','QCOM','AMAT','MU',
      'BA','LMT','RTX','CAT','DE',
      'COIN','MSTR',
      'ARKK','SMH','XLF','XLK','XLE',
    ];
  }

  function _save() {
    localStorage.setItem(LS_KEY, JSON.stringify(_watchlist));
    localStorage.setItem(LS_STARRED, JSON.stringify(_starred));
  }

  // ════════════════════════════════════════════════════════
  // WATCHLIST CRUD
  // ════════════════════════════════════════════════════════
  function addSymbol(sym) {
    sym = sym.toUpperCase().trim();
    if (!sym || _watchlist.includes(sym)) {
      _showToast(`${sym || 'Symbol'} already in watchlist or invalid`, 'warn');
      return false;
    }
    _watchlist.unshift(sym);

    // Add to SYMBOL_META if unknown
    if (!SYMBOL_META[sym]) {
      SYMBOL_META[sym] = { name: sym, sector: 'Custom' };
      ALL_SYMBOLS_FLAT.push(sym);
    }

    _save();
    _showToast(`${sym} added to watchlist`, 'success');
    render(_signalData);
    return true;
  }

  function removeSymbol(sym) {
    _watchlist = _watchlist.filter(s => s !== sym);
    _starred   = _starred.filter(s => s !== sym);
    _save();
    _showToast(`${sym} removed from watchlist`, 'info');
    render(_signalData);
  }

  function toggleStar(sym) {
    if (_starred.includes(sym)) {
      _starred = _starred.filter(s => s !== sym);
    } else {
      _starred.unshift(sym);
    }
    _save();
    render(_signalData);
  }

  function isStarred(sym)  { return _starred.includes(sym); }
  function isInWatchlist(sym) { return _watchlist.includes(sym); }

  function resetToDefault() {
    _watchlist = _defaultWatchlist();
    _starred   = [];
    _save();
    render(_signalData);
    _showToast('Watchlist reset to defaults', 'info');
  }

  // ════════════════════════════════════════════════════════
  // RENDER WATCHLIST TABLE
  // ════════════════════════════════════════════════════════
  function render(signalData = {}) {
    _signalData = signalData;
    const sigs  = signalData?.signals || {};

    // Get filtered + sorted list
    let symbols = _getFilteredSymbols();

    // Pagination
    const total    = symbols.length;
    const pages    = Math.ceil(total / PAGE_SIZE);
    _currentPage   = Math.min(_currentPage, Math.max(1, pages));
    const start    = (_currentPage - 1) * PAGE_SIZE;
    const display  = symbols.slice(start, start + PAGE_SIZE);

    // Update count
    const countEl = document.getElementById('wl-sym-count');
    if (countEl) countEl.textContent = `${total} symbols`;

    // Render table
    const tbody = document.getElementById('watchlist-tbody');
    if (!tbody) return;

    if (!display.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="loading-row">
        No symbols match your filter. <button class="btn-sm" onclick="WatchlistManager.resetFilter()">Reset</button>
      </td></tr>`;
      _renderPagination(pages);
      return;
    }

    tbody.innerHTML = display.map(sym => {
      const s      = sigs[sym] || {};
      const meta   = SYMBOL_META[sym] || { name: sym, sector: '--' };
      const price  = parseFloat(s.price || 0);
      const chg    = parseFloat(s.change_pct || 0);
      const score  = parseFloat(s.final_score || 0);
      const bp     = parseFloat(s.buy_prob || 0.5);
      const dir    = s.direction || 'neutral';
      const council= s.council   || (price > 0 ? 'wait' : '--');
      const cls    = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const scolor = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
      const ccolor = council.includes('execute') ? '#10b981'
                   : council === 'veto' ? '#ef4444' : '#f59e0b';
      const starClass = isStarred(sym) ? 'starred' : '';

      const dirBadge = dir === 'buy'
        ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
        : dir === 'sell'
          ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
          : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i></span>`;

      return `<tr data-sym="${sym}">
        <td>
          <button class="btn-wl-star ${starClass}" data-star="${sym}" title="Star">
            <i class="fa-${isStarred(sym)?'solid':'regular'} fa-star"></i>
          </button>
        </td>
        <td>
          <strong class="sym-link wl-detail-btn" data-sym="${sym}">${sym}</strong>
          <span style="font-size:10px;color:var(--b1);margin-left:5px">${meta.sector}</span>
        </td>
        <td><span class="muted-sm">${meta.name}</span></td>
        <td class="mono ${cls}">${price > 0 ? '$' + price.toFixed(2) : '<span style="color:var(--txt4)">--</span>'}</td>
        <td class="mono ${cls}">${price > 0 ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--'}</td>
        <td>
          ${score > 0 ? `
          <div class="score-bar-inline">
            <div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div>
          </div>
          <span class="mono" style="color:${scolor};font-size:11px">${score.toFixed(3)}</span>
          ` : '<span style="color:var(--txt4);font-size:11px">--</span>'}
        </td>
        <td>${price > 0 ? dirBadge : '<span style="color:var(--txt4);font-size:11px">--</span>'}</td>
        <td class="mono">${bp > 0 && score > 0 ? (bp*100).toFixed(1)+'%' : '--'}</td>
        <td><span class="regime-chip">${(s.regime||'--').replace(/_/g,' ')}</span></td>
        <td>${price > 0 ? `<strong style="color:${ccolor};font-size:11px">${council.toUpperCase()}</strong>` : '--'}</td>
        <td>
          <button class="btn-xs wl-detail-btn" data-sym="${sym}" title="Detail"><i class="fa-solid fa-chart-bar"></i></button>
          <button class="btn-xs wl-trade-btn" data-sym="${sym}" title="Trade"><i class="fa-solid fa-paper-plane"></i></button>
          <button class="btn-wl-remove" data-remove="${sym}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </td>
      </tr>`;
    }).join('');

    // Bind table events
    tbody.querySelectorAll('[data-star]').forEach(btn => {
      btn.addEventListener('click', () => toggleStar(btn.dataset.star));
    });
    tbody.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeSymbol(btn.dataset.remove));
    });
    tbody.querySelectorAll('.wl-detail-btn').forEach(btn => {
      btn.addEventListener('click', () => StockDetail.open(btn.dataset.sym));
    });
    tbody.querySelectorAll('.wl-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = document.getElementById('order-symbol');
        if (sel) sel.value = btn.dataset.sym;
        if (window.Terminal) window.Terminal.showSection('execution');
      });
    });

    _renderPagination(pages);
  }

  // ── Filtered symbol list ─────────────────────────────────
  function _getFilteredSymbols() {
    let symbols = [..._watchlist];

    // Starred first
    symbols.sort((a, b) => {
      const aS = isStarred(a) ? -1 : 0;
      const bS = isStarred(b) ? -1 : 0;
      return aS - bS;
    });

    // Sector filter
    if (_currentSector !== 'All') {
      symbols = symbols.filter(s =>
        (SYMBOL_META[s]?.sector || '') === _currentSector
      );
    }

    // Search filter
    if (_currentSearch) {
      const q = _currentSearch.toLowerCase();
      symbols = symbols.filter(s =>
        s.toLowerCase().includes(q) ||
        (SYMBOL_META[s]?.name || '').toLowerCase().includes(q)
      );
    }

    return symbols;
  }

  // ── Sector Tabs ──────────────────────────────────────────
  function _buildSectorTabs() {
    const container = document.getElementById('sector-tabs');
    if (!container) return;

    const sectors = ['All', 'Starred', ...Object.keys(UNIVERSE)];
    container.innerHTML = sectors.map(s => `
      <button class="sector-tab ${s === 'All' ? 'active' : ''}" data-sector="${s}">
        ${s === 'Starred' ? '<i class="fa-solid fa-star"></i> ' : ''}${s}
      </button>`).join('');

    container.querySelectorAll('.sector-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sector-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentSector = btn.dataset.sector;
        _currentPage   = 1;
        render(_signalData);
      });
    });
  }

  // ── Add Symbol Form ──────────────────────────────────────
  function _buildAddForm() {
    const form = document.getElementById('wl-add-form');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('wl-add-input');
      if (input) {
        addSymbol(input.value);
        input.value = '';
      }
    });

    // Search input binding
    const searchEl = document.getElementById('wl-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        _currentSearch = searchEl.value.trim();
        _currentPage   = 1;
        render(_signalData);
      });
    }
  }

  // ── Pagination ───────────────────────────────────────────
  function _renderPagination(pages) {
    const container = document.getElementById('wl-pagination');
    if (!container || pages <= 1) {
      if (container) container.innerHTML = '';
      return;
    }

    const items = [];
    items.push(`<button class="wl-page-btn" id="wl-prev" ${_currentPage <= 1 ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-left"></i>
    </button>`);

    // Page numbers (max 7 shown)
    const start = Math.max(1, _currentPage - 3);
    const end   = Math.min(pages, start + 6);
    for (let i = start; i <= end; i++) {
      items.push(`<button class="wl-page-btn ${i === _currentPage ? 'active' : ''}" data-pg="${i}">${i}</button>`);
    }

    items.push(`<button class="wl-page-btn" id="wl-next" ${_currentPage >= pages ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`);

    items.push(`<span class="wl-count">Page ${_currentPage}/${pages} · ${_watchlist.length} total</span>`);

    container.innerHTML = items.join('');

    container.querySelectorAll('[data-pg]').forEach(btn => {
      btn.addEventListener('click', () => {
        _currentPage = parseInt(btn.dataset.pg);
        render(_signalData);
      });
    });

    const prev = document.getElementById('wl-prev');
    const next = document.getElementById('wl-next');
    if (prev) prev.addEventListener('click', () => { _currentPage--; render(_signalData); });
    if (next) next.addEventListener('click', () => { _currentPage++; render(_signalData); });
  }

  async function fetchLiveQuote(sym) {
    if (_liveCache[sym] && (Date.now() - _liveCache[sym].ts) < 60000) {
        return _liveCache[sym].data;
    }
    try {
        const data = await YahooFinance.getQuote(sym);
        if (data) _liveCache[sym] = { data, ts: Date.now() };
        return data;
    } catch(e) {
        console.warn(`Live quote ${sym}: ${e.message}`);
        return null;
    }
    }

    async function fetchNews(sym) {
    try {
        return await YahooFinance.getNews(sym);
    } catch(e) {
        console.warn(`News ${sym}: ${e.message}`);
        return [];
    }
    }

    async function fetchFinancials(sym) {
    try {
        return await YahooFinance.getFinancials(sym);
    } catch(e) {
        console.warn(`Financials ${sym}: ${e.message}`);
        return null;
    }
    }

    async function fetchProfile(sym) {
    try {
        return await YahooFinance.getProfile(sym);
    } catch(e) {
        return null;
    }
    }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function resetFilter() {
    _currentSector = 'All';
    _currentSearch = '';
    _currentPage   = 1;
    const searchEl = document.getElementById('wl-search');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('.sector-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.sector === 'All');
    });
    render(_signalData);
  }

  function _today()       { return new Date().toISOString().split('T')[0]; }
  function _daysAgo(n)    {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  function _showToast(msg, type = 'info') {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success:'fa-circle-check', error:'fa-circle-exclamation',
                    warn:'fa-triangle-exclamation', info:'fa-circle-info' };
    toast.innerHTML = `<i class="fa-solid ${icons[type]||'fa-info'}"></i> ${msg}`;
    wrap.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; setTimeout(()=>toast.remove(),300); }, 3500);
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    init,
    render,
    addSymbol,
    removeSymbol,
    toggleStar,
    isStarred,
    isInWatchlist,
    resetToDefault,
    resetFilter,
    fetchLiveQuote,
    fetchNews,
    fetchFinancials,
    fetchProfile,

    // Getters
    getWatchlist:    () => _watchlist,
    getStarred:      () => _starred,
    getAllSymbols:    () => ALL_SYMBOLS_FLAT,
    getSymbolMeta:   (s) => SYMBOL_META[s] || { name: s, sector: '--' },
    getUniverse:     () => UNIVERSE,
    getTotalCount:   () => ALL_SYMBOLS_FLAT.length,
  };

})();

window.WatchlistManager = WatchlistManager;
console.log(`✅ WatchlistManager loaded — ${WatchlistManager.getTotalCount()} total symbols available`);