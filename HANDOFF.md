# Handoff: investment-digest

Start a new session here. This is the short orientation; `README.md` has the full
detail (architecture, new-machine runbook, every known issue, the session log).

## What this is

A daily pipeline that monitors 7 YouTube investment channels, extracts transcripts,
analyses them with Claude for stock recommendations, enriches with live market data,
and serves a dashboard via GitHub Pages at
[johnbean007.github.io/investment-digest](https://johnbean007.github.io/investment-digest).

Runs itself hourly on this Mac via launchd (`com.johnbean.investment-digest`). Not on
GitHub Actions (datacenter IPs are blocked by YouTube). Not in `~/Documents` (TCC
blocks launchd there). Repo at `~/investment-digest`, venv at `~/.venvs/investment-digest`.

## Current position (13 October 2026)

Running and current. Last verified green 13 October: fresh `latest.json`, committed,
pushed, tree clean, in sync. One historical gap: no per-day digest files for 9 to 12
October (a guard deadlock, now fixed); the dashboard lost nothing because `latest.json`
is a rolling 30-day window.

## First thing to run in a new session

```bash
export PATH="/opt/homebrew/bin:$PATH"   # gh and yt-dlp live here; launchd adds it, your shell may not
launchctl list | grep investment                     # col 2 (last exit) want 0
git -C ~/investment-digest status --short            # want empty
git -C ~/investment-digest fetch -q origin && \
  git -C ~/investment-digest rev-list --left-right --count origin/main...main   # want 0 0
stat -f "%Sm" ~/investment-digest/data/latest.json   # want under ~1h old
tail -5 ~/Library/Logs/investment-digest.err.log     # check for skip/alert lines
```

If `latest.json` is stale but launchd is exit 0, check the err log:
- "Uncommitted code changes, skipping run" → `run.sh` is paused because there is a
  genuine code edit uncommitted. Commit or stash it and the next run resumes. (This is
  scoped to code; the pipeline's own `data/` writes do not trip it, as of 13 October.)
- Cookie / fallback notifications → see the cookie section of `README.md`.
- Otherwise it may just be outside the channels' posting hours, which is normal.

## Where things live

| Thing | Path |
|---|---|
| Pipeline entry | `pipeline/monitor.py` (`run()` at the bottom) |
| Config, tunables | `pipeline/config.py` (`BATCH_SIZE=8`, channels, paths) |
| Prompts (editable, no code change) | `pipeline/analysis_prompt.md`, `pipeline/description_prompt.md` |
| Runner (launchd calls this) | `run.sh` (keychain secrets, dirty-code guard, pull/run/commit/push) |
| Frontend | `docs/index.html`, `docs/app.js`, `docs/style.css` |
| Served data | `docs/data/latest.json` (copied from `data/latest.json` each run) |
| Description cache | `data/company_descriptions.json` (one line per ticker, cached forever) |
| Secrets | macOS login keychain: `investment-digest-anthropic`, `investment-digest-youtube` |
| Cookies | `yt_cookies.txt` (repo root, gitignored, plaintext) |

## Top open items (full list in README "Known issues")

1. **Freshness alerting.** The single highest-leverage task. Nothing notices when the
   dashboard stops updating; every incident so far ran for days unseen. A check that
   notifies when `latest.json` is older than ~3h during posting hours closes this.
2. **Ticker mismatches.** yfinance 404s on mis-transcribed tickers (`SPACEX`, `VERTIV`,
   `T1ENERGY`, etc.). Cosmetic; a prompt tweak in `analysis_prompt.md` could fix most.
3. **`generated_at` is naive local time.** Served to the browser; reads an hour ahead on
   BST. Write it UTC/ISO-8601 with `Z`.
4. **`BATCH_SIZE` / cadence unexamined.** Months of data in `data/monitor.log`; nobody
   has checked whether 8/hour is optimal.

## How to do things

- **Run manually / force a catch-up:** `cd ~/investment-digest && ./run.sh` (reads its
  own keychain secrets; pulls, runs, commits, pushes). Takes a few minutes.
- **Edit code safely:** the guard pauses the hourly job while you have uncommitted code,
  so edit freely; commit to resume. Verify frontend changes by serving `docs/` on a
  local port and driving it, not by waiting for Pages.
- **Reprocess from scratch:** `echo '{}' > data/processed_videos.json` (then it re-analyses
  everything in the 30-day window on the next run).

## Conventions

British English. Direct, no filler. Commits end with the Claude Code co-author line.
Never source `.env` or print secret values; secrets come from the keychain via `run.sh`.
