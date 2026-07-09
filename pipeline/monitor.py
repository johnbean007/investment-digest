#!/usr/bin/env python3
"""
Investment Digest Pipeline
Runs daily via GitHub Actions. Checks configured YouTube channels for new videos,
extracts transcripts, analyses for stock recommendations, enriches with market data,
and writes structured JSON for the web frontend.
"""

import json
import math
import os
import re
import sys
import time
import logging
import subprocess
import glob
from datetime import datetime, timedelta
from pathlib import Path

import requests
import anthropic
import numpy as np
import yfinance as yf
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

from config import (
    CHANNELS, MAX_VIDEO_AGE_DAYS, ANTHROPIC_MODEL, BATCH_SIZE,
    MAX_TRANSCRIPT_RETRIES, MAX_ANALYSIS_RETRIES,
    DATA_DIR, DIGEST_DIR, STATE_FILE, LOG_FILE, EVAL_DIR,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).parent / "analysis_prompt.md"


# ---------------------------------------------------------------------------
# State helpers
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if Path(STATE_FILE).exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"processed": {}}


def save_state(state: dict):
    Path(STATE_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ---------------------------------------------------------------------------
# YouTube helpers
# ---------------------------------------------------------------------------

def _resolve_channel_id(handle: str, api_key: str) -> str | None:
    """Resolve a YouTube @handle to a channel ID via the Data API."""
    try:
        resp = requests.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "contentDetails", "forHandle": handle, "key": api_key},
            timeout=15,
        )
        items = resp.json().get("items", [])
        return items[0]["id"] if items else None
    except Exception as e:
        log.error(f"Could not resolve channel handle @{handle}: {e}")
        return None


def get_channel_videos(channel_url: str, api_key: str, state: dict) -> list[dict]:
    """Fetch recent videos via YouTube Data API v3. Caches channel IDs in state."""
    match = re.search(r'@([^/]+)', channel_url)
    if not match:
        log.error(f"Could not extract handle from URL: {channel_url}")
        return []
    handle = match.group(1)

    # Cache channel IDs to save API quota on subsequent runs
    channel_ids = state.setdefault("channel_ids", {})
    if handle not in channel_ids:
        channel_id = _resolve_channel_id(handle, api_key)
        if not channel_id:
            return []
        channel_ids[handle] = channel_id
    channel_id = channel_ids[handle]

    # Uploads playlist: channel ID with UC → UU prefix
    uploads_playlist_id = "UU" + channel_id[2:]

    try:
        resp = requests.get(
            "https://www.googleapis.com/youtube/v3/playlistItems",
            params={
                "part": "snippet",
                "playlistId": uploads_playlist_id,
                "maxResults": 30,
                "key": api_key,
            },
            timeout=15,
        )
        data = resp.json()
        if "error" in data:
            log.error(f"YouTube API error for @{handle}: {data['error'].get('message')}")
            return []

        videos = []
        for item in data.get("items", []):
            snippet  = item["snippet"]
            video_id = snippet["resourceId"]["videoId"]
            published = snippet.get("publishedAt", "")
            upload_date = published[:10].replace("-", "") if published else ""
            videos.append({
                "id":          video_id,
                "title":       snippet.get("title", ""),
                "upload_date": upload_date,
                "url":         f"https://www.youtube.com/watch?v={video_id}",
            })
        return videos
    except Exception as e:
        log.error(f"Error fetching videos for @{handle}: {e}")
        return []


def get_transcript(video_id: str, cookies_path: str | None = None) -> tuple[str | None, str | None]:
    """Return (transcript, reason). reason is None on success, "unavailable" when
    captions are genuinely disabled (terminal — never retry), or "error" for a
    transient failure such as a network / IP block (worth retrying later)."""
    captions_unavailable = False

    # Primary: youtube-transcript-api instance API (1.x+)
    try:
        if cookies_path:
            import http.cookiejar
            jar = http.cookiejar.MozillaCookieJar()
            jar.load(cookies_path, ignore_discard=True, ignore_expires=True)
            session = requests.Session()
            session.cookies = jar
            api = YouTubeTranscriptApi(http_client=session)
        else:
            api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
        text = " ".join(s.text for s in fetched.snippets)
        if text:
            log.info(f"  Transcript via API: {len(text):,} chars")
            return text, None
    except (TranscriptsDisabled, NoTranscriptFound):
        captions_unavailable = True
        log.warning(f"  No transcript available via API for {video_id}")
    except Exception as e:
        # Blocks/rate-limits surface here; some raise with an empty str, so log the type.
        log.warning(f"  Transcript API error for {video_id}: {type(e).__name__}: {e}")

    # Fallback: yt-dlp VTT
    try:
        cmd = [
            "yt-dlp", "--write-auto-subs", "--write-subs",
            "--sub-langs", "en.*", "--sub-format", "vtt",
            "--skip-download", "--no-playlist", "--ignore-no-formats-error",
            "-o", f"/tmp/yt_transcript_{video_id}",
            f"https://www.youtube.com/watch?v={video_id}",
        ]
        if cookies_path:
            cmd[1:1] = ["--cookies", cookies_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        vtt_files = glob.glob(f"/tmp/yt_transcript_{video_id}*.vtt")
        if not vtt_files:
            stderr_tail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "(no stderr)"
            log.warning(f"  yt-dlp found no subtitles for {video_id} (exit {result.returncode}): {stderr_tail}")
        if vtt_files:
            raw = Path(vtt_files[0]).read_text()
            Path(vtt_files[0]).unlink(missing_ok=True)
            lines = []
            for line in raw.split("\n"):
                line = line.strip()
                if (not line or line.startswith("WEBVTT") or line.startswith("NOTE")
                        or "-->" in line or line.startswith("Kind:") or line.startswith("Language:")):
                    continue
                line = re.sub(r"<[^>]+>", "", line)
                if line and (not lines or lines[-1] != line):
                    lines.append(line)
            transcript = " ".join(lines)
            if transcript:
                log.info(f"  Transcript via yt-dlp VTT: {len(transcript):,} chars")
                return transcript, None
    except Exception as e:
        log.warning(f"  yt-dlp VTT fallback failed for {video_id}: {type(e).__name__}: {e}")

    log.warning(f"  No transcript obtained for {video_id}")
    return None, ("unavailable" if captions_unavailable else "error")


# ---------------------------------------------------------------------------
# Claude analysis
# ---------------------------------------------------------------------------

def analyse_transcript(title: str, channel: str, transcript: str) -> tuple[dict | None, bool]:
    """Return (analysis, transient). transient=True means the failure is an
    infrastructure/auth/network problem (retry later, do NOT count toward giving
    up); transient=False with analysis=None means Claude returned an unparseable
    response for this specific video (a content problem that counts toward the cap)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.error("ANTHROPIC_API_KEY not set")
        return None, True

    client = anthropic.Anthropic(api_key=api_key)
    template = PROMPT_FILE.read_text()
    if len(transcript) > 100_000:
        transcript = transcript[:100_000] + "\n[transcript truncated]"

    prompt = template.replace("{title}", title).replace("{channel}", channel).replace("{transcript}", transcript)

    try:
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=16384,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw), False
    except json.JSONDecodeError as e:
        log.error(f"  Claude returned invalid JSON: {e}")
        return None, False
    except Exception as e:
        # Auth (401), rate limit (429), server (5xx) and network errors are all
        # transient/global — never let them permanently retire a video.
        log.error(f"  Claude API error: {type(e).__name__}: {e}")
        return None, True


# ---------------------------------------------------------------------------
# Market data enrichment
# ---------------------------------------------------------------------------

def calculate_rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def get_stock_data(ticker: str) -> dict | None:
    try:
        import signal
        def _timeout(signum, frame):
            raise TimeoutError(f"yfinance timeout for {ticker}")
        signal.signal(signal.SIGALRM, _timeout)
        signal.alarm(15)
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
        finally:
            signal.alarm(0)

        current_price = info.get("currentPrice") or info.get("regularMarketPrice")
        if not current_price:
            return None

        prev_close     = info.get("previousClose") or info.get("regularMarketPreviousClose")
        week52_high    = info.get("fiftyTwoWeekHigh")
        week52_low     = info.get("fiftyTwoWeekLow")
        currency       = info.get("currency", "USD")
        name           = info.get("shortName") or info.get("longName") or ticker

        # Historical prices
        hist_1y = stock.history(period="1y", timeout=10)
        hist_1mo = stock.history(period="1mo", timeout=10)
        if hist_1y.empty:
            return None

        closes_1y = hist_1y["Close"].dropna().tolist()
        closes_1mo = hist_1mo["Close"].dropna().tolist() if not hist_1mo.empty else []

        daily_change_pct = round((current_price - prev_close) / prev_close * 100, 2) if prev_close else None
        month_change_pct = round((current_price - closes_1mo[0]) / closes_1mo[0] * 100, 2) if closes_1mo else None

        # RSI
        rsi = calculate_rsi(closes_1y)
        rsi_label = None
        if rsi is not None:
            if rsi >= 70:
                rsi_label = "overbought"
            elif rsi <= 30:
                rsi_label = "oversold"
            else:
                rsi_label = "neutral"

        # Moving averages
        ma50 = ma200 = None
        ma_signal = None
        if len(closes_1y) >= 200:
            ma50  = round(float(np.mean(closes_1y[-50:])), 2)
            ma200 = round(float(np.mean(closes_1y[-200:])), 2)
            if ma50 > ma200:
                ma_signal = "golden_cross"
            else:
                ma_signal = "death_cross"

        # 52-week dates
        high_date = hist_1y["High"].idxmax().strftime("%d %b %Y") if not hist_1y.empty else None
        low_date  = hist_1y["Low"].idxmin().strftime("%d %b %Y") if not hist_1y.empty else None

        # Analyst consensus
        try:
            recs = stock.recommendations
            if recs is not None and not recs.empty:
                recent = recs.tail(1).iloc[0]
                analyst_buy        = int(recent.get("strongBuy", 0) + recent.get("buy", 0))
                analyst_hold       = int(recent.get("hold", 0))
                analyst_sell       = int(recent.get("sell", 0) + recent.get("strongSell", 0))
            else:
                analyst_buy = analyst_hold = analyst_sell = None
        except Exception:
            analyst_buy = analyst_hold = analyst_sell = None

        analyst_target     = info.get("targetMeanPrice")
        analyst_upside_pct = round((analyst_target - current_price) / current_price * 100, 1) if analyst_target else None

        # Earnings date
        try:
            cal = stock.calendar
            earnings_date = None
            if cal is not None and not cal.empty:
                if "Earnings Date" in cal.index:
                    ed = cal.loc["Earnings Date"]
                    if hasattr(ed, "iloc"):
                        ed = ed.iloc[0]
                    earnings_date = pd.Timestamp(ed).strftime("%d %b %Y") if ed else None
        except Exception:
            earnings_date = None

        # Earnings days away
        earnings_days = None
        if earnings_date:
            try:
                import pandas as pd
                ed_dt = datetime.strptime(earnings_date, "%d %b %Y")
                earnings_days = (ed_dt - datetime.now()).days
            except Exception:
                pass

        return {
            "ticker":             ticker.upper(),
            "name":               name,
            "currency":           currency,
            "sector":             info.get("sector"),
            "industry":           info.get("industry"),
            "market_cap":         info.get("marketCap"),
            "current_price":      round(current_price, 2),
            "daily_change_pct":   daily_change_pct,
            "month_change_pct":   month_change_pct,
            "week52_high":        round(week52_high, 2) if week52_high else None,
            "week52_high_date":   high_date,
            "week52_low":         round(week52_low, 2) if week52_low else None,
            "week52_low_date":    low_date,
            "rsi":                rsi,
            "rsi_label":          rsi_label,
            "ma50":               ma50,
            "ma200":              ma200,
            "ma_signal":          ma_signal,
            "pe_trailing":        info.get("trailingPE"),
            "pe_forward":         info.get("forwardPE"),
            "peg_ratio":          info.get("pegRatio"),
            "revenue_growth":     info.get("revenueGrowth"),
            "earnings_growth":    info.get("earningsGrowth"),
            "free_cashflow":      info.get("freeCashflow"),
            "profit_margins":     info.get("profitMargins"),
            "debt_to_equity":     info.get("debtToEquity"),
            "beta":               info.get("beta"),
            "short_percent":      info.get("shortPercentOfFloat"),
            "dividend_yield":     info.get("dividendYield"),
            "analyst_buy":        analyst_buy,
            "analyst_hold":       analyst_hold,
            "analyst_sell":       analyst_sell,
            "analyst_target":     round(analyst_target, 2) if analyst_target else None,
            "analyst_upside_pct": analyst_upside_pct,
            "earnings_date":      earnings_date,
            "earnings_days":      earnings_days,
        }
    except Exception as e:
        log.warning(f"Could not fetch stock data for {ticker}: {e}")
        return None


# ---------------------------------------------------------------------------
# Digest builder
# ---------------------------------------------------------------------------

def build_digest(all_video_analyses: list[dict]) -> dict:
    """
    Aggregate all video analyses into a per-ticker structure with enriched market data.
    Returns a dict ready to be serialised as JSON for the frontend.
    """
    ticker_map: dict[str, dict] = {}

    for video in all_video_analyses:
        analysis   = video["analysis"]
        upload_date = video.get("upload_date", "")
        # Price at time of recommendation is today's price captured at processing time
        # (we store it when we first process the video)
        price_at_rec = video.get("price_at_recommendation", {})

        meta = {
            "channel":     video["channel"],
            "title":       video["title"],
            "url":         video["url"],
            "upload_date": upload_date,
            "date_label":  format_date(upload_date),
        }

        for rec in analysis.get("buy_recommendations", []):
            ticker = rec.get("ticker", "").upper()
            if not ticker:
                continue
            ticker_map.setdefault(ticker, {
                "company_name": rec.get("company_name", ticker),
                "buys":   [],
                "avoids": [],
                "warnings": [],
                "price_at_first_mention": price_at_rec.get(ticker),
                "first_mention_date": upload_date,
            })
            entry = ticker_map[ticker]
            if upload_date < entry.get("first_mention_date", "99999999"):
                entry["first_mention_date"]     = upload_date
                entry["price_at_first_mention"] = price_at_rec.get(ticker)
            entry["buys"].append({**meta, **rec})

        for rec in analysis.get("stocks_to_avoid", []):
            ticker = rec.get("ticker", "").upper()
            if not ticker:
                continue
            ticker_map.setdefault(ticker, {
                "company_name": rec.get("company_name", ticker),
                "buys":   [],
                "avoids": [],
                "warnings": [],
                "price_at_first_mention": price_at_rec.get(ticker),
                "first_mention_date": upload_date,
            })
            ticker_map[ticker]["avoids"].append({**meta, **rec})

    # Enrich each ticker with live market data
    stocks = []
    for ticker, entry in sorted(ticker_map.items()):
        log.info(f"  Fetching market data: {ticker}")
        market = get_stock_data(ticker)
        time.sleep(0.5)

        # % change since first recommendation
        pct_since_rec = None
        if market and entry.get("price_at_first_mention"):
            try:
                p0 = float(entry["price_at_first_mention"])
                p1 = market["current_price"]
                pct_since_rec = round((p1 - p0) / p0 * 100, 1)
            except (TypeError, ZeroDivisionError):
                pass

        stocks.append({
            "ticker":              ticker,
            "company_name":        entry["company_name"],
            "buy_count":           len(entry["buys"]),
            "avoid_count":         len(entry["avoids"]),
            "first_mention_date":  format_date(entry.get("first_mention_date", "")),
            "price_at_first_mention": entry.get("price_at_first_mention"),
            "pct_change_since_rec": pct_since_rec,
            "market":              market,
            "buys":                entry["buys"],
            "avoids":              entry["avoids"],
        })

    return {
        "generated_at": datetime.now().isoformat(),
        "video_count":  len(all_video_analyses),
        "stock_count":  len(stocks),
        "stocks":       stocks,
    }


def maybe_save_eval_transcript(state: dict, video: dict, channel: str, transcript: str, analysis: dict):
    """Save one transcript + its analysis per calendar week, for manually spot-checking
    whether Claude's summary matches what the video actually said."""
    iso = datetime.now().isocalendar()
    week_id = f"{iso.year}-W{iso.week:02d}"
    if state.get("last_eval_week") == week_id:
        return

    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with open(EVAL_DIR / f"{week_id}.json", "w") as f:
        json.dump({
            "video_id":    video.get("id"),
            "channel":     channel,
            "title":       video["title"],
            "url":         video["url"],
            "upload_date": video.get("upload_date", ""),
            "captured_at": datetime.now().isoformat(),
            "transcript":  transcript,
            "analysis":    analysis,
        }, f, indent=2)
    state["last_eval_week"] = week_id
    log.info(f"  Saved eval transcript for week {week_id}")


def sanitize_floats(obj):
    """Replace NaN/Infinity with None so json.dump can't emit invalid JSON
    (a single bad float breaks JSON.parse for the whole file in the browser)."""
    if isinstance(obj, dict):
        return {k: sanitize_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_floats(v) for v in obj]
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def format_date(upload_date: str) -> str:
    if upload_date and len(upload_date) == 8:
        try:
            return datetime.strptime(upload_date, "%Y%m%d").strftime("%d %b %Y")
        except ValueError:
            pass
    return ""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run():
    log.info("=== Investment Digest Pipeline starting ===")
    state      = load_state()
    cutoff     = (datetime.now() - timedelta(days=MAX_VIDEO_AGE_DAYS)).strftime("%Y%m%d")
    new_count  = 0

    yt_api_key = os.environ.get("YOUTUBE_API_KEY")
    if not yt_api_key:
        log.error("YOUTUBE_API_KEY not set — cannot fetch channel videos")
        return

    _cookies_env = os.environ.get("YOUTUBE_COOKIES_FILE", "")
    cookies_path = _cookies_env if (_cookies_env and Path(_cookies_env).exists() and Path(_cookies_env).stat().st_size > 10) else None
    if cookies_path:
        log.info(f"Using YouTube cookies from {cookies_path}")
    else:
        log.warning("No valid YOUTUBE_COOKIES_FILE — transcript fetching may be blocked by YouTube")

    attempts = 0
    for channel in CHANNELS:
        if attempts >= BATCH_SIZE:
            log.info(f"Batch limit of {BATCH_SIZE} reached, stopping for this run")
            break

        name = channel["name"]
        url  = channel["url"]
        log.info(f"Checking: {name}")

        videos = get_channel_videos(url, yt_api_key, state)
        log.info(f"  Found {len(videos)} recent video(s)")

        for video in videos:
            if attempts >= BATCH_SIZE:
                break

            vid_id = video.get("id")
            if not vid_id:
                continue

            upload_date = video.get("upload_date", "")
            if upload_date and upload_date < cutoff:
                log.info(f"  Skipping (too old): {video['title']}")
                continue

            prior = state.get("processed", {}).get(vid_id)
            if prior and ("analysis" in prior or prior.get("terminal")):
                log.info(f"  Skipping (already processed): {video['title']}")
                continue

            log.info(f"  Processing: {video['title']}")
            time.sleep(2)
            attempts += 1
            transcript, reason = get_transcript(vid_id, cookies_path=cookies_path)

            if not transcript:
                entry = state.setdefault("processed", {}).get(vid_id, {})
                fails = entry.get("transcript_fails", 0) + 1
                entry.update({
                    "channel": name, "title": video["title"],
                    "upload_date": upload_date, "url": video["url"],
                    "processed_at": datetime.now().isoformat(),
                    "transcript_fails": fails, "last_reason": reason,
                })
                # Captions genuinely disabled → give up now. Transient block → give
                # up only after MAX_TRANSCRIPT_RETRIES so it stops blocking the queue.
                if reason == "unavailable" or fails >= MAX_TRANSCRIPT_RETRIES:
                    entry["terminal"] = True
                    entry["skipped"] = "no transcript"
                    log.warning(f"  Giving up on transcript ({reason}, {fails} attempt(s)): {video['title']}")
                state["processed"][vid_id] = entry
                save_state(state)
                continue

            analysis, transient = analyse_transcript(video["title"], name, transcript)
            if not analysis:
                if transient:
                    # Infra/auth/network problem — leave state untouched and retry
                    # on a later run so a global outage can't retire the backlog.
                    log.warning(f"  Analysis failed (transient — will retry): {video['title']}")
                    continue
                entry = state.setdefault("processed", {}).get(vid_id, {})
                afails = entry.get("analysis_fails", 0) + 1
                entry.update({
                    "channel": name, "title": video["title"],
                    "upload_date": upload_date, "url": video["url"],
                    "processed_at": datetime.now().isoformat(),
                    "analysis_fails": afails,
                })
                if afails >= MAX_ANALYSIS_RETRIES:
                    entry["terminal"] = True
                    entry["skipped"] = "analysis failed"
                    log.warning(f"  Giving up on analysis ({afails} attempt(s)): {video['title']}")
                else:
                    log.warning(f"  Analysis failed (content, attempt {afails}): {video['title']}")
                state["processed"][vid_id] = entry
                save_state(state)
                continue

            maybe_save_eval_transcript(state, video, name, transcript, analysis)

            # Capture current prices for all tickers at time of processing
            all_tickers = set(
                r.get("ticker", "").upper()
                for r in analysis.get("buy_recommendations", []) + analysis.get("stocks_to_avoid", [])
                if r.get("ticker")
            )
            price_snapshot = {}
            for t in all_tickers:
                try:
                    info = yf.Ticker(t).info
                    p = info.get("currentPrice") or info.get("regularMarketPrice")
                    if p:
                        price_snapshot[t] = round(p, 2)
                except Exception:
                    pass

            state.setdefault("processed", {})[vid_id] = {
                "channel":               name,
                "title":                 video["title"],
                "upload_date":           upload_date,
                "url":                   video["url"],
                "processed_at":          datetime.now().isoformat(),
                "analysis":              analysis,
                "price_at_recommendation": price_snapshot,
            }
            save_state(state)
            new_count += 1
            time.sleep(3)

    # Collect all videos in the 30-day window with analysis
    all_video_analyses = [
        {
            "channel":                 v["channel"],
            "title":                   v["title"],
            "url":                     v["url"],
            "upload_date":             v.get("upload_date", ""),
            "analysis":                v["analysis"],
            "price_at_recommendation": v.get("price_at_recommendation", {}),
        }
        for v in state.get("processed", {}).values()
        if "analysis" in v and v.get("upload_date", "") >= cutoff
    ]

    if not all_video_analyses:
        log.info("No videos with analysis in the past 30 days.")
        return

    log.info(f"Building digest from {len(all_video_analyses)} video(s)...")
    digest = sanitize_floats(build_digest(all_video_analyses))

    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")

    dated_path  = DIGEST_DIR / f"{today}.json"
    latest_path = DATA_DIR / "latest.json"

    for path in (dated_path, latest_path):
        with open(path, "w") as f:
            json.dump(digest, f, indent=2)

    log.info(f"Digest written: {dated_path}")
    log.info(f"=== Done. {new_count} new video(s) processed, {digest['stock_count']} stock(s) ===")


if __name__ == "__main__":
    run()
