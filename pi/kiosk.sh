#!/usr/bin/env bash
# Launch Overhead full-screen on a Raspberry Pi display.
# Edit the four values below, then run once by hand to test: ./pi/kiosk.sh
set -euo pipefail

LAT="30.0000"        # your patio latitude
LON="-95.0000"       # your patio longitude
RADIUS="5"           # miles
# Where the app is served from. Default: the public GitHub Pages copy.
# With your own receiver + the app copied to the Pi, use: http://localhost/overhead/
APP_URL="https://proostusn.github.io/overhead/"
# Leave empty to use the free online networks. With your own receiver, set e.g. /tar1090/data/aircraft.json
RECEIVER_JSON=""

PARAMS="kiosk=1&lat=${LAT}&lon=${LON}&radius=${RADIUS}"
[ -n "$RECEIVER_JSON" ] && PARAMS="${PARAMS}&source=local&url=${RECEIVER_JSON}"

# Keep the screen awake
xset s off 2>/dev/null || true; xset -dpms 2>/dev/null || true; xset s noblank 2>/dev/null || true

BROWSER=$(command -v chromium-browser || command -v chromium)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --check-for-update-interval=31536000 --password-store=basic \
  "${APP_URL}?${PARAMS}"
