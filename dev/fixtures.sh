#!/bin/sh
# Fills the city with small busybox containers named after common self-hosted apps, so you can
# check building kinds against a real Docker socket without running the real apps.
#   dev/fixtures.sh up      start them (again)
#   dev/fixtures.sh down    remove them
# They carry the label homelab-world.fixture=1, and a fake compose project label so they form districts.
set -eu

IMAGE=busybox:1.37

# project name image   (the image is only documentation: every fixture runs busybox, so kinds are matched on the name)
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
      # a few with a health check, one of them failing, so health states show up too
      grafana|vaultwarden|nextcloud) set -- "$@" --health-cmd true --health-interval 10s ;;
      authentik-server) set -- "$@" --health-cmd false --health-interval 10s --health-retries 1 ;;
      # the labels: an app nobody can guess gets a building picked by hand, a sidecar stays out of the city
      weather-station) set -- "$@" --label homelab-world.kind=observatory ;;
      metrics-init) set -- "$@" --label homelab-world.hide=true ;;
    esac
    case "$name" in
      # short CPU bursts now and then, so windows flicker and the factory smokes
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
