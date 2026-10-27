#!/bin/bash
# Keeps the app running as a macOS login agent, so the 12-hour reruns happen after a reboot or a closed terminal.
#
#   npm run agent:install     start the app now and at every login, restart it if it stops
#   npm run agent:status      is it loaded, and does the port answer
#   npm run agent:uninstall   stop it and remove the agent
#
# The agent runs `npm run dev:keychain` from this folder on PORT (default 5190), so the OpenRouter key still comes from
# the keychain at launch and is never written to the agent file. Logs go to ~/Library/Logs/dobig-daemon-suite.log.
# If another copy of the app already holds the port, install stops and says so; TAKE_OVER=1 stops that copy first.
set -eu
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LABEL="com.dobig.daemon-suite"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/dobig-daemon-suite.log"
PORT="${PORT:-5190}"
DOMAIN="gui/$(id -u)"

[ "$(uname)" = "Darwin" ] || { echo "The login agent is macOS only (launchd)." >&2; exit 1; }

holder() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

case "${1:-status}" in
  install)
    command -v node >/dev/null || { echo "node was not found on PATH." >&2; exit 1; }
    NODE_DIR="$(dirname "$(command -v node)")"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    PID="$(holder)"
    if [ -n "$PID" ]; then
      if [ "${TAKE_OVER:-0}" = "1" ]; then
        echo "Stopping the copy on port $PORT (pid $PID)."
        kill "$PID"
        sleep 2
      else
        echo "Port $PORT is in use (pid $PID). Stop that copy first, or run: TAKE_OVER=1 npm run agent:install" >&2
        exit 1
      fi
    fi
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "$ROOT" &amp;&amp; exec npm run dev:keychain</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    chmod 644 "$PLIST"
    launchctl bootstrap "$DOMAIN" "$PLIST"
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Installed $LABEL. The app starts at login and restarts if it stops. Log: $LOG"
    echo "Check it with: npm run agent:status"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL."
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|pid|last exit code|runs) =" || true
    else
      echo "The login agent is not installed. Run: npm run agent:install"
    fi
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" || true)"
    echo "http://127.0.0.1:$PORT/api/status answers: ${CODE:-none}"
    ;;
  *)
    echo "usage: bash scripts/agent.sh install|uninstall|status" >&2
    exit 2
    ;;
esac
