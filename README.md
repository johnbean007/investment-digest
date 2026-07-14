# investment-digest

Daily pipeline that monitors 7 YouTube investment channels, extracts transcripts, analyses them with Claude for stock recommendations, enriches with live market data, and serves a dashboard via GitHub Pages at [johnbean007.github.io/investment-digest](https://johnbean007.github.io/investment-digest).

## Where things live

| Thing | Path | Why |
|---|---|---|
| Repo | `~/investment-digest` | Deliberately **not** in `~/Documents`. See "Why the repo is not in iCloud". |
| Venv | `~/.venvs/investment-digest` | Deliberately not in iCloud either. Same reason. |
| launchd job | `~/Library/LaunchAgents/com.johnbean.investment-digest.plist` | Copied from `ops/`. |
| Logs | `~/Library/Logs/investment-digest.{out,err}.log` | |
| Secrets | `.env`, `yt_cookies.txt` | Gitignored. Never committed. |

## How it works

1. **launchd runs `run.sh` hourly on this Mac**, plus once on login (`ops/com.johnbean.investment-digest.plist`, `StartInterval 3600`, `RunAtLoad`). If the Mac is asleep across a scheduled time, launchd fires once on wake and resumes the hourly cadence. Combined with the pipeline's 30 day lookback, a weekend gap catches itself up.
2. `run.sh` pulls latest `main`, runs the pipeline, copies output to `docs/data/`, then commits and pushes only if something changed.
3. YouTube Data API fetches each channel's recent videos.
4. Transcripts come from `youtube-transcript-api`, falling back to `yt-dlp` (with cookies) if that fails.
5. Claude (`claude-haiku-4-5`) analyses each transcript against `pipeline/analysis_prompt.md`, returning structured JSON (buy recommendations, stocks to avoid, tickers).
6. `yfinance` enriches every mentioned ticker with live price and fundamentals data.
7. Output is written to `data/latest.json` and `data/digests/YYYY-MM-DD.json`, copied to `docs/data/` for the frontend, committed and pushed.
8. Each run caps at `BATCH_SIZE` (5) real transcript-fetch attempts to stay under YouTube's burst rate limit. A day's backlog clears across several runs rather than one burst.

### It does not run on GitHub Actions

`.github/workflows/daily.yml` exists but its `schedule:` block is commented out, and must stay that way. YouTube blocks transcript fetches from GitHub's datacenter IPs, so CI runs produced empty digests. The workflow is kept as a `workflow_dispatch` manual fallback only. The pipeline needs a residential IP, which is why it runs locally via launchd.

### Why the repo is not in iCloud

Two independent reasons, both learned the hard way:

1. **launchd cannot read `~/Documents`.** It is TCC-protected. A launchd agent pointed at a script in there fails with `Operation not permitted` before the script even starts. The only workaround that keeps the repo in `~/Documents` is granting `/bin/bash` Full Disk Access, which hands every bash script on the machine full disk access. Not worth it.
2. **A `.git` directory in a sync folder is a corruption risk.** iCloud can sync partial writes to `index` and pack files. There is also no upside: GitHub is this repo's backup, iCloud is not.

The venv is outside iCloud for a third reason: it is roughly 20,000 small files that iCloud materialises on demand, which made a bare `import` hang for over 120 seconds.

## Setup on a new machine

Written down properly after a July 2026 laptop theft meant doing all of this from scratch.

```bash
# 1. Toolchain
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install yt-dlp gh python@3.12

# 2. Repo (must live outside ~/Documents)
git clone https://github.com/johnbean007/investment-digest.git ~/investment-digest

# 3. Venv (must live outside iCloud)
python3.12 -m venv ~/.venvs/investment-digest
~/.venvs/investment-digest/bin/pip install -r ~/investment-digest/requirements.txt

# 4. GitHub auth, so run.sh can push
gh auth login          # GitHub.com, HTTPS, browser
gh auth setup-git

# 5. Secrets: create .env with ANTHROPIC_API_KEY and YOUTUBE_API_KEY,
#    and export a fresh yt_cookies.txt. Neither is in the repo.

# 6. Schedule
cp ~/investment-digest/ops/com.johnbean.investment-digest.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.johnbean.investment-digest.plist
launchctl list | grep investment    # second column is last exit code, want 0
```

`requirements.txt` pins `youtube-transcript-api==1.2.4`. Do not unpin it. The code uses the 1.x instance API (`YouTubeTranscriptApi(http_client=...)`). A 0.6.x install fails 100% of the time, silently.

## Status as of 14 July 2026

Running normally. Restored end to end after a laptop theft: new machine, new Homebrew, rebuilt venv, rotated Anthropic and YouTube API keys, re-authed GitHub, repo relocated out of iCloud, launchd job reinstalled and confirmed green (exit 0, pulled, analysed, committed, pushed).

## Known issues and next steps

- **YouTube cookies are stale and were on the stolen laptop.** `yt_cookies.txt` has not been re-exported. Recent runs succeeded only because every transcript came via the `youtube-transcript-api` primary path, which does not use cookies. The `yt-dlp` cookie fallback is therefore untested since the rebuild and will likely fail when next needed. Re-export.
- **Secrets sit in plaintext in `.env`.** This is what turned a stolen laptop into a credential rotation exercise. Worth moving to the macOS Keychain and having `run.sh` read from there.
- **Ticker mismatches from Claude.** yfinance 404s on `SPACEX`, `VERTIV`, `T1ENERGY`, `TOONE`, `NEBIUS` and similar. Claude sometimes returns company names or near-misses instead of real tickers. Cosmetic data-quality issue, worth a prompt tweak in `analysis_prompt.md`.
- **No alerting on credential expiry.** Both the YouTube cookies and `ANTHROPIC_API_KEY` silently expired in July 2026 and nothing noticed until digest freshness visibly degraded. Still true.
- **Output quality not independently validated.** Use `data/eval_transcripts/` (one video per week, transcript plus Claude's analysis side by side) to spot-check accuracy.
- **Re-check the three "no transcript" channels** (CouchInvestor, The Traveling Trader, Mr FIRED Up Wealth). The original diagnosis (creators do not enable captions) predates the version-mismatch fix, so it may not have been the real cause.
- **`BATCH_SIZE=5` and the hourly cadence may need tuning** once there are a few days of steady-state data.

## Session log

### 14 July 2026, rebuild after laptop theft

Restored from iCloud onto a replacement Mac. Rotated the Anthropic and YouTube API keys, both of which had been sitting in plaintext on the stolen machine. Rebuilt the venv outside iCloud after the in-iCloud one hung on a bare import. Hit `Operation not permitted` from launchd, diagnosed it as TCC protection on `~/Documents`, and moved the repo to `~/investment-digest` rather than grant `/bin/bash` Full Disk Access. Confirmed a clean scheduled run end to end.

### 6 July 2026

Started as "check why the last update was 26 June" and turned into fixing four independent, stacked bugs plus two expired credentials:

1. **Local automation explored, dropped, then later adopted.** A local launchd job was set up, then removed on discovering GitHub Actions appeared to be running. This was reversed in commit `c5208b9`: Actions cannot fetch transcripts from datacenter IPs, so launchd is now the real scheduler.
2. **Live site crash fixed.** `month_change_pct` occasionally came back as `NaN` from yfinance (missing first-day close), which Python's `json.dump` wrote as a bare `NaN` token. That is invalid JSON, so the browser's `JSON.parse` rejected the entire digest file over one bad ticker. Fixed at root (drop NaN closes before computing stats) plus a `sanitize_floats()` safety net.
3. **On-site feedback tool added.** Right-click anywhere on the dashboard opens a comment box capturing the nearest ticker or section context. Submitting opens a pre-filled GitHub issue labelled `feedback`. No write credentials client-side, since the site is public.
4. **Weekly eval transcripts added.** Once per calendar week the first successfully analysed video's transcript plus Claude's analysis are saved to `data/eval_transcripts/`.
5. **Root cause of stale data, fully diagnosed and fixed:**
   - `youtube-transcript-api` was pinned to `0.6.3` but the code used the 1.x instance API. Every CI run installed the incompatible version fresh, so the primary transcript method failed 100% of the time in CI. Local runs looked fine only because the dev venv happened to have 1.2.4 already.
   - The `yt-dlp` fallback never actually passed `--cookies`, and failures were logged silently. Fixing both surfaced the next issue.
   - The YouTube cookies had expired, so yt-dlp hit YouTube's "sign in to confirm you're not a bot" wall. Re-exported.
   - yt-dlp's `--skip-download` still validates downloadable formats by default and failed with "Requested format is not available". Fixed with `--ignore-no-formats-error`.
   - `ANTHROPIC_API_KEY` had also expired (`401 invalid x-api-key`). Transcripts were fetching fine but nothing was being analysed. Rotated.
   - YouTube burst-rate-limits this IP and cookie pair after roughly 6 real requests per run, after which everything else in that run fails instantly. Fixed by capping attempts at `BATCH_SIZE=5` per run.
