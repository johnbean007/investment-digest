# investment-digest

Daily pipeline that monitors 7 YouTube investment channels, extracts transcripts, analyses them with Claude for stock recommendations, enriches with live market data, and serves a dashboard via GitHub Pages at [johnbean007.github.io/investment-digest](https://johnbean007.github.io/investment-digest).

## How it works

1. GitHub Actions (`.github/workflows/daily.yml`) runs `pipeline/monitor.py` every 2 hours.
2. YouTube Data API fetches each channel's recent videos.
3. Transcripts come from `youtube-transcript-api`, falling back to `yt-dlp` if that fails.
4. Claude (`claude-haiku-4-5`) analyses each transcript against `pipeline/analysis_prompt.md`, returning structured JSON (buy recommendations, stocks to avoid, tickers).
5. `yfinance` enriches every mentioned ticker with live price/fundamentals data.
6. Output is written to `data/latest.json` and `data/digests/YYYY-MM-DD.json`, copied to `docs/data/` for the frontend, committed and pushed automatically.
7. Each run caps at `BATCH_SIZE` (5) real transcript-fetch attempts to stay under YouTube's rate limit — a day's backlog clears across several runs rather than one burst.

## Status as of 6 July 2026

Transcript fetching is now confirmed working end-to-end in CI, after a session that found and fixed a chain of issues (see below). Backlog from the broken period is clearing via the batched runs; expect roughly a day for it to fully catch up.

## Session log — 6 July 2026

Started as "check why the last update was 26 June" and turned into fixing four independent, stacked bugs plus two expired credentials:

1. **Local automation explored, then dropped.** Set up a local launchd job as an alternative to GitHub Actions, then discovered GitHub Actions was already running successfully — removed the local job and the older, superseded `youtube-digest` launchd job (which had a plaintext API key in its plist and was failing silently).
2. **Live site crash fixed.** `month_change_pct` occasionally came back as `NaN` from yfinance (missing first-day close), which Python's `json.dump` wrote as a bare `NaN` token — invalid JSON, so the browser's `JSON.parse` rejected the *entire* digest file over one bad ticker. Fixed the root cause (drop NaN closes before computing stats) and added a `sanitize_floats()` safety net so no future bad float can do this again.
3. **On-site feedback tool added.** Right-click anywhere on the dashboard opens a comment box that captures the nearest ticker/section context; submitting opens a pre-filled GitHub issue (labelled `feedback`) in a new tab for you to confirm — no write credentials needed client-side since the site is public.
4. **Weekly eval transcripts added.** Once per calendar week, the first successfully analysed video's full transcript + Claude's analysis are saved to `data/eval_transcripts/` for manually spot-checking summary accuracy.
5. **Root cause of stale data, fully diagnosed and fixed:**
   - `youtube-transcript-api` was pinned to `0.6.3` in `requirements.txt`, but the code used the `1.x` instance API (`YouTubeTranscriptApi(http_client=...)`) — every CI run installed the incompatible old version fresh, so the primary transcript method failed 100% of the time in CI (local runs looked fine only because the dev venv happened to have `1.2.4` already installed). Fixed by pinning `1.2.4`.
   - The `yt-dlp` fallback never actually passed `--cookies`, and failures were logged silently. Fixed both, which surfaced the next issue.
   - `YOUTUBE_COOKIES` GitHub secret had expired — yt-dlp hit YouTube's "sign in to confirm you're not a bot" wall. Re-exported fresh cookies and updated the secret.
   - Next error: yt-dlp's `--skip-download` still validates downloadable video/audio formats by default, and failed with "Requested format is not available" on this IP. Fixed with `--ignore-no-formats-error` (designed exactly for metadata/subtitle-only extraction).
   - `ANTHROPIC_API_KEY` GitHub secret had also expired (`401 invalid x-api-key`) — transcripts were fetching fine but nothing was being analysed. Rotated the key.
   - Final discovery: YouTube burst-rate-limits this IP+cookie pair after ~6 real requests per run, after which everything else in that run fails instantly regardless of video. Fixed by capping attempts at `BATCH_SIZE=5` per run and moving the schedule from once daily to every 2 hours, so the backlog clears across several small batches instead of one burst that trips the limit.

## Known issues / next steps

- **Confirm backlog clears.** Batched runs started 6 July ~12:35 UTC; check back after a day of 2-hourly runs to confirm digest freshness catches up and "last mentioned" dates across all 7 channels move forward.
- **Re-check the original "3 channels, no transcript" channels** (CouchInvestor, The Traveling Trader, Mr FIRED Up Wealth) now that the pipeline actually works — the original diagnosis (creators don't enable captions) was made before the version-mismatch bug was found, so it may not have been the real cause for all of them.
- **Ticker mismatches from Claude.** yfinance 404s on tickers like `SPACEX`, `MICRON`, `NEBIUS`, `NBUS` — Claude is sometimes returning company names or near-misses instead of real tickers. Cosmetic/data-quality issue, not a blocker, worth a prompt tweak in `analysis_prompt.md` at some point.
- **Output quality still not independently validated.** Use `data/eval_transcripts/` (one video/week, transcript + Claude's analysis side by side) to spot-check accuracy.
- **Cookie/key expiry is a recurring maintenance item.** Both `YOUTUBE_COOKIES` and `ANTHROPIC_API_KEY` had silently expired this session — no alerting exists for this, so failures can go unnoticed until digest freshness visibly degrades again.
- **`BATCH_SIZE=5` / 2-hour cadence may need tuning** once there's a few days of steady-state data — could go tighter (fewer per batch, more spread out) or looser depending on how reliably it avoids the rate limit going forward.
