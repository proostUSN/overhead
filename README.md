# Overhead

A flight tracker for your phone: every aircraft within a few miles of you, with its route, type, altitude, speed, direction and a photo. It uses free, community-run ADS-B networks, so there are no accounts or API keys. The same app runs on a Raspberry Pi patio display, and can read straight from your own ADS-B receiver.

**Open it:** https://proostusn.github.io/overhead/

## Install on your phone

- **iPhone (Safari):** open the link, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).

Allow location when asked. If you say no, open Settings (gear icon) and set a fixed point instead.

## What you see

- **Scope:** north-up view of the area around you with range rings. Each square is an aircraft; the line shows where it's heading. Green is climbing, amber is descending.
- **Strips:** one per aircraft, nearest first: callsign, registration, route (origin → destination), aircraft type, altitude, speed, and distance and direction from you.
- **Tap a strip** for a large photo, full route with airport names, and links to the live map and FlightAware.

Altitudes at or above 18,000 ft show as flight levels (FL340 = 34,000 ft). Squawks 7500/7600/7700 are flagged in red.

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
`?kiosk=1&lat=30.1&lon=-95.4&radius=5&refresh=10&source=local&url=/tar1090/data/aircraft.json&units=metric&ground=1&demo=1`

## Where the data comes from

| What | Source | Notes |
|---|---|---|
| Positions, altitude, speed, type | [airplanes.live](https://airplanes.live/api-guide/), [adsb.lol](https://api.adsb.lol/docs), [adsb.fi](https://github.com/adsbfi/opendata) | Free, non-commercial, no uptime guarantee. |
| Routes | [adsbdb](https://www.adsbdb.com/), adsb.lol route set | Looked up by callsign. Usually right; can be stale for some flights. |
| Aircraft records | adsbdb | Registration, type and owner when the live feed lacks them. |
| Photos | [Planespotters.net](https://www.planespotters.net/photo/api) | Photographer credited under each photo, linked to the original as their terms require. |

Your location stays on your device except for the latitude and longitude sent in each ADS-B query. Lookups are cached on the device (routes 6 h, aircraft and photos 7 days).

If one network blocks browser requests or is down, **Automatic** moves to the next one. Running your own receiver (below) removes the dependency on all three for positions.

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
2. Serve Overhead from the same web server, so it can read the receiver directly:
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
| `app.js` | Data sources, enrichment, scope, strips, settings, kiosk mode |
| `sw.js` | Service worker: app works offline as a shell, caches photos |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `pi/kiosk.sh` | Full-screen launcher for the Pi |

No build step. To run locally: `python3 -m http.server 8000`, then open http://localhost:8000/?demo=1
