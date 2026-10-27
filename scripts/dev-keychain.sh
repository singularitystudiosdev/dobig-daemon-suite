#!/bin/bash
# Starts the dev server with an image-provider key taken from the macOS keychain at launch.
# The key lives only in this process's environment: it is never written to a file, a log or the browser.
#
#   npm run dev:keychain
#
# KEYCHAIN_SERVICE  keychain item (service name) holding an OpenRouter key. Default OPENROUTER_API_KEY.
# KEYCHAIN_ACCOUNT  optional account name, if several items share the service.
# PORT              dev server port. Default 5190.
# A key already in OPENROUTER_API_KEY or GEMINI_API_KEY in your environment wins over the keychain.
set -eu
cd "$(dirname "$0")/.."

SERVICE="${KEYCHAIN_SERVICE:-OPENROUTER_API_KEY}"

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
  KEY=""
  if [ -n "${KEYCHAIN_ACCOUNT:-}" ]; then
    KEY="$(security find-generic-password -s "$SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
  else
    KEY="$(security find-generic-password -s "$SERVICE" -w 2>/dev/null || true)"
  fi
  if [ -n "$KEY" ]; then
    export OPENROUTER_API_KEY="$KEY"
    echo "dev-keychain: using the OpenRouter key from keychain item '$SERVICE'"
  else
    echo "dev-keychain: no readable keychain item '$SERVICE' (missing, or access was denied). Starting without a server key; paste one in the app instead." >&2
  fi
  unset KEY
fi

exec npx vite --port "${PORT:-5190}" --strictPort --host 127.0.0.1
