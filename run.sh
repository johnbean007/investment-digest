#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="/Users/johnbean/Documents/Claude/Investment Projects/youtube-digest/venv/bin/python3"

# Load secrets from .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a && source "$SCRIPT_DIR/.env" && set +a
fi

COOKIES="$SCRIPT_DIR/yt_cookies.txt"
if [ -f "$COOKIES" ]; then
    export YOUTUBE_COOKIES_FILE="$COOKIES"
    echo "Using cookies: $COOKIES"
fi

cd "$SCRIPT_DIR/pipeline"
"$VENV_PYTHON" monitor.py
