# investment-digest

Daily pipeline that monitors 7 YouTube investment channels, extracts transcripts, analyses them with Claude for stock recommendations, enriches with live market data, and serves a dashboard via GitHub Pages at [johnbean007.github.io/investment-digest](https://johnbean007.github.io/investment-digest).

> **New session? Start with [`HANDOFF.md`](HANDOFF.md).** It has the 30-second health
> check, where everything lives, and the current open items. This README is the deep
> reference behind it.

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

## Status as of 13 October 2026

Running and current. Last verified green on 13 October: manual catch-up run exit 0, fresh `latest.json`, committed and pushed, tree clean, in sync with origin.

The dashboard carries the full feature set from the July rebuild plus the 18 July enhancement round: company descriptions (summary row and detail card), a richer summary table (price, daily and monthly change, 52-week range bar), a dated timeline with a "+N earlier" expander, chronological merged buy/avoid mentions, and corrected column sorting. See the session log for detail.

History: the project was rebuilt from scratch after a July 2026 laptop theft (new machine, rebuilt venv outside iCloud, rotated Anthropic and YouTube keys into the keychain, repo relocated out of `~/Documents`, launchd reinstalled). Every credential from the stolen laptop has been rotated or invalidated.

**Known gap: no digest files for 9 to 12 October.** A run interrupted on 8 October left `data/processed_videos.json` dirty, and the dirty-tree guard (then unscoped) skipped every run for five days until found and fixed on 13 October. The dashboard itself lost nothing: `latest.json` aggregates a rolling 30-day window, so all in-window recommendations are present. Only the per-day snapshot files for those four days are absent. Resolved; see the 13 October session-log entry.

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

**Stale-but-green cause to check first (added 18 July, scoped 13 October): `run.sh` skips when uncommitted _code_ is present.** It would otherwise run half-finished code and push it live. The check is scoped to exclude `data/` and `docs/data/`, which are the pipeline's own output, so only genuine code edits pause it. The skip logs "Uncommitted code changes, skipping run" to the err log and raises a notification. So if the digest is stale and the err log shows that line, commit or stash the code change to resume. (Before 13 October the check covered the whole tree, which deadlocked on the pipeline's own dirty state file; that is what caused the 9 to 12 October gap.)

## Known issues and next steps

- **RESOLVED 13 October 2026: the dirty-tree guard no longer deadlocks on the pipeline's own data.** The guard added 18 July checked the whole working tree. A run interrupted on 8 October left `data/processed_videos.json` dirty, and because the pipeline cannot run to commit that file without first passing the guard, every run skipped for five days (the 9 to 12 October gap). Fixed by scoping the check to exclude `data/` and `docs/data/`: a dirty state file now rides through the autostash and is committed by the run itself, while uncommitted code still pauses the automation. The guard against running half-finished code live is intact; only its blind spot for the pipeline's own output is gone.
- **RESOLVED 17 July 2026: the cookie fallback no longer fails silently.** It had broken four ways in ten days (expired 6 July; killed by a Google sign-out 14 July; exported from the wrong domain 16 July; and destroyed in place by yt-dlp's writeback, found 17 July). None surfaced in normal operation, because transcripts come via the `youtube-transcript-api` primary path, which never touches cookies, so the pipeline looked perfectly healthy with a dead fallback. Now: `validate_cookies()` gates every run and `FALLBACK` counts attempts vs successes, both raising a macOS notification via `alert()`. Notifications are rate-limited to one per 6 hours per problem and cleared on recovery; the log still records every occurrence.
- **Cookies are still plaintext on disk.** The API keys moved to the keychain on 14 July 2026, but `yt_cookies.txt` did not, because yt-dlp wants a file path. It is the more sensitive of the two, being live Google session access. Options if this matters: write the cookie file to a temp path from a keychain blob at run time and delete it afterwards, or accept the risk given the repo is no longer in a sync folder.
- **Ticker mismatches from Claude.** yfinance 404s on `SPACEX`, `VERTIV`, `T1ENERGY`, `TOONE`, `NEBIUS` and similar. Claude sometimes returns company names or near-misses instead of real tickers. Cosmetic data-quality issue, worth a prompt tweak in `analysis_prompt.md`.
- **No freshness alerting (top candidate next task).** Nothing watches whether the dashboard is actually updating. Expired credentials in July, and the guard deadlock in October, both ran for days before anyone noticed via a visibly stale dashboard. A small check that raises a notification when `data/latest.json` is older than ~3 hours during posting hours would have caught both on day one. This is the single highest-leverage improvement outstanding: it closes the "fails silently" gap that every incident so far has shared.
- **`generated_at` is naive local time.** `data/latest.json` writes `generated_at` with no UTC offset while `run.sh` logs in UTC, so on BST the timestamp reads an hour ahead of the run that produced it. Harmless now, confusing later: the field is served to the browser, and when BST ends in October the apparent offset changes. Write it as UTC with an offset, or as ISO-8601 with `Z`.
- **Output quality not independently validated.** Use `data/eval_transcripts/` (one video per week, transcript plus Claude's analysis side by side) to spot-check accuracy.
- **Re-check the three "no transcript" channels** (CouchInvestor, The Traveling Trader, Mr FIRED Up Wealth). The original diagnosis (creators do not enable captions) predates the version-mismatch fix, so it may not have been the real cause.
- **`BATCH_SIZE` (currently 8 in `pipeline/config.py`) and the hourly cadence are tunable, still unexamined.** Months of run data now sit in `data/monitor.log`. The question is whether 8 transcript attempts per hour leaves throughput on the table or occasionally trips YouTube's burst limit. Nobody has analysed it.

## Session log

Newest first.

### 13 October 2026, five-day outage: the guard deadlocked on its own data

Opened to check whether the digest was still running. It was not, and had not been since 8 October. launchd was firing hourly (exit 0) but every run skipped at the dirty-tree guard, which the err log showed plainly: eight "Working tree dirty, skipping run" lines. `latest.json` was five days stale.

Root cause was the guard added on 18 July, turned against itself. A run around 8 October wrote 78 new records to `data/processed_videos.json` but was interrupted (sleep or kill) before `run.sh` reached its commit step, leaving that state file dirty. The guard checked the whole tree, so it then skipped every subsequent run; and because the pipeline cannot run to commit the file without first passing the guard, nothing could clear it. A self-sustaining deadlock, triggered by the pipeline's own output being mistaken for a human edit.

Fixed by scoping the guard to exclude `data/` and `docs/data/` (`git status --porcelain -- ':(exclude)data' ':(exclude)docs/data'`). Those are the pipeline's output surface, which it writes every run and commits at the end; a dirty file there now rides through the autostash and is overwritten and committed by the run itself. Genuine uncommitted code still pauses the automation, so the original protection against pushing half-finished code live is intact. Verified by a manual `run.sh` that passed the scoped guard, cleared the five-day backlog, committed and pushed (digest `4157533`), and left the tree clean and in sync.

Lesson restated for the next person: every incident in this project's history has been a silent failure found late (expired credentials in July, this deadlock in October). The pipeline still has no freshness alarm. That is now the top open item: a check that notifies when `latest.json` goes stale would have caught this on day one instead of day five.

### 18 to 19 July 2026, dashboard enhancements, sort defects, and a dirty-tree guard

Worked through the eight on-site feedback issues (#1 to #8, all now closed). Shipped in `57f9a21`: title click resets to the default view; company descriptions on both the summary row and the detail card; enlarged timeline dots carrying a visible dd/mm on the six most recent with a "+N earlier" expander; default sort by last-mentioned newest-first; price, daily change, one-month change and a 52-week range bar added to the summary table, grouped so it does not scroll sideways; alternating detail-card tint; and the detail card's buys and avoids merged into one chronological list, newest first, each tagged BUY or AVOID instead of grouped into sections.

**Three live sort/date defects surfaced while building, all pre-existing.** The summary table sorted every column backwards: `sortDir = -1` was labelled "desc" and drew a down arrow, but the comparator returned ascending order, so the default view had been showing the *fewest* buys first under a down arrow. The "Last mentioned" column showed the wrong date on eight stocks (AAOI read 28 Jun against a true 16 Jul) because it took the head of two separately-sorted lists concatenated, which is not itself sorted. And the avoid table's sort headers were wired to the wrong columns through a parallel index-matched key array, so clicking "Avoids" sorted by buy count. Restructured the table so each column owns its label, sort key and cell renderer, which makes that last class of bug unrepresentable.

**Company descriptions are a cached one-liner per ticker** (`data/company_descriptions.json`, prompt in `pipeline/description_prompt.md`). Generated once and cached forever including nulls, so steady-state runs make zero extra API calls; only genuinely new tickers cost a call. Grounded on the yfinance `longBusinessSummary` where it exists, which is captured into the market dict and stripped before output so the ~2000-char summaries never reach the browser. 183 of 192 tickers describe; the nulls are transcription junk with hedged names (`'Iran (likely CoreWeave... ticker unclear)'`, `'Fintech Sector (General)'`) where the prompt is told to return null rather than invent or copy a neighbour. This softens the "ticker mismatches" issue below but does not fix it: the mismatched tickers still 404 on yfinance for price data.

**Added a dirty-tree guard to `run.sh`.** The runner shares its working directory with hand editing, and `git pull --rebase --autostash` pops uncommitted changes back before the pipeline runs. During this session that meant two hourly launchd cycles executed uncommitted `monitor.py` and pushed its output to the live site. It worked, but it is fragile: a run landing mid-edit would ship half-finished code, and an autostash pop conflict would wedge the tree. The guard now aborts with a macOS notification when `git status --porcelain` is non-empty, exiting 0 (you are editing, not broken) and resuming the moment you commit. Consequence to know: **while the tree is dirty, the hourly digest pauses.** The 30-day lookback catches it up on the next clean run.

### 17 July 2026, silent failure fixed, and the actual root cause found

Set out to make the cookie fallback fail loudly. Found why it kept needing to.

**yt-dlp rewrites whatever file you pass to `--cookies`.** The finished file carries the header "This file is generated by yt-dlp. Do not edit." The pipeline was handing it the canonical export, so every fallback invocation overwrote that export with YouTube's current response. When the response reflected a rotated or signed-out session, the good export was destroyed in place and the next run started from the wreckage. Caught it because the file lost `LOGIN_INFO` and shrank from 3447 to 2037 bytes with nobody having touched it. Fixed by copying to `/tmp` per call and never letting yt-dlp near the original. Verified by hashing the file before and after: rewritten when passed directly, byte-identical through the fix.

That is the recurring cookie death. Combined with browser-side rotation invalidating exports taken from a normal window (hence the incognito guidance in setup), it explains every prior "the cookies expired again".

Added `validate_cookies()`: existence was the only test before, which is exactly why a google.com export, an expired file, and a dead session all sailed through and logged "Using YouTube cookies". Structural checks (youtube.com domains, `LOGIN_INFO`, expiry) are authoritative. The live check is advisory: it needs an injected `SOCS=CAI` to clear the UK consent interstitial, which otherwise returns a page with no login flag and reads as "unknown". Ambiguity never raises an alarm, so YouTube changing its HTML cannot train us to ignore this.

The alarm caught a real failure on its first run: the cookies were already dead again, confirmed independently by `yt-dlp :ytsubscriptions`, which requires a genuine login and reported them "no longer valid".

Notification delivery is confirmed working from the launchd agent on this Mac, observed on screen, not merely accepted by `osascript`. Worth knowing because a LaunchAgent runs in the GUI session and `display notification` can silently do nothing without notification permission; if alerts ever stop appearing, check System Settings, Notifications, Script Editor before assuming the pipeline is at fault.

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
