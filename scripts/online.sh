#!/usr/bin/env bash
#
# Host a game over the internet with a Cloudflare quick tunnel.
#
#   pnpm online
#
# Starts an ephemeral tunnel (no Cloudflare account needed), discovers the
# public https://…trycloudflare.com URL, then boots the server with PUBLIC_URL
# set so the lobby advertises a working invite link. Ctrl-C tears both down.

set -euo pipefail

PORT="${PORT:-3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: cloudflared is not installed.

  macOS:  brew install cloudflared
  other:  https://github.com/cloudflare/cloudflared/releases

No Cloudflare account or login is required — quick tunnels are anonymous.
EOF
  exit 1
fi

LOG="$(mktemp -t siguo-tunnel)"
cleanup() {
  [[ -n "${TUNNEL_PID:-}" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

echo "==> Building client…"
(cd "$ROOT" && pnpm build)

echo "==> Opening Cloudflare quick tunnel…"
cloudflared tunnel --url "http://localhost:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!

# The URL shows up in cloudflared's banner a second or two after launch.
PUBLIC_URL=""
for _ in $(seq 1 60); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "error: cloudflared exited early:" >&2
    cat "$LOG" >&2
    exit 1
  fi
  PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [[ -n "$PUBLIC_URL" ]] && break
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "error: timed out waiting for a tunnel URL. cloudflared said:" >&2
  cat "$LOG" >&2
  exit 1
fi

cat <<EOF

  ┌─────────────────────────────────────────────────────────────
  │  Public URL:  ${PUBLIC_URL}
  │
  │  Create a room, then share the invite link the lobby shows.
  │  This tunnel dies when you Ctrl-C — the URL is single-use.
  └─────────────────────────────────────────────────────────────

EOF

export PUBLIC_URL
cd "$ROOT" && exec pnpm start
