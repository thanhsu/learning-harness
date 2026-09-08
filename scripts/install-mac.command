#!/bin/bash
# ============================================================================
#  learning-harness — one-click installer for macOS (Apple Silicon)
#
#  Double-click this file in Finder (or run: bash scripts/install-mac.command)
#  It installs everything needed:
#    Homebrew (if missing) -> Node 20+ -> Python 3 -> BlackHole (system audio)
#    -> npm dependencies -> Python venv + Whisper bridge deps -> .env
#  then starts the app and opens the dashboard.
#
#  Safe to re-run: every step is skipped when already satisfied.
# ============================================================================
set -e

# Run from the repository root (this file lives in scripts/).
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m    ✓ %s\033[0m\n' "$*"; }

bold "learning-harness installer (macOS)"
echo "    Repository: $REPO_DIR"

# ── 1. Homebrew ─────────────────────────────────────────────────────────────
step "Checking Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  # Apple Silicon installs to /opt/homebrew — pick it up if only PATH is missing.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    echo "    Homebrew not found — installing (you may be asked for your password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"

# ── 2. Node.js 20+ ──────────────────────────────────────────────────────────
step "Checking Node.js 20+"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "    Installing Node 20 via Homebrew..."
  brew install node@20
  brew link --overwrite --force node@20
fi
ok "Node $(node --version)"

# ── 3. Python 3 ─────────────────────────────────────────────────────────────
step "Checking Python 3"
if ! command -v python3 >/dev/null 2>&1; then
  echo "    Installing Python via Homebrew..."
  brew install python
fi
ok "$(python3 --version)"

# ── 4. BlackHole (system-audio loopback for Zoom capture) ──────────────────
step "Checking BlackHole (captures Zoom system audio)"
if brew list --cask blackhole-2ch >/dev/null 2>&1 || \
   ls /Library/Audio/Plug-Ins/HAL 2>/dev/null | grep -qi blackhole; then
  ok "BlackHole already installed"
else
  echo "    Installing BlackHole 2ch (audio driver — password may be required)..."
  brew install --cask blackhole-2ch
  ok "BlackHole installed"
fi

# ── 5. npm dependencies ─────────────────────────────────────────────────────
step "Installing npm dependencies"
npm install --no-fund --no-audit
ok "npm packages ready"

# ── 6. Python venv + Whisper bridge dependencies ────────────────────────────
step "Installing the live-capture bridge (Python venv + faster-whisper)"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r tools/requirements.txt
ok "Whisper bridge ready (.venv)"

# ── 7. .env ─────────────────────────────────────────────────────────────────
step "Configuration (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example."
  printf '    Paste your FREE Gemini API key (https://aistudio.google.com/apikey)\n'
  printf '    or press Enter to skip (offline fallback mode): '
  read -r KEY || KEY=""
  if [ -n "$KEY" ]; then
    # Replace the empty GEMINI_API_KEY line with the provided key.
    sed -i '' "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$KEY|" .env
    ok "API key saved to .env"
  else
    ok "Skipped — you can add GEMINI_API_KEY to .env any time"
  fi
else
  ok ".env already exists — leaving it untouched"
fi

# ── 8. BlackHole audio routing reminder ─────────────────────────────────────
step "One manual step for live Zoom capture (first time only)"
cat <<'EOF'
    macOS needs a Multi-Output Device so you can HEAR Zoom while BlackHole
    records it:
      1. Audio MIDI Setup opens now → click "+" (bottom-left) → Create
         Multi-Output Device
      2. Tick BOTH your speakers/headphones AND "BlackHole 2ch"
      3. Set this Multi-Output Device as the Mac's sound output
         (Option-click the menu-bar volume icon)
    Then in the dashboard's "Live capture" panel pick the BlackHole device.
EOF
open -a "Audio MIDI Setup" || true

# ── 9. Launch ───────────────────────────────────────────────────────────────
step "Starting learning-harness"
echo "    Dashboard: http://localhost:3456  (Ctrl+C here to stop the server)"
( sleep 3 && open "http://localhost:3456" ) &
npm start
