# homelab world

Your Docker containers as a living pixel city. Every compose project is a district and every container is a building.

- **Buildings** depend on what the container is (see [Buildings](#buildings)): Jellyfin is a cinema, Home Assistant a house with solar panels, Grafana an observatory, Vaultwarden a bank, Forgejo a factory that smokes with its CPU, Homepage a town hall with a working clock. Anything it can't place becomes an apartment tower, and a label lets you choose.
- **Windows** light up with CPU load and flicker more when a container is busy.
- **Cars** leave a building for outgoing traffic and arrive for incoming traffic.
- **Jellyfin** sweeps a searchlight across the sky while someone is streaming.
- **Health**: stopped containers go dark, unhealthy ones smoke with a red beacon, and starting ones get scaffolding. The watchtower turns red when anything is wrong.
- **Events** like start, stop, OOM and health changes trigger confetti, smoke and a ticker line.
- **Pi-hole** (optional): every blocked query is a drop of rain bouncing off a shield over the city.
- **Time of day** follows real time, with sky, sun, moon, stars and street lights.
- **Big stacks**: when the city is wider than the screen, the camera drifts slowly along the street and flies to a building when something happens to it. A minimap in the corner shows the whole city, with stopped and unhealthy containers in red.

## Try it without Docker

Open `web/index.html?demo` straight from disk, or `http://localhost:8099/?demo` on a running instance. Demo mode makes up a homelab of 36 containers in the browser, with streams, restarts, crashes and Pi-hole rain. Use `?demo=120` to see a bigger stack.

## Run

```sh
cp .env.example .env   # optional, for Pi-hole rain
docker compose up -d --build
open http://localhost:8099
```

It reads the Docker socket read-only. The backend is one stdlib-only Go binary with the frontend embedded.

## Buildings

The building is picked from the container's name and image. The first match in this list wins, so a database belonging to an app (`immich_postgres`, `paperless-db`) becomes a silo, not part of the app.

| Kind | Building | Recognises, for example |
|---|---|---|
| `lab` | lab with a glowing antenna | machine learning, Ollama, Open WebUI, Whisper |
| `silo` | silo | Postgres, MariaDB, MySQL, Redis, Valkey, InfluxDB, Elasticsearch, names ending in `-db` |
| `bunker` | bunker | socket proxies, Gluetun, WireGuard, Tailscale, Cloudflared, CrowdSec |
| `crane` | construction crane | Portainer, Watchtower, Diun, Komodo, Dockge |
| `studio` | broadcast studio in the app's colour, with its letter on the front and a dish that turns with the traffic | Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Seerr, Jackett, Autobrr |
| `cinema` | cinema, searchlight while streaming | Jellyfin, Plex, Emby, Navidrome |
| `lighthouse` | lighthouse | Pi-hole, AdGuard Home, Blocky |
| `antenna` | radio mast | Unbound, dnsmasq, CoreDNS |
| `gallery` | museum | Immich, PhotoPrism, Lychee |
| `watchtower` | watchtower, red when anything is wrong | Uptime Kuma, Gatus, Healthchecks, Frigate |
| `observatory` | observatory | Grafana, Prometheus, Netdata, Loki, Dozzle, Beszel |
| `house` | house with a smart light | Home Assistant, Zigbee2MQTT, ESPHome, Node-RED |
| `postoffice` | post office, envelopes fly with the traffic | Mosquitto, RabbitMQ, NATS, ntfy, Gotify, mail servers |
| `bank` | bank, the vault door turns while it works | Vaultwarden, Authentik, Authelia, Keycloak, Actual, Firefly III |
| `office` | glass office tower | Nextcloud, Seafile, OnlyOffice, Filebrowser |
| `library` | library with books in the window | Paperless, Calibre, Kavita, Audiobookshelf, BookStack, wikis, Linkding, FreshRSS |
| `factory` | factory, smokes with its CPU | Forgejo, Gitea, GitLab, CI runners, n8n, Tdarr, Stirling PDF |
| `townhall` | town hall with a clock and an "N UP" sign | Homepage, Homarr, Heimdall, Dashy, Glance |
| `shop` | corner shop | Mealie, Grocy, IT-Tools, CyberChef, PrivateBin |
| `warehouse` | warehouse | qBittorrent, SABnzbd, Syncthing, MinIO, backup tools |
| `gate` | city gate | Traefik, Caddy, nginx, Nginx Proxy Manager |
| `tower` | apartment tower | everything else |

### Labels

| Label | Effect |
|---|---|
| `homelab-world.kind=observatory` | use this building, whatever the name or image says |
| `homelab-world.hide=true` | leave the container out of the city and the ticker (init containers, sidecars) |

```yaml
services:
  weather:
    image: example/weather-station
    labels:
      homelab-world.kind: observatory
```

## Controls

| | |
|---|---|
| `N` | cycle day / dusk / night / dawn / live |
| `D` | fire a random demo event, plus some rain |
| double-click | fullscreen (good for a wall tablet) |
| drag, scroll, `←` `→` | pan a city that's wider than the screen; the camera leaves you alone for 30 seconds |
| `?hour=21` | freeze the time of day |
| `?speed=600` | fast-forward the day |
| `?scale=4` | force pixel size |
| `?fit` | shrink the pixels until the whole city fits, instead of panning |
| `?demo`, `?demo=120` | made-up homelab, no Docker needed |

## Hacking on it

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build   # serves web/ from disk
dev/fixtures.sh up                                                 # a fake homelab of ~37 busybox containers
dev/fixtures.sh down                                               # remove them again
```

With `compose.dev.yaml`, a browser refresh is enough to see frontend changes; Go changes need the `--build`. The fixtures are named after common apps, a few have (failing) health checks or CPU bursts, and two show the labels. Building kinds live in `KINDS` in `web/world.js`, the matching rules in `KIND_RULES`.
