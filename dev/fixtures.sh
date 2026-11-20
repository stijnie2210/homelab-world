#!/bin/sh
set -eu

IMAGE=busybox:1.37

FIXTURES='
media jellyfin jellyfin/jellyfin
media sonarr lscr.io/linuxserver/sonarr
media radarr lscr.io/linuxserver/radarr
media qbittorrent lscr.io/linuxserver/qbittorrent
media navidrome deluan/navidrome
home homeassistant ghcr.io/home-assistant/home-assistant
home mosquitto eclipse-mosquitto
home zigbee2mqtt koenkk/zigbee2mqtt
home frigate ghcr.io/blakeblackshear/frigate
cloud nextcloud nextcloud
cloud nextcloud-db mariadb
cloud syncthing syncthing/syncthing
docs paperless ghcr.io/paperless-ngx/paperless-ngx
docs paperless-redis redis
docs gotenberg gotenberg/gotenberg
docs bookstack lscr.io/linuxserver/bookstack
auth vaultwarden vaultwarden/server
auth authentik-server ghcr.io/goauthentik/server
auth authentik-postgres postgres
monitoring grafana grafana/grafana
monitoring prometheus prom/prometheus
monitoring uptime-kuma louislam/uptime-kuma
monitoring dozzle amir20/dozzle
dev forgejo codeberg.org/forgejo/forgejo
dev woodpecker woodpeckerci/woodpecker-server
dev n8n n8nio/n8n
life mealie ghcr.io/mealie-recipes/mealie
life actual actualbudget/actual-server
life ntfy binwiederhier/ntfy
edge traefik traefik
edge docker-socket-proxy wollomatic/socket-proxy
edge cloudflared cloudflare/cloudflared
edge watchtower containrrr/watchtower
- homepage ghcr.io/gethomepage/homepage
- it-tools corentinth/it-tools
monitoring weather-station example/unknown-app
monitoring metrics-init busybox
'

down() {
  ids=$(docker ps -aq --filter label=homelab-world.fixture=1)
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  echo "fixtures removed"
}

up() {
  down
  docker pull -q "$IMAGE" >/dev/null
  echo "$FIXTURES" | while read -r project name image; do
    [ -z "$name" ] && continue
    set -- --label homelab-world.fixture=1
    [ "$project" != "-" ] && set -- "$@" --label "com.docker.compose.project=$project"
    case "$name" in
      grafana|vaultwarden|nextcloud) set -- "$@" --health-cmd true --health-interval 10s ;;
      authentik-server) set -- "$@" --health-cmd false --health-interval 10s --health-retries 1 ;;
      weather-station) set -- "$@" --label homelab-world.kind=observatory ;;
      metrics-init) set -- "$@" --label homelab-world.hide=true ;;
    esac
    case "$name" in
      jellyfin|n8n|frigate|prometheus) cmd='while true; do timeout 2 sh -c "while :; do :; done"; sleep 7; done' ;;
      *) cmd='sleep 2147483647' ;;
    esac
    docker run -d --name "$name" "$@" "$IMAGE" sh -c "$cmd" >/dev/null
  done
  echo "fixtures started: $(docker ps -q --filter label=homelab-world.fixture=1 | wc -l | tr -d ' ') containers"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
