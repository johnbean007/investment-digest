# investment-digest

Daily pipeline that monitors 7 YouTube investment channels, extracts transcripts, analyses them with Claude for stock recommendations, enriches with live market data, and serves a dashboard via GitHub Pages at [johnbean007.github.io/investment-digest](https://johnbean007.github.io/investment-digest).

## Where things live

| Thing | Path | Why |
|---|---|---|
| Repo | `~/investment-digest` | Deliberately **not** in `~/Documents`. See "Why the repo is not in iCloud". |
| Venv | `~/.venvs/investment-digest` | Deliberately not in iCloud either. Same reason. |
| launchd job | `~/Library/LaunchAgents/com.johnbean.investment-digest.plist` | Copied from `ops/`. |
| Logs | `~/Library/Logs/investment-digest.{out,err}.log` | |
| API keys | macOS login keychain | Services `investment-digest-anthropic` and `investment-digest-youtube`. No plaintext `.env`. |
| Cookies | `yt_cookies.txt` (repo root) | Gitignored, plaintext. Never passed to yt-dlp directly: it rewrites the file. Validated at startup; a bad file raises a macOS notification. |

Note for future sessions: the repo is **not** under `~/Documents/Claude/Investment Projects` any more. It moved on 14 July 2026 and only the Obsidian notes (`Daily Digests`, `Private investing`) remain there. Reasons below.

## How it works

1. **launchd runs `run.sh` hourly on this Mac**, plus once on login (`ops/com.johnbean.investment-digest.plist`, `StartInterval 3600`, `RunAtLoad`). If the Mac is asleep across a scheduled time, launchd fires once on wake and resumes the hourly cadence. Combined with the pipeline's 30 day lookback, a weekend gap catches itself up.
2. `run.sh` pulls latest `main`, runs the pipeline, copies output to `docs/data/`, then commits and pushes only if something changed.
3. YouTube Data API fetches each channel's recent videos.
4. Transcripts come from `youtube-transcript-api`, falling back to `yt-dlp` (with cookies) if that fails. Cookies are validated first, and yt-dlp is only ever given a throwaway copy of the file. Both failure paths raise a macOS notification rather than a log line nobody reads.
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

# 5. Secrets into the login keychain. -T /usr/bin/security puts the security
#    binary on the item ACL, so run.sh reads without an interactive prompt.
#    A launchd agent cannot answer a keychain prompt, so this flag is required.
security add-generic-password -U -a "$USER" -s investment-digest-anthropic \
    -w "<anthropic-key>" -T /usr/bin/security
security add-generic-password -U -a "$USER" -s investment-digest-youtube \
    -w "<youtube-key>" -T /usr/bin/security

#    Then export a fresh yt_cookies.txt into the repo root. Not in the repo.
#    Export with the "Get cookies.txt LOCALLY" extension, Netscape format.
#
#    Export from a PRIVATE/INCOGNITO window, then close it WITHOUT signing out:
#    sign in, export, close. A normal browser session keeps rotating its cookies,
#    and each rotation invalidates the copy you exported, which is why these kept
#    dying within days. Closing an incognito window without signing out leaves the
#    session un-rotated, so the export stays valid until natural expiry. Signing
#    out inside that window kills the export too (learned 14 July).
#
#    Two further traps, both hit on 16 July 2026:
#      - Export FROM www.youtube.com, not google.com. The extension exports the
#        current tab's domain. A google.com export looks plausible (it carries
#        SID/HSID/SAPISID) but is useless: cookie domain matching means
#        .google.com cookies are never sent to youtube.com.
#      - The extension names the file www.yt_cookies.txt. Rename it.
#    Verify before trusting it, rather than waiting for a silent fallback failure:
#      python3 - <<'EOF'
#      rows=[l.split("\t") for l in open("yt_cookies.txt") if not l.startswith("#") and l.strip()]
#      names={p[5] for p in rows if len(p)>=7}
#      print("domains:", {p[0] for p in rows if len(p)>=7})
#      print("LOGIN_INFO present:", "LOGIN_INFO" in names)
#      EOF
#    Want: every domain .youtube.com, and LOGIN_INFO present.

# 6. Schedule
cp ~/investment-digest/ops/com.johnbean.investment-digest.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.johnbean.investment-digest.plist
launchctl list | grep investment    # second column is last exit code, want 0
```

`requirements.txt` pins `youtube-transcript-api==1.2.4`. Do not unpin it. The code uses the 1.x instance API (`YouTubeTranscriptApi(http_client=...)`). A 0.6.x install fails 100% of the time, silently.

## Status as of 17 July 2026

Fully restored and running. Rebuild after a laptop theft: new machine, new Homebrew, rebuilt venv, rotated Anthropic and YouTube API keys into the keychain, re-authed GitHub, repo relocated out of iCloud, launchd job reinstalled and confirmed green (exit 0, pulled, analysed, committed, pushed).

Cookies re-exported 16 July and the `yt-dlp` fallback verified end to end for the first time since the rebuild: it pulled real subtitles using the cookie file. Every credential from the stolen laptop has now been rotated or invalidated.

**19 digests published unattended 14 to 17 July** (3, 6, 9, 1 per day), across sleeps and reboots, with a digest file for every day and no gaps. The automation is proven, not just configured.

### Quick health check

Run this first in a new session. It answers "is it actually working" in one go.

```bash
launchctl list | grep investment          # want second column (last exit) = 0
git -C ~/investment-digest status --short # want empty
git -C ~/investment-digest fetch -q origin && \
  git -C ~/investment-digest rev-list --left-right --count origin/main...main   # want 0 0
tail -3 ~/Library/Logs/investment-digest.out.log
```

`data/latest.json` should be under ~1 hour old. If it is stale but launchd says exit 0, the pipeline is running and finding nothing new, which is normal outside the channels' posting hours. If launchd shows a non-zero exit, read `~/Library/Logs/investment-digest.err.log` first.

## Known issues and next steps

- **RESOLVED 17 July 2026: the cookie fallback no longer fails silently.** It had broken four ways in ten days (expired 6 July; killed by a Google sign-out 14 July; exported from the wrong domain 16 July; and destroyed in place by yt-dlp's writeback, found 17 July). None surfaced in normal operation, because transcripts come via the `youtube-transcript-api` primary path, which never touches cookies, so the pipeline looked perfectly healthy with a dead fallback. Now: `validate_cookies()` gates every run and `FALLBACK` counts attempts vs successes, both raising a macOS notification via `alert()`. Notifications are rate-limited to one per 6 hours per problem and cleared on recovery; the log still records every occurrence.
- **Cookies are still plaintext on disk.** The API keys moved to the keychain on 14 July 2026, but `yt_cookies.txt` did not, because yt-dlp wants a file path. It is the more sensitive of the two, being live Google session access. Options if this matters: write the cookie file to a temp path from a keychain blob at run time and delete it afterwards, or accept the risk given the repo is no longer in a sync folder.
- **Ticker mismatches from Claude.** yfinance 404s on `SPACEX`, `VERTIV`, `T1ENERGY`, `TOONE`, `NEBIUS` and similar. Claude sometimes returns company names or near-misses instead of real tickers. Cosmetic data-quality issue, worth a prompt tweak in `analysis_prompt.md`.
- **No alerting on credential expiry.** Both the YouTube cookies and `ANTHROPIC_API_KEY` silently expired in July 2026 and nothing noticed until digest freshness visibly degraded. Still true. Same root cause as the cookie item above: nothing in this pipeline fails loudly.
- **`generated_at` is naive local time.** `data/latest.json` writes `generated_at` with no UTC offset while `run.sh` logs in UTC, so on BST the timestamp reads an hour ahead of the run that produced it. Harmless now, confusing later: the field is served to the browser, and when BST ends in October the apparent offset changes. Write it as UTC with an offset, or as ISO-8601 with `Z`.
- **Output quality not independently validated.** Use `data/eval_transcripts/` (one video per week, transcript plus Claude's analysis side by side) to spot-check accuracy.
- **Re-check the three "no transcript" channels** (CouchInvestor, The Traveling Trader, Mr FIRED Up Wealth). The original diagnosis (creators do not enable captions) predates the version-mismatch fix, so it may not have been the real cause.
- **`BATCH_SIZE=5` and the hourly cadence are now tunable.** This was blocked on having steady-state data. Four days now exist (14 to 17 July, 19 runs). Nobody has looked at it yet. The question is whether 5 per hour is leaving throughput on the table or still occasionally tripping the burst limit; `data/monitor.log` has the evidence.

## Session log

Newest first.

### 17 July 2026, silent failure fixed, and the actual root cause found

Set out to make the cookie fallback fail loudly. Found why it kept needing to.

**yt-dlp rewrites whatever file you pass to `--cookies`.** The finished file carries the header "This file is generated by yt-dlp. Do not edit." The pipeline was handing it the canonical export, so every fallback invocation overwrote that export with YouTube's current response. When the response reflected a rotated or signed-out session, the good export was destroyed in place and the next run started from the wreckage. Caught it because the file lost `LOGIN_INFO` and shrank from 3447 to 2037 bytes with nobody having touched it. Fixed by copying to `/tmp` per call and never letting yt-dlp near the original. Verified by hashing the file before and after: rewritten when passed directly, byte-identical through the fix.

That is the recurring cookie death. Combined with browser-side rotation invalidating exports taken from a normal window (hence the incognito guidance in setup), it explains every prior "the cookies expired again".

Added `validate_cookies()`: existence was the only test before, which is exactly why a google.com export, an expired file, and a dead session all sailed through and logged "Using YouTube cookies". Structural checks (youtube.com domains, `LOGIN_INFO`, expiry) are authoritative. The live check is advisory: it needs an injected `SOCS=CAI` to clear the UK consent interstitial, which otherwise returns a page with no login flag and reads as "unknown". Ambiguity never raises an alarm, so YouTube changing its HTML cannot train us to ignore this.

The alarm caught a real failure on its first run: the cookies were already dead again, confirmed independently by `yt-dlp :ytsubscriptions`, which requires a genuine login and reported them "no longer valid".

### 16 July 2026, cookies re-exported

Google sign-out (closing the theft exposure) also invalidated the local cookie file, as expected. First re-export was taken from google.com rather than youtube.com: it carried real Google auth cookies but every entry was `.google.com`, so none would ever be sent to youtube.com. Second export from youtube.com was correct, 21 cookies with `LOGIN_INFO`. Verified by fetching an account-only page (`LOGGED_IN:true`) and then by replicating the pipeline's exact yt-dlp call, which pulled real subtitles. A `429` appeared when the test requested a dozen subtitle languages, which is the documented burst limit and not a fault; the pipeline requests one.

### 14 July 2026, rebuild after laptop theft

Laptop stolen; everything survived because `~/Documents` was iCloud-synced, but the replacement Mac had "Desktop & Documents" sync off, so `~/Documents` looked empty. Turning sync on restored the lot.

Rotated the Anthropic and YouTube API keys, both of which had been sitting in plaintext on the stolen machine. Rebuilt the venv outside iCloud after the in-iCloud one hung on a bare import for over 120s. Hit `Operation not permitted` from launchd, diagnosed it as TCC protection on `~/Documents`, and moved the repo to `~/investment-digest` rather than grant `/bin/bash` Full Disk Access. Moved both API keys into the login keychain and deleted `.env`, verified by running the job through launchd with no plaintext file present. Deleted the superseded `youtube-digest` v1 folder (checked first: all 5 of its processed videos were already among v2's 145, and nothing referenced it) which also removed a second stale cookie file.

Also corrected the README, which still claimed GitHub Actions ran every 2 hours. That had been reversed in `c5208b9` on 8 July, two days after the 6 July entry below was written. Worth noting as a pattern: the doc drifted within 48 hours of being written.

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
