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

# Videos to attempt per run. Runs hourly from a residential IP (launchd on the
# Mac), so throughput is ~BATCH_SIZE * 24/day — enough to clear a weekend backlog
# within a few hours of the machine waking. Keep it modest so a burst of transcript
# requests doesn't trip YouTube's per-IP rate limit on the home connection.
BATCH_SIZE = 8

# A video whose transcript fetch keeps failing (e.g. a transient network / IP
# block) is retried up to this many times, then marked terminal so it stops
# consuming the per-run batch budget and starving later channels. Videos whose
# captions are genuinely disabled are marked terminal on the first failure.
MAX_TRANSCRIPT_RETRIES = 4
MAX_ANALYSIS_RETRIES   = 3

# Company descriptions are generated once per ticker then cached indefinitely:
# what a company does does not change run to run, so only genuinely new tickers
# cost an API call and the steady state is zero. Tickers Claude cannot identify
# are cached as null so they are not retried every hour.
DESCRIPTION_BATCH_SIZE = 40

ROOT = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
DIGEST_DIR = DATA_DIR / "digests"
STATE_FILE = DATA_DIR / "processed_videos.json"
LOG_FILE   = DATA_DIR / "monitor.log"
EVAL_DIR   = DATA_DIR / "eval_transcripts"
DESCRIPTIONS_FILE = DATA_DIR / "company_descriptions.json"
