#!/usr/bin/env bash
# Spot-Air relay on a Raspberry Pi — one-command setup.
#
# Runs the same locked-down relay + Tailscale Funnel tunnel as nas/docker-compose.yml,
# so the Pi can take over from the Synology. No router ports are opened.
#
# Before running:
#   1. In the Tailscale admin console, stop/remove the old relay so the name is free:
#      - Synology: Container Manager > Project > overhead-relay > Stop
#      - Tailscale: Machines > overhead-relay > ... > Remove
#   2. Generate a one-time auth key: Settings > Keys > Generate auth key
#      (Reusable off, Ephemeral off; if your policy limits Funnel to tag:relay, add Tags: tag:relay)
#
# Run on the Pi (Raspberry Pi OS Lite, 64-bit recommended):
#   curl -fsSL https://raw.githubusercontent.com/proostUSN/overhead/main/pi/setup-relay.sh -o setup-relay.sh
#   bash setup-relay.sh
set -euo pipefail

DIR=/opt/spot-air-relay
COMPOSE_URL="https://raw.githubusercontent.com/proostUSN/overhead/main/nas/docker-compose.yml"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
$SUDO true || { echo "This script needs sudo rights."; exit 1; }

# 1) Tailscale auth key (hidden while typing; never written to the script output).
KEY="${TS_AUTHKEY:-}"
if [ -z "$KEY" ]; then
  read -r -s -p "Paste your Tailscale auth key (starts with tskey-auth-), then press Enter: " KEY; echo
fi
case "$KEY" in tskey-*) ;; *) echo "That doesn't look like a Tailscale auth key (should start with tskey-)."; exit 1;; esac

# 2) System updates + automatic security updates.
say "Updating the system (this can take a few minutes)…"
$SUDO apt-get update -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl unattended-upgrades
$SUDO dpkg-reconfigure -f noninteractive unattended-upgrades || true

# 3) Docker (official installer, includes the compose plugin).
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  $SUDO sh /tmp/get-docker.sh
fi
$SUDO systemctl enable --now docker

# 4) Relay files: the same compose file the NAS uses; the key goes in a private .env file.
say "Writing the relay configuration to $DIR…"
$SUDO mkdir -p "$DIR"
$SUDO curl -fsSL "$COMPOSE_URL" -o "$DIR/docker-compose.yml"
$SUDO sed -i 's|"PASTE-YOUR-TAILSCALE-AUTH-KEY-HERE"|"${TS_AUTHKEY}"|' "$DIR/docker-compose.yml"
grep -q 'TS_AUTHKEY: "${TS_AUTHKEY}"' "$DIR/docker-compose.yml" || { echo "Unexpected compose file format; stopping."; exit 1; }
printf 'TS_AUTHKEY=%s\n' "$KEY" | $SUDO tee "$DIR/.env" >/dev/null
$SUDO chmod 600 "$DIR/.env"
unset KEY

# 5) Start it (it restarts on its own after reboots and power cuts).
say "Starting the relay…"
cd "$DIR"
$SUDO docker compose -p overhead-relay pull
$SUDO docker compose -p overhead-relay up -d

# 6) Weekly refresh of the container images, for security fixes.
$SUDO tee /etc/cron.weekly/spot-air-relay >/dev/null <<'EOF'
#!/bin/sh
cd /opt/spot-air-relay && docker compose -p overhead-relay pull -q && docker compose -p overhead-relay up -d
docker image prune -f >/dev/null 2>&1
EOF
$SUDO chmod 755 /etc/cron.weekly/spot-air-relay

# 7) Check it came up and report the public address.
say "Waiting for the tunnel to come up…"
NAME=""
for _ in $(seq 1 30); do
  NAME=$($SUDO docker exec overhead-tailscale tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')
  [ -n "$NAME" ] && break
  sleep 3
done
$SUDO docker compose -p overhead-relay ps
if [ -n "$NAME" ]; then
  say "Done. Relay address: https://$NAME"
  if [ "$NAME" != "overhead-relay.tail71c8a7.ts.net" ]; then
    echo "Note: this differs from the address the app uses (overhead-relay.tail71c8a7.ts.net)."
    echo "Remove any old 'overhead-relay' machine in Tailscale, or send this address to update the app."
  fi
  echo "Test it from any browser: https://$NAME  (should say 'Overhead relay is running')"
else
  echo "The tunnel didn't report in yet. Check: sudo docker logs overhead-tailscale --tail 30"
fi
