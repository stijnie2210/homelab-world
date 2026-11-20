# homelab world

Your Docker containers as a living pixel city. Every compose project is a district and every container is a building.

- **Buildings** depend on what the container is: Jellyfin is a cinema, Pi-hole a lighthouse, Immich a gallery, its ML worker a lab, databases are silos, VPNs bunkers, proxies gates, Uptime Kuma a watchtower, Unbound a radio mast, qBittorrent a warehouse, Portainer a crane. Everything else becomes an apartment tower.
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

## Hacking on the frontend

Set `WEB_DIR=/web` and mount `./web:/web` to serve the files from disk instead of the embedded copy. Then a browser refresh is enough to see changes. Building kinds live in `KINDS` in `web/world.js`.
