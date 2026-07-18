#!/bin/bash
# Investment Digest — local runner (launchd, on this Mac's residential IP).
# Pulls latest state, runs the pipeline, publishes the digest to GitHub Pages.
set -euo pipefail

# launchd runs with a minimal PATH; add Homebrew (yt-dlp) and keep system git.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="/Users/johnbean/.venvs/investment-digest/bin/python3"
cd "$SCRIPT_DIR"

# Secrets come from the login keychain, not a plaintext .env. Items were created
# with -T /usr/bin/security so this reads without an interactive prompt, which a
# launchd agent could not answer. To rotate a key:
#   security add-generic-password -U -a "$USER" -s investment-digest-anthropic \
#       -w "<new-key>" -T /usr/bin/security
keychain_secret() {
    security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null
}

ANTHROPIC_API_KEY="$(keychain_secret investment-digest-anthropic)"
YOUTUBE_API_KEY="$(keychain_secret investment-digest-youtube)"

if [ -z "$ANTHROPIC_API_KEY" ] || [ -z "$YOUTUBE_API_KEY" ]; then
    echo "FATAL: could not read API keys from keychain. Is the login keychain unlocked?" >&2
    exit 1
fi
export ANTHROPIC_API_KEY YOUTUBE_API_KEY

COOKIES="$SCRIPT_DIR/yt_cookies.txt"
if [ -f "$COOKIES" ]; then
    export YOUTUBE_COOKIES_FILE="$COOKIES"
fi

echo "=== run.sh starting $(date -u '+%Y-%m-%d %H:%M:%SZ') ==="

# Refuse to run against a dirty tree. This runner shares its working directory
# with hand editing, so a run mid-edit would execute uncommitted (possibly
# half-finished) pipeline code and push its output to the live site. It would also
# let the autostash below hit a pop conflict and leave the tree wedged. Steady
# state is always clean (the bot commits everything it touches), so any dirtiness
# is a signal to pause. Gitignored files (cookies, logs, .DS_Store) are excluded
# by --porcelain, so they do not trip this. Exit 0, not an error: you are editing,
# not broken. The notification is the signal; it resumes the moment you commit.
if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree dirty, skipping run (commit or stash to resume)." >&2
    osascript -e 'display notification "Uncommitted changes, run skipped. Commit or stash to resume." with title "Investment Digest"' >/dev/null 2>&1 || true
    exit 0
fi

# Get latest committed state first so we don't process against a stale backlog
# and so the push at the end fast-forwards cleanly.
git pull --rebase --autostash origin main

# Run the pipeline
"$VENV_PYTHON" pipeline/monitor.py

# Publish data for the GitHub Pages frontend
mkdir -p docs/data
cp data/latest.json            docs/data/latest.json
cp data/processed_videos.json  docs/data/processed_videos.json 2>/dev/null || true

# Commit and push only if something actually changed
git config user.name  "Investment Digest Bot"
git config user.email "digest-bot@users.noreply.github.com"
git add data/ docs/data/
if git diff --cached --quiet; then
    echo "No changes to commit."
else
    git commit -m "digest: $(date -u '+%Y-%m-%d %H:%M UTC')"
    git push origin main
    echo "Pushed update."
fi

echo "=== run.sh done $(date -u '+%Y-%m-%d %H:%M:%SZ') ==="
