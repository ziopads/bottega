#!/bin/bash
# Installs Bottega's Mac watcher (REQUIREMENTS A-10 to A-12, docs/watcher.md).
# Account > Security in Bottega gives the command, with a one-time setup code:
#
#   curl -fsSL https://<bottega>/watcher/install.sh | bash -s -- --server https://<bottega> --code K7QX-M2PL
#
# Everything goes into ~/Library/Application Support/Bottega Watcher, with no
# administrator rights: Node.js 22 from nodejs.org (checked against its
# published SHA-256 checksums), the watcher from Bottega, and a small
# `bottega-watcher` command. The setup code is traded for this Mac's own
# token, kept in the login keychain, and the watcher starts at login.
#
# Run again without --code to update the watcher and Node.js in place.
#
# Everything is inside main(), called on the last line, so that bash reads the
# whole script before running any of it when it comes through a pipe.

main() {
  set -euo pipefail

  local server="" code=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --server) server="${2:-}"; shift 2 ;;
      --code) code="${2:-}"; shift 2 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done

  [ "$(uname -s)" = "Darwin" ] || fail "The Bottega watcher runs on macOS only."
  server="${server%/}"
  case "$server" in
    https://*) ;;
    http://localhost:* | http://127.0.0.1:*) ;;
    *) fail "Give --server, the Bottega address starting with https:// (the command under Account > Security has it)." ;;
  esac

  local dir="$HOME/Library/Application Support/Bottega Watcher"
  mkdir -p "$dir"
  chmod 700 "$dir"

  if [ -z "$code" ] && [ ! -f "$dir/config.json" ]; then
    fail "Give --code: under Account > Security in Bottega, add this Mac (or use Install again) and copy the command it shows."
  fi

  local arch
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) fail "Unknown processor: $(uname -m)." ;;
  esac

  # Global, so the trap still sees it when the script exits.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  # Node.js 22, unless a 22 is already here.
  local node="$dir/node/bin/node"
  local have=""
  [ -x "$node" ] && have="$("$node" -v 2>/dev/null || true)"
  if [[ "$have" == v22.* ]]; then
    say "Node.js $have is already installed."
  else
    local base="https://nodejs.org/dist/latest-v22.x"
    say "Downloading Node.js 22 for $arch from nodejs.org..."
    curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || fail "Could not reach nodejs.org."
    local name
    name="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-darwin-$arch\.tar\.gz" "$tmp/SHASUMS256.txt" | head -n 1 || true)"
    [ -n "$name" ] || fail "nodejs.org lists no Node.js 22 for darwin-$arch."
    curl -fsSL "$base/$name" -o "$tmp/$name" || fail "Could not download $name."
    (cd "$tmp" && grep "  $name\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null) || fail "$name does not match its published checksum; nothing was installed."
    tar -xzf "$tmp/$name" -C "$tmp"
    rm -rf "$dir/node"
    mv "$tmp/${name%.tar.gz}" "$dir/node"
    say "Node.js $("$node" -v) installed."
  fi

  # The watcher, from this Bottega.
  say "Downloading the watcher from ${server}..."
  curl -fsSL "$server/watcher/bottega-watcher.cjs" -o "$tmp/bottega-watcher.cjs" || fail "Could not download the watcher from $server."
  head -n 1 "$tmp/bottega-watcher.cjs" | grep -q '^#!/usr/bin/env node' || fail "$server did not send the watcher."
  mv "$tmp/bottega-watcher.cjs" "$dir/bottega-watcher.cjs"

  cat >"$dir/bottega-watcher" <<'WRAPPER'
#!/bin/bash
# Bottega's Mac watcher: bottega-watcher status | once | install | uninstall
dir="$HOME/Library/Application Support/Bottega Watcher"
exec "$dir/node/bin/node" "$dir/bottega-watcher.cjs" "$@"
WRAPPER
  chmod 755 "$dir/bottega-watcher"

  if [ -n "$code" ]; then
    "$node" "$dir/bottega-watcher.cjs" claim --server "$server" --code "$code" </dev/null
  else
    "$node" "$dir/bottega-watcher.cjs" install </dev/null
  fi

  say ""
  say "Done. To see what the watcher is doing:"
  say "  \"$dir/bottega-watcher\" status"
}

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Bottega watcher: %s\n' "$*" >&2
  exit 1
}

main "$@"
