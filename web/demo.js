'use strict';

// Demo mode: a made-up homelab that lives entirely in the browser, so the city can be shown
// without a Docker socket (a README GIF, a static demo page, or just trying it out).
//   ?demo        about 36 containers in 9 compose projects
//   ?demo=120    a bigger stack, to see how the city copes

const DEMO_STACK = [
  ['mediastack', ['gluetun qmcgaw/gluetun', 'qbittorrent lscr.io/linuxserver/qbittorrent', 'prowlarr lscr.io/linuxserver/prowlarr',
    'radarr lscr.io/linuxserver/radarr', 'sonarr lscr.io/linuxserver/sonarr', 'bazarr lscr.io/linuxserver/bazarr',
    'seerr ghcr.io/seerr-team/seerr', 'flaresolverr ghcr.io/flaresolverr/flaresolverr', 'jellyfin jellyfin/jellyfin']],
  ['immich', ['immich_server ghcr.io/immich-app/immich-server', 'immich_machine_learning ghcr.io/immich-app/immich-machine-learning',
    'immich_redis valkey/valkey', 'immich_postgres ghcr.io/immich-app/postgres']],
  ['dns', ['pihole pihole/pihole', 'unbound mvance/unbound']],
  ['proxy', ['traefik traefik', 'docker-socket-proxy wollomatic/socket-proxy']],
  ['monitoring', ['uptime-kuma louislam/uptime-kuma', 'grafana grafana/grafana', 'prometheus prom/prometheus', 'node-exporter prom/node-exporter']],
  ['home', ['homeassistant ghcr.io/home-assistant/home-assistant', 'mosquitto eclipse-mosquitto', 'zigbee2mqtt koenkk/zigbee2mqtt', 'nodered nodered/node-red']],
  ['nextcloud', ['nextcloud nextcloud', 'nextcloud-db mariadb', 'nextcloud-redis redis']],
  ['paperless', ['paperless ghcr.io/paperless-ngx/paperless-ngx', 'paperless-db postgres', 'paperless-redis redis',
    'gotenberg gotenberg/gotenberg', 'tika apache/tika']],
  ['', ['portainer portainer/portainer-ce', 'vaultwarden vaultwarden/server', 'homepage ghcr.io/gethomepage/homepage']],
];

// Extra apps for ?demo=N beyond the base stack, grouped into small projects.
const DEMO_EXTRA = ['gitea', 'audiobookshelf', 'navidrome', 'syncthing', 'freshrss', 'mealie', 'actual', 'linkding',
  'stirling-pdf', 'it-tools', 'dozzle', 'watchtower', 'authentik-server', 'authentik-worker', 'code-server', 'minio', 'n8n',
  'changedetection', 'frigate', 'scrypted', 'kavita', 'calibre-web', 'wikijs', 'bookstack', 'ntfy', 'gotify',
  'speedtest-tracker', 'glances', 'netdata', 'duplicati', 'adguardhome', 'wg-easy', 'tailscale', 'cloudflared', 'plex',
  'tautulli', 'lidarr', 'readarr', 'homarr', 'grocy', 'firefly', 'immich-kiosk', 'jackett', 'tdarr', 'unmanic'];

function demoContainers(count) {
  const out = [];
  for (const [project, list] of DEMO_STACK) {
    for (const entry of list) {
      const [name, image] = entry.split(' ');
      out.push({ name, image: image + ':latest', project });
    }
  }
  for (let i = 0; out.length < count; i++) {
    const app = DEMO_EXTRA[i % DEMO_EXTRA.length];
    const round = Math.floor(i / DEMO_EXTRA.length);
    const name = round ? `${app}-${round + 1}` : app;
    const project = `${DEMO_EXTRA[Math.floor(i / 4) * 4 % DEMO_EXTRA.length]}${round ? '-' + (round + 1) : ''}`;
    out.push({ name, image: `example/${app}:latest`, project });
    if (i % 4 === 1) out.push({ name: name + '-db', image: 'postgres:17', project });
  }
  return out.slice(0, count);
}

function startDemo({ onSnapshot, onEvent, count }) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const startedAt = Date.now();

  const sims = demoContainers(count).map((c, i) => {
    const n = c.name;
    const busy = /jellyfin|machine_learning|postgres|qbittorrent|frigate|homeassistant/.test(n) ? 3 : 1;
    return {
      ...c,
      id: (0x1000000 + i * 7919).toString(16).padStart(12, '0'),
      state: 'running',
      health: i % 3 === 0 ? 'healthy' : '',
      upSince: startedAt - rand(1, 400) * 3600e3,
      cpuBase: rand(0.2, 2.5) * busy,
      cpu: 0,
      mem: rand(40, 900) * busy * 1048576,
      rxBase: rand(200, 12e3) * busy,
      txBase: rand(200, 12e3) * busy,
      netRx: 0,
      netTx: 0,
      streamUntil: 0,
    };
  });
  const byName = new Map(sims.map((s) => [s.name, s]));
  const pihole = { total: 182340, blocked: 21877 };

  const status = (s) => {
    if (s.state === 'exited') return 'Exited (137) a few seconds ago';
    if (s.state === 'restarting') return 'Restarting (1) 1 second ago';
    if (s.state === 'paused') return 'Up (Paused)';
    const h = Math.max(1, Math.round((Date.now() - s.upSince) / 3600e3));
    const health = s.health === 'starting' ? ' (health: starting)' : s.health ? ` (${s.health})` : '';
    return `Up ${h} hours${health}`;
  };

  function tick() {
    const now = Date.now();
    for (const s of sims) {
      if (s.state !== 'running') {
        s.cpu = s.netRx = s.netTx = 0;
        continue;
      }
      if (/jellyfin|plex/.test(s.name) && now > s.streamUntil && Math.random() < 0.04) {
        s.streamUntil = now + rand(30, 90) * 1000;
      }
      const streaming = now < s.streamUntil;
      const spike = Math.random() < 0.05 ? rand(5, 60) : 0;
      s.cpu = Math.max(0, s.cpuBase * rand(0.5, 1.6) + spike + (streaming ? rand(25, 60) : 0));
      s.netRx = s.rxBase * rand(0.3, 2) * (Math.random() < 0.08 ? rand(20, 200) : 1);
      s.netTx = s.txBase * rand(0.3, 2) * (Math.random() < 0.08 ? rand(20, 200) : 1) + (streaming ? rand(1.5e6, 4e6) : 0);
      if (s.name === 'qbittorrent') s.netRx += rand(2e5, 3e6);
    }
    pihole.total += Math.floor(rand(4, 30));
    pihole.blocked += Math.random() < 0.7 ? Math.floor(rand(0, 6)) : 0;

    onSnapshot({
      type: 'snapshot',
      time: now,
      pihole: { ...pihole },
      containers: sims.map((s) => ({
        id: s.id, name: s.name, image: s.image, project: s.project, state: s.state, health: s.health,
        status: status(s), cpu: s.cpu, mem: s.state === 'running' ? s.mem : 0, netRx: s.netRx, netTx: s.netTx,
      })),
    });
  }

  function emit(s, action) {
    onEvent({ type: 'event', time: Math.floor(Date.now() / 1000), action, name: s.name, project: s.project });
  }

  const later = (sec, fn) => setTimeout(() => { fn(); tick(); }, sec * 1000);

  // A small script of mishaps, like a real homelab on a normal day.
  function mishap() {
    const healthy = sims.filter((s) => s.state === 'running' && s.health !== 'unhealthy');
    const s = pick(healthy);
    const down = sims.filter((x) => x.state !== 'running').length;
    const roll = Math.random();
    if (!s) return;

    if (roll < 0.3) {
      s.state = 'restarting';
      emit(s, 'restart');
      later(rand(2, 5), () => { s.state = 'running'; s.upSince = Date.now(); emit(s, 'start'); });
    } else if (roll < 0.5 && down < 2) {
      s.state = 'exited';
      emit(s, 'die');
      later(rand(8, 20), () => { s.state = 'running'; s.upSince = Date.now(); emit(s, 'start'); });
    } else if (roll < 0.68) {
      s.health = 'unhealthy';
      emit(s, 'unhealthy');
      later(rand(10, 25), () => { s.health = 'healthy'; emit(s, 'healthy'); });
    } else if (roll < 0.8 && down < 2) {
      emit(s, 'oom');
      s.state = 'restarting';
      later(rand(3, 6), () => { s.state = 'running'; s.upSince = Date.now(); s.health = s.health && 'starting'; emit(s, 'start'); });
      if (s.health) later(rand(9, 14), () => { s.health = 'healthy'; emit(s, 'healthy'); });
    } else if (roll < 0.88) {
      s.state = 'paused';
      emit(s, 'pause');
      later(rand(8, 15), () => { s.state = 'running'; emit(s, 'unpause'); });
    } else {
      const j = byName.get('jellyfin') || byName.get('plex');
      if (j) j.streamUntil = Date.now() + rand(40, 90) * 1000;
    }
    tick();
  }

  tick();
  setInterval(tick, 2000);
  (function schedule() {
    setTimeout(() => { mishap(); schedule(); }, rand(6, 14) * 1000);
  })();
}
