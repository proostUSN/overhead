# Spot-Air

A flight tracker for your phone: every aircraft within a few miles of you, with its route, type, altitude, speed, direction and a photo. It uses free, community-run ADS-B networks, so there are no accounts or API keys. The same app runs on a Raspberry Pi patio display, and can read straight from your own ADS-B receiver.

**Open it:** https://proostusn.github.io/overhead/

## How live data reaches the app

The free ADS-B networks don't let web pages on other sites read their data (no CORS headers), and they refuse requests from cloud servers such as Cloudflare Workers. So the app reads them through a small relay running at home, on a Synology NAS, reached securely through Tailscale Funnel. Its address is built into the app, so there's nothing to set up on phones.

- Relay code: [`nas/server.mjs`](nas/server.mjs). It forwards only to adsb.lol, adsb.fi and airplanes.live, only for this app's page, caches answers for 5 seconds, and rate-limits each visitor.
- Setup: [`nas/docker-compose.yml`](nas/docker-compose.yml), pasted into Synology Container Manager. No router ports are opened, and the relay isn't reachable on the home network. Both containers run without privileges; the relay code is pinned to a commit and checked against a SHA-256 checksum.
- To run your own relay, deploy the same compose file with your own Tailscale key and put its address in Settings → Relay address.

`relay/worker.js` (Cloudflare Worker) is kept for reference; the networks currently block it.

## Install on your phone

- **iPhone (Safari):** open the link, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).

Allow location when asked. If you say no, open Settings (gear icon) and set a fixed point instead.

## What you see

One card, like a weather widget, for the nearest aircraft within 5 miles:

- **Airline logo** (or, for private aircraft, a badge with the manufacturer), **flight number**, and airline
- **Aircraft type** and **tail number**
- **Altitude, speed and heading**, with climb or descent rate
- **Distance and direction** from you
- **Origin → destination line** with the aircraft's position along it. The fill is green while climbing, blue in level flight, and amber while descending.

When more than one aircraft is in range, a faint row of tabs across the top lets you switch between them. Tap the card for details: photo, full airport names, squawk, Mode S code, and links to the live map and FlightAware.

The background follows the real sky at your location: blue with drifting clouds by day, warm at dawn and dusk, stars at night, with the sun and moon (at its current phase) placed where they actually are, facing south. With nothing in range, the card shows the time and the last aircraft seen.

Airline logos load from public logo services (images.kiwi.com, FlightAware) by airline code. Logos are trademarks of their airlines; when one isn't available the card shows the airline's code instead.

## Sky view

Tap **Sky** (top right) and point your phone at the sky. The camera view shows every aircraft nearby where it actually is, with flight number, altitude, distance, how high it is above the horizon, and whether it's coming toward you, moving away or crossing. Each aircraft is drawn as a shaded 3D model of its type (wide-body, four-engine, narrow-body, rear-engine regional or business jet, turboprop, small single-engine, helicopter), oriented by its real heading and climb or descent angle and seen from your exact viewing angle, so you see its belly overhead, its side as it crosses, or its nose as it comes toward you. Models are drawn larger than true size; wingtip lights are on the correct sides, with strobes and a beacon at night. Aircraft out of view get an arrow on the screen edge showing which way to turn. Tap a plane for its details.

- The sky view reaches out to **10 miles** (the cards keep your normal radius).
- A soft **halo** around each aircraft shows how it's moving relative to you: **green** while it's still closing, **amber** at or near its closest point, **red** once it's moving away.
- Text stays level with the horizon however you hold the phone, and the readout turns to whichever edge is up.
- The horizon, compass points and 30°/60° lines are drawn over the view, along with the **sun** and **moon** (at its current phase) in their real positions, and stars at night when the camera is off.
- Markers follow the time of day: light labels by day, dark with a glow and red/green wingtip lights at night.
- Positions are moved forward from the last data update along each plane's heading and speed, so markers keep up with fast jets.
- **Compass accuracy** on phones is about ±5–15°. If markers sit a little to the side of the real plane, **drag sideways** to line them up; **double-tap** resets. If the app says the compass needs calibrating, wave the phone in a figure 8.
- The first time, iPhone asks to allow **Motion & Orientation** and the **camera**. Without the camera it still works over a painted sky.

## Settings

| Setting | Notes |
|---|---|
| Data source | **Automatic** tries airplanes.live, then adsb.lol, then adsb.fi. Pick one to pin it, or **My receiver** for a local readsb/tar1090. |
| Radius | 1–25 miles (default 5). |
| Refresh | 5–60 seconds (default 10). The free APIs allow about 1 request per second per user, so anything 5 s or slower is polite. |
| Location | Follow your phone, or a fixed point (patio, receiver site). |
| Patio display mode | Large featured aircraft that rotates every 12 s, screen kept awake. |
| Demo traffic | Simulated aircraft, for checking the app when nothing is flying. |

Everything can also be set with URL parameters, which the Pi uses:
`?relay=https://…workers.dev&kiosk=1&lat=30.1&lon=-95.4&radius=5&refresh=10&source=local&url=/tar1090/data/aircraft.json&units=metric&ground=1&demo=1`

## Where the data comes from

| What | Source | Notes |
|---|---|---|
| Positions, altitude, speed, type | [airplanes.live](https://airplanes.live/api-guide/), [adsb.lol](https://api.adsb.lol/docs), [adsb.fi](https://github.com/adsbfi/opendata) | Free, non-commercial, no uptime guarantee. |
| Routes | [adsbdb](https://www.adsbdb.com/), adsb.lol route set | Looked up by callsign. Usually right; can be stale for some flights. |
| Aircraft records | adsbdb | Registration, type and owner when the live feed lacks them. |
| Photos | [Planespotters.net](https://www.planespotters.net/photo/api) | Photographer credited under each photo, linked to the original as their terms require. |

Your exact location never leaves your device. Flight-data queries (and the relay) only see a point rounded to 0.01° (under a mile), and the app works out exact distances on the phone. Lookups are cached on the device (routes 6 h, aircraft and photos 7 days).

If one network is down, **Automatic** moves to the next one. Running your own receiver (below) removes the dependency on all three for positions.

## Raspberry Pi patio display

### What to get
- Raspberry Pi 4 or 5 (2 GB+), power supply, microSD card (32 GB)
- A display: the official 7" touchscreen, or any HDMI monitor
- Later, for your own receiver: an RTL-SDR dongle tuned for 1090 MHz (for example a FlightAware Pro Stick Plus) and a 1090 MHz antenna mounted as high and clear as you can

### Step 1: Display only (uses the online networks)
1. Flash **Raspberry Pi OS (64-bit, with desktop)** using Raspberry Pi Imager. Set Wi-Fi and a username in the Imager settings.
2. On the Pi, open a terminal:
   ```bash
   git clone https://github.com/proostUSN/overhead.git ~/overhead
   nano ~/overhead/pi/kiosk.sh      # set LAT and LON to your patio
   chmod +x ~/overhead/pi/kiosk.sh
   ~/overhead/pi/kiosk.sh           # test; press Alt+F4 to exit
   ```
3. Start it on boot. On current Raspberry Pi OS (labwc desktop):
   ```bash
   mkdir -p ~/.config/labwc
   echo "$HOME/overhead/pi/kiosk.sh &" >> ~/.config/labwc/autostart
   ```
   On older Pi OS using Wayfire, add to `~/.config/wayfire.ini` under `[autostart]`: `overhead = /home/<you>/overhead/pi/kiosk.sh`

### Step 2: Add your own ADS-B receiver
1. Plug in the SDR and antenna, then install the decoder and web map:
   ```bash
   sudo bash -c "$(wget -O - https://github.com/wiedehopf/adsb-scripts/raw/master/readsb-install.sh)"
   sudo readsb-set-location 30.1234 -95.1234     # your antenna location
   sudo bash -c "$(wget -q -O - https://github.com/wiedehopf/tar1090/raw/master/install.sh)"
   ```
   Check `http://<pi-address>/tar1090/` in a browser; you should see aircraft.
2. Serve Spot-Air from the same web server, so it can read the receiver directly:
   ```bash
   sudo ln -s ~/overhead /var/www/html/overhead
   ```
3. In `pi/kiosk.sh` set:
   ```bash
   APP_URL="http://localhost/overhead/"
   RECEIVER_JSON="/tar1090/data/aircraft.json"
   ```
   Routes and photos still come from the internet; positions now come from your antenna.
4. Optional: feed your data back to airplanes.live or adsb.lol. Both have one-line feeder scripts, and feeding helps keep these free networks running.

Your phone can also read the receiver at `http://<pi-address>/overhead/?source=local&url=/tar1090/data/aircraft.json` while on home Wi-Fi. Browsers only give GPS location to HTTPS sites, so on that address set a fixed point, which matches the receiver anyway.

### Updating the Pi
```bash
cd ~/overhead && git pull
```

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and styles |
| `app.js` | Data sources, enrichment, cards, settings, patio display mode |
| `ar.js` | Sky view: camera, compass/tilt sensors, sky projection |
| `sw.js` | Service worker: app works offline as a shell, caches photos |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `pi/kiosk.sh` | Full-screen launcher for the Pi |
| `relay/worker.js` | Cloudflare Worker that adds CORS to the free feeds |

No build step. To run locally: `python3 -m http.server 8000`, then open http://localhost:8000/?demo=1
