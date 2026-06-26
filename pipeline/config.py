import os
from pathlib import Path

CHANNELS = [
    {"name": "Mr. FIRED Up Wealth",    "url": "https://www.youtube.com/@FiredUpWealth/videos"},
    {"name": "CouchInvestor",           "url": "https://www.youtube.com/@CouchInvestor/videos"},
    {"name": "Ticker Symbol: YOU",      "url": "https://www.youtube.com/@TickerSymbolYou/videos"},
    {"name": "Daniel Pronk",            "url": "https://www.youtube.com/@DanielPronk/videos"},
    {"name": "The Traveling Trader",    "url": "https://www.youtube.com/@TheTravelingTrader/videos"},
    {"name": "Jose Najarro Stocks",     "url": "https://www.youtube.com/@JoseNajarroStocks/videos"},
    {"name": "FinTek",                  "url": "https://www.youtube.com/@FinTek/videos"},
]

MAX_VIDEO_AGE_DAYS = 30
ANTHROPIC_MODEL    = "claude-haiku-4-5-20251001"

ROOT = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
DIGEST_DIR = DATA_DIR / "digests"
STATE_FILE = DATA_DIR / "processed_videos.json"
LOG_FILE   = DATA_DIR / "monitor.log"
