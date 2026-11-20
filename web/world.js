'use strict';

// homelab world: every container is a building, every compose project a district.
// All art is drawn at a low logical resolution and scaled up with nearest-neighbour.
//
// URL params:  ?hour=21  freeze time of day   ?speed=600  fast-forward the day   ?scale=4  force pixel size
// Keys:        N  cycle day/dusk/night/dawn/live    D  fire a demo event (and some Pi-hole rain)
// Double-click toggles fullscreen.

const params = new URLSearchParams(location.search);

// ---------- utils ----------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}
function toHex(r, g, b) {
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
const colorCache = new Map();
function shade(c, amt) {
  const k = c + amt;
  let v = colorCache.get(k);
  if (!v) {
    v = amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt);
    colorCache.set(k, v);
  }
  return v;
}
function dim(c) {
  const k = 'dim' + c;
  let v = colorCache.get(k);
  if (!v) {
    const [r, g, b] = rgb(c);
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    v = mix(toHex(l, l, l), '#2a2a36', 0.6);
    colorCache.set(k, v);
  }
  return v;
}

function fmtBytes(n) {
  if (n < 1024) return n.toFixed(0) + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}

// ---------- canvases ----------

const display = document.getElementById('world');
const dctx = display.getContext('2d');
const frame = document.createElement('canvas');
const fctx = frame.getContext('2d');
const layer = document.createElement('canvas');
const lctx = layer.getContext('2d');
const tip = document.getElementById('tip');

let W = 320, H = 200, S = 1, GROUND = 156;
let g = fctx; // current drawing target

function R(x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.floor(x), Math.floor(y), w, h);
}

function disc(cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    R(cx - half, cy + dy, half * 2 + 1, 1, c);
  }
}

// ---------- 3x5 pixel font ----------

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  '-': '000000111000000', _: '000000000000111', ':': '000010000010000', '.': '000000000000010',
  '/': '001001010100100', '%': '101001010100101', '!': '010010010000010', '?': '110001010000010',
  '(': '010100100100010', ')': '010001001001010', '+': '000010111010000', '>': '100010001010100',
  ' ': '000000000000000',
};

function text(str, x, y, c) {
  g.fillStyle = c;
  str = str.toUpperCase();
  for (let i = 0; i < str.length; i++) {
    const glyph = FONT[str[i]] || FONT['?'];
    for (let p = 0; p < 15; p++) {
      if (glyph[p] === '1') g.fillRect(Math.floor(x) + i * 4 + (p % 3), Math.floor(y) + ((p / 3) | 0), 1, 1);
    }
  }
}
const textWidth = (s) => s.length * 4 - 1;

// ---------- time of day ----------

const SKY = [ // [hour, top, horizon]
  [0, '#0b0e24', '#1d2148'],
  [5, '#141838', '#3b2f5c'],
  [6.5, '#3d4a8c', '#f0a07a'],
  [8, '#5aa0e6', '#b8e0f5'],
  [17, '#5592d9', '#c2dcef'],
  [19, '#3e3a7a', '#f08a5d'],
  [20.5, '#151a3d', '#3a2d5e'],
  [24, '#0b0e24', '#1d2148'],
];

const FORCED = [null, 12, 19, 23, 6.5];
let forcedIdx = 0;
const startedAt = performance.now();
const startHour = params.has('hour') ? parseFloat(params.get('hour')) : null;
const speed = params.has('speed') ? parseFloat(params.get('speed')) : 1;

function currentHour() {
  if (FORCED[forcedIdx] != null) return FORCED[forcedIdx];
  if (startHour != null && speed === 1) return startHour;
  const d = new Date();
  const real = startHour ?? d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return (real + ((performance.now() - startedAt) / 3600000) * (speed - 1) + 24) % 24;
}

function skyAt(h) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const k = (h - h0) / (h1 - h0);
      return [mix(t0, t1, k), mix(b0, b1, k)];
    }
  }
  return [SKY[0][1], SKY[0][2]];
}

function nightAt(h) {
  if (h >= 21 || h < 5) return 1;
  if (h < 7.5) return 1 - (h - 5) / 2.5;
  if (h < 17.5) return 0;
  return (h - 17.5) / 3.5;
}

function goldenAt(h) {
  return clamp(Math.max(1 - Math.abs(h - 19) / 1.5, 1 - Math.abs(h - 6.5) / 1.2), 0, 1);
}

// ---------- buildings ----------

const PALETTE = ['#5b6ee1', '#306082', '#76428a', '#8f563b', '#37946e', '#524b24', '#45283c', '#663931', '#595652', '#3f3f74', '#4b692f', '#847e87'];
const BRAND = {
  sonarr: '#2f9fd8', radarr: '#d9a51e', prowlarr: '#d9622b', lidarr: '#2f8f5a', bazarr: '#6c8a3a',
  seerr: '#7b5cd6', flaresolverr: '#c9733a', postgres: '#3d6b99', redis: '#b5413a', valkey: '#5a6fd6',
  portainer: '#13a8d9', jellyfin: '#8f2d3a', plex: '#c98a1b', homeassistant: '#2a9fd6', 'home-assistant': '#2a9fd6',
  grafana: '#e8700f', nextcloud: '#0082c9', vaultwarden: '#2f6fd6', bitwarden: '#2f6fd6', authentik: '#fd4b2d',
  forgejo: '#d65a1f', gitea: '#609926', gitlab: '#e24329', paperless: '#2f7a3a', mealie: '#e58325', n8n: '#ea4b71',
};

const KIND_RULES = [
  ['lab', /machine.?learning|ollama|open-?webui|localai|whisper|comfyui|stable-?diffusion/],
  ['silo', /[-_]db\b|database|postgres|mysql|mariadb|mongo|redis|valkey|dragonfly|keydb|influx|timescale|clickhouse|elasticsearch|opensearch|meilisearch|typesense|couchdb|etcd/],
  ['bunker', /socket-?proxy|gluetun|wireguard|wg-easy|vpn|tailscale|headscale|netbird|zerotier|cloudflared|crowdsec|fail2ban/],
  ['crane', /portainer|watchtower|diun|whats-?up-?docker|\bwud\b|komodo|dockge|yacht|dockhand/],
  ['cinema', /jellyfin|plex|emby|navidrome|airsonic|funkwhale|jellystat/],
  ['lighthouse', /pihole|pi-hole|adguard|blocky|technitium/],
  ['antenna', /unbound|dnsmasq|coredns|bind9|powerdns/],
  ['gallery', /immich|photoprism|librephotos|lychee|piwigo|pigallery/],
  ['watchtower', /uptime|kuma|gatus|healthchecks|statping|frigate|scrypted|zoneminder|shinobi|motioneye/],
  ['observatory', /grafana|prometheus|netdata|glances|loki|promtail|alloy|dozzle|cadvisor|node-?exporter|changedetection|speedtest|tautulli|scrutiny|beszel|victoria/],
  ['house', /home-?assistant|homebridge|zigbee2mqtt|zwave|z-wave|esphome|node-?red|matter-?server|evcc/],
  ['postoffice', /mosquitto|mqtt|rabbitmq|nats|kafka|redpanda|ntfy|gotify|apprise|mailu|mailcow|postfix|stalwart|roundcube|snappymail/],
  ['bank', /vaultwarden|bitwarden|authentik|authelia|keycloak|zitadel|lldap|pocket-?id|passbolt|hashicorp\/vault|actual|firefly|ghostfolio|wallos/],
  ['office', /nextcloud|owncloud|ocis|opencloud|seafile|onlyoffice|collabora|cryptpad|filebrowser|sftpgo/],
  ['library', /paperless|calibre|kavita|komga|audiobookshelf|bookstack|wiki|outline|docmost|linkding|linkwarden|karakeep|hoarder|freshrss|miniflux|wallabag|readeck|memos|trilium|joplin|hedgedoc|silverbullet/],
  ['factory', /forgejo|gitea|gitlab|woodpecker|drone|jenkins|runner|n8n|huginn|tdarr|unmanic|handbrake|stirling|gotenberg|tika|code-?server|renovate|kestra|windmill/],
  ['townhall', /homepage|homarr|heimdall|dashy|organizr|glance|flame|homer/],
  ['shop', /mealie|tandoor|grocy|kitchenowl|it-?tools|cyberchef|excalidraw|convertx|privatebin|shlink|yourls/],
  ['warehouse', /qbittorrent|transmission|sabnzbd|deluge|nzbget|jdownloader|pyload|aria2|syncthing|minio|garage|duplicati|restic|kopia|borg|backrest|urbackup|rclone/],
  ['gate', /nginx|caddy|traefik|haproxy|proxy|swag|zoraxy|pangolin/],
];

function kindOf(c) {
  if (c.kind && KINDS[c.kind]) return c.kind;
  const s = (c.name + ' ' + c.image).toLowerCase();
  for (const [kind, re] of KIND_RULES) if (re.test(s)) return kind;
  return 'tower';
}

const col = (b, c) => (b.dead ? dim(c) : c);
const door = (b, x) => R(x + (b.w >> 1) - 1, GROUND - 5, 3, 5, col(b, '#2a1f2e'));

function gridWindows(b) {
  const out = [];
  for (let wx = 3; wx <= b.w - 5; wx += 4)
    for (let wy = 3; wy <= b.h - 9; wy += 5) out.push({ x: wx, y: wy, w: 2, h: 3 });
  return out;
}

const KINDS = {
  tower: {
    size: (r) => [14 + 2 * Math.floor(r() * 5), 30 + Math.floor(r() * 40)], extra: 9,
    windows: gridWindows,
    draw(b, x, y) {
      const c = col(b, b.color);
      R(x, y, b.w, b.h, c);
      R(x + b.w - 2, y, 2, b.h, shade(c, -0.3));
      R(x - 1, y, b.w + 2, 1, shade(c, 0.25));
      const metal = col(b, '#7a7a86'), wood = col(b, '#7a5c48');
      if (b.roof === 1) {
        R(x + 3, y - 6, 6, 4, wood); R(x + 3, y - 7, 6, 1, shade(wood, 0.2));
        R(x + 3, y - 2, 1, 2, metal); R(x + 8, y - 2, 1, 2, metal);
      } else if (b.roof === 2) {
        R(x + b.w - 4, y - 9, 1, 9, metal); R(x + b.w - 6, y - 6, 5, 1, metal);
      } else if (b.roof === 3) {
        R(x + 2, y - 3, 5, 3, metal); R(x + 3, y - 2, 1, 1, shade(metal, -0.3));
      }
      door(b, x);
    },
    glow(b, x, y, t, env) {
      if (b.roof === 2 && Math.floor(t * 1.2 + b.seed) % 2) {
        g.globalAlpha = 0.4 + 0.6 * env.night;
        R(x + b.w - 4, y - 10, 1, 1, '#ff4b4b');
      }
    },
  },

  cinema: {
    size: () => [36, 30], extra: 13,
    windows: (b) => {
      const out = [];
      for (let wx = 3; wx <= b.w - 6; wx += 5) out.push({ x: wx, y: 3, w: 3, h: 4 });
      return out;
    },
    draw(b, x, y) {
      const c = col(b, b.color), d = shade(c, -0.3);
      R(x + 12, y - 10, b.w - 24, 4, shade(c, 0.1));
      R(x + 17, y - 13, 2, 3, col(b, '#e6c35c'));
      R(x + 6, y - 6, b.w - 12, 6, c);
      R(x, y, b.w, b.h, c);
      R(x + b.w - 2, y, 2, b.h, d);
      R(x - 2, y + 10, b.w + 4, 9, col(b, '#2b1b2e'));
      R(x + 12, GROUND - 9, 12, 9, col(b, '#1a1220'));
      R(x + 3, GROUND - 10, 6, 8, col(b, '#d9a066')); R(x + 4, GROUND - 9, 4, 6, col(b, '#5b6ee1'));
      R(x + b.w - 9, GROUND - 10, 6, 8, col(b, '#d9a066')); R(x + b.w - 8, GROUND - 9, 4, 6, col(b, '#d77bba'));
    },
    glow(b, x, y, t, env) {
      const streaming = b.c.netTx > 150e3;
      const step = Math.floor(t * (streaming ? 14 : 4));
      g.globalAlpha = 0.45 + 0.55 * env.night;
      for (let i = 0; i < (b.w + 4) / 2; i++) {
        const on = (i + step) % 3 === 0;
        R(x - 2 + i * 2, y + 10, 1, 1, on ? '#fff1b0' : '#6a4a3a');
        R(x + b.w + 1 - i * 2, y + 18, 1, 1, on ? '#fff1b0' : '#6a4a3a');
      }
      const label = b.name.replace(/[^a-z0-9]/gi, '').slice(0, Math.floor((b.w + 4) / 4));
      text(label, x + ((b.w - textWidth(label)) >> 1), y + 12, '#ffd86b');
    },
    sky(b, x, y, t, env) {
      if (b.c.netTx <= 150e3) return; // only when someone is actually streaming
      const a = -Math.PI / 2 + Math.sin(t * 0.5 + b.seed) * 0.55;
      const len = 220, spread = 0.07, ox = x + 18, oy = y - 12;
      g.globalAlpha = 0.06 + 0.16 * env.night;
      g.fillStyle = '#fff2c4';
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
      g.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
      g.fill();
    },
  },

  lighthouse: {
    size: () => [10, 64], extra: 1,
    windows: () => [],
    draw(b, x, y) {
      const H0 = b.h - 8, iron = col(b, '#333344');
      for (let r = 0; r < H0; r++) {
        const ww = Math.round(6 + (4 * r) / H0);
        R(x + ((10 - ww) >> 1), y + 8 + r, ww, 1, col(b, Math.floor(r / 6) % 2 ? '#c0392b' : '#ececec'));
      }
      R(x, y + 7, 10, 1, iron);
      R(x + 2, y + 2, 6, 5, col(b, '#26304a'));
      R(x + 2, y + 2, 1, 5, iron); R(x + 7, y + 2, 1, 5, iron);
      R(x + 2, y, 6, 2, iron); R(x + 4, y - 1, 2, 1, iron);
      door(b, x);
    },
    glow(b, x, y, t, env) {
      g.globalAlpha = 0.5 + 0.5 * env.night;
      R(x + 3, y + 3, 4, 4, '#fff3b0');
      const dir = Math.cos(t * 1.1), len = 170 * Math.abs(dir);
      if (len < 4) return;
      const lx = x + 5, ly = y + 5;
      g.globalAlpha = (0.04 + 0.22 * env.night) * Math.abs(dir);
      g.fillStyle = '#fff6c8';
      g.beginPath();
      g.moveTo(lx, ly);
      g.lineTo(lx + dir * len, ly - 12);
      g.lineTo(lx + dir * len, ly + 12);
      g.fill();
    },
  },

  gallery: {
    size: () => [30, 24], extra: 0,
    windows: (b) => {
      const out = [];
      for (let wx = 3; wx + 3 <= b.w - 2; wx += 5) out.push({ x: wx, y: 11, w: 3, h: b.h - 15 });
      return out;
    },
    draw(b, x, y) {
      const m = col(b, '#ddd6c8'), s = col(b, '#b9b1a0');
      for (let r = 0; r < 6; r++) {
        const ww = Math.round((b.w * (r + 1)) / 6);
        R(x + ((b.w - ww) >> 1), y + r, ww, 1, m);
      }
      R(x - 1, y + 6, b.w + 2, 3, m); R(x - 1, y + 8, b.w + 2, 1, s);
      R(x + 1, y + 9, b.w - 2, b.h - 12, col(b, '#8c8577'));
      for (let cx = x + 1; cx <= x + b.w - 3; cx += 5) R(cx, y + 9, 2, b.h - 12, m);
      R(x - 1, GROUND - 3, b.w + 2, 1, m);
      R(x - 2, GROUND - 2, b.w + 4, 2, s);
    },
    glow(b, x, y, t, env, dt) {
      // camera flashes while it's busy processing photos
      if (b.windows.length && Math.random() < dt * (b.c.cpu / 12)) {
        const w = b.windows[Math.floor(Math.random() * b.windows.length)];
        spark(x + w.x + 1, y + w.y + Math.random() * w.h, '#ffffff', 0.12);
      }
    },
  },

  lab: {
    size: () => [20, 22], extra: 7,
    windows: gridWindows,
    draw(b, x, y) {
      const c = col(b, '#cfd8e3');
      R(x, y, b.w, b.h, c);
      R(x + b.w - 2, y, 2, b.h, shade(c, -0.25));
      R(x - 1, y, b.w + 2, 1, shade(c, -0.1));
      const cx = x + (b.w >> 1), dc = col(b, '#9badb7');
      for (let r = 0; r < 7; r++) {
        const half = Math.round(Math.sqrt(49 - (7 - r) ** 2));
        R(cx - half, y - 7 + r, half * 2, 1, dc);
      }
      R(cx, y - 6, 1, 6, col(b, '#26304a'));
      door(b, x);
    },
    glow(b, x, y, t, env, dt) {
      if (b.c.cpu < 3) return;
      const cx = x + (b.w >> 1);
      g.globalAlpha = 0.5 + 0.5 * env.night;
      R(cx, y - 6, 1, 6, '#7ff3ff');
      if (Math.random() < dt * Math.min(8, b.c.cpu / 8)) {
        particles.push({ x: cx, y: y - 7, vx: (Math.random() - 0.5) * 6, vy: -12 - Math.random() * 8, life: 1.4, max: 1.4, c: '#7ff3ff', s: 1, grav: 0 });
      }
    },
  },

  silo: {
    size: (r) => [12, 22 + Math.floor(r() * 12)], extra: 4,
    windows: () => [],
    draw(b, x, y) {
      const c = col(b, b.color);
      R(x, y, b.w, b.h, c);
      R(x, y, 2, b.h, shade(c, 0.25));
      R(x + b.w - 3, y, 3, b.h, shade(c, -0.3));
      for (let yy = 5; yy < b.h; yy += 6) R(x, y + yy, b.w, 1, shade(c, -0.15));
      R(x + 1, y - 2, b.w - 2, 2, shade(c, 0.1));
      R(x + 3, y - 3, b.w - 6, 1, shade(c, 0.1));
      for (let yy = 2; yy < b.h; yy += 2) R(x + b.w - 5, y + yy, 1, 1, col(b, '#222222'));
    },
    glow(b, x, y, t, env) {
      if (Math.floor(t * 0.8 + b.seed) % 3 === 0) {
        g.globalAlpha = 0.6 + 0.4 * env.night;
        R(x + (b.w >> 1), y - 4, 1, 1, '#8fe388');
      }
    },
  },

  bunker: {
    size: () => [24, 12], extra: 0,
    windows: () => [{ x: 8, y: 4, w: 9, h: 2 }],
    draw(b, x, y) {
      const c = col(b, '#7d7d78');
      for (let r = 0; r < b.h; r++) {
        const inset = Math.max(0, 3 - (r >> 1));
        R(x + inset, y + r, b.w - 2 * inset, 1, r === 0 ? shade(c, 0.2) : c);
      }
      R(x + b.w - 6, GROUND - 6, 3, 6, col(b, '#3a3a3a'));
      const shield = col(b, '#4b8a3f');
      R(x + 3, y + 5, 3, 3, shield); R(x + 4, y + 8, 1, 1, shield);
    },
    glow(b, x, y, t, env) {
      g.globalAlpha = 0.6 + 0.4 * env.night;
      R(x + b.w - 5, GROUND - 8, 1, 1, '#8fe388');
    },
  },

  gate: {
    size: () => [20, 26], extra: 5,
    windows: (b) => [{ x: 2, y: 12, w: 1, h: 3 }, { x: b.w - 3, y: 12, w: 1, h: 3 }],
    draw(b, x, y, t) {
      const c = col(b, '#a08870'), d = shade(c, -0.3);
      R(x, y + 4, 5, b.h - 4, c);
      R(x + b.w - 5, y + 4, 5, b.h - 4, c);
      R(x + b.w - 2, y + 4, 2, b.h - 4, d);
      R(x, y + 4, b.w, 6, c);
      for (let i = 0; i < b.w; i += 3) R(x + i, y + 2, 2, 2, c);
      R(x + 5, y + 10, b.w - 10, b.h - 10, col(b, '#1a1220'));
      R(x + 5, y + 10, 1, 1, c); R(x + b.w - 6, y + 10, 1, 1, c);
      const px = x + (b.w >> 1), flag = col(b, b.color);
      R(px, y - 5, 1, 7, col(b, '#555555'));
      const wave = b.dead ? 1 : Math.floor(t * 3 + b.seed) % 2;
      R(px + 1, y - 5, 4, 2, flag);
      R(px + 5, y - 5 + wave, 1, 1, flag);
    },
  },

  watchtower: {
    size: () => [10, 52], extra: 2,
    windows: (b) => [{ x: 1, y: 4, w: b.w - 2, h: 2 }],
    draw(b, x, y) {
      const wood = col(b, '#6b5440'), cabin = col(b, '#7a5c48'), roof = col(b, '#4a3328');
      R(x + 1, y + 8, 1, b.h - 8, wood);
      R(x + b.w - 2, y + 8, 1, b.h - 8, wood);
      for (let yy = y + 10; yy < GROUND - 8; yy += 8) {
        for (let k = 0; k < 8; k++) {
          const off = Math.round((k * (b.w - 3)) / 7);
          R(x + 1 + off, yy + k, 1, 1, wood);
          R(x + b.w - 2 - off, yy + k, 1, 1, wood);
        }
      }
      R(x - 1, y + 2, b.w + 2, 6, cabin);
      R(x - 2, y, b.w + 4, 2, roof);
      R(x - 1, y + 8, b.w + 2, 1, roof);
    },
    glow(b, x, y, t, env) {
      // the watchtower sees everything: red when anything in the city is unwell
      const trouble = buildings.some((o) => o.c.health === 'unhealthy' || o.c.state === 'restarting');
      if (Math.floor(t * (trouble ? 4 : 1)) % 2) {
        g.globalAlpha = 0.6 + 0.4 * env.night;
        R(x + (b.w >> 1) - 1, y - 2, 2, 2, trouble ? '#ff4b4b' : '#8fe388');
      }
    },
  },

  antenna: {
    size: () => [10, 12], extra: 22,
    windows: () => [{ x: 1, y: 3, w: 2, h: 2 }, { x: 7, y: 3, w: 2, h: 2 }],
    draw(b, x, y) {
      const c = col(b, '#8a8f99'), m = col(b, '#5a5f6a');
      R(x, y, b.w, b.h, c);
      R(x + b.w - 2, y, 2, b.h, shade(c, -0.3));
      R(x - 1, y, b.w + 2, 1, shade(c, -0.2));
      for (let yy = 1; yy <= 20; yy++) {
        R(x + 4, y - yy, 2, 1, m);
        if (yy % 3 === 0) R(x + 3, y - yy, 4, 1, m);
      }
      door(b, x);
    },
    glow(b, x, y, t, env) {
      const tx = x + 5, ty = y - 21;
      g.globalAlpha = 0.6 + 0.4 * env.night;
      if (Math.floor(t * 1.5) % 2) R(tx - 1, ty, 2, 1, '#ff4b4b');
      if (b.c.cpu < 0.3 && b.c.netRx < 500) return;
      for (let k = 0; k < 2; k++) {
        const p = ((t * 0.8 + k * 0.5) % 1), r = 3 + p * 14;
        g.globalAlpha = (1 - p) * (0.3 + 0.5 * env.night);
        for (let a = -0.7; a <= 0.7; a += 0.12) {
          R(tx + Math.cos(a) * r, ty + Math.sin(a) * r, 1, 1, '#9fe8ff');
          R(tx - 1 - Math.cos(a) * r, ty + Math.sin(a) * r, 1, 1, '#9fe8ff');
        }
      }
    },
  },

  warehouse: {
    size: () => [28, 18], extra: 4,
    windows: (b) => {
      const out = [];
      for (let wx = 2; wx <= b.w - 4; wx += 5) out.push({ x: wx, y: 3, w: 3, h: 2 });
      return out;
    },
    draw(b, x, y) {
      const c = col(b, '#8f563b'), roof = col(b, '#5a3a2a');
      R(x, y, b.w, b.h, c);
      R(x + b.w - 2, y, 2, b.h, shade(c, -0.3));
      for (let i = 0; i < b.w; i += 7)
        for (let r = 0; r < 4; r++) R(x + i, y - 4 + r, Math.min(1 + r * 2, b.w - i), 1, roof);
      const dx = x + (b.w >> 1) - 5;
      R(dx, GROUND - 10, 10, 10, col(b, '#5d6266'));
      for (let yy = GROUND - 9; yy < GROUND; yy += 2) R(dx, yy, 10, 1, col(b, '#4a4e52'));
    },
  },

  crane: {
    size: () => [20, 10], extra: 42,
    windows: () => [{ x: 4, y: 3, w: 4, h: 2 }],
    draw(b, x, y, t) {
      const cab = col(b, b.color), yel = col(b, '#e6b83c'), dk = col(b, '#3a3a44');
      const mx = x + 6, top = y - 38;
      for (let yy = top; yy < y; yy++) R(mx, yy, 2, 1, yy & 1 ? yel : shade(yel, -0.3));
      R(x + 2, y, 10, b.h, cab);
      R(x + 10, y, 2, b.h, shade(cab, -0.3));
      R(x - 1, top, b.w + 1, 1, yel);
      R(x - 1, top + 1, 3, 3, dk);
      R(mx, top - 3, 1, 3, dk);
      const hx = x + b.w - 2, L = 14 + Math.round(Math.sin(t * 0.7) * (b.dead ? 0 : 5));
      R(hx, top + 1, 1, L, dk);
      R(hx - 2, top + 1 + L, 5, 3, col(b, '#d9a066'));
    },
    glow(b, x, y, t, env) {
      if (Math.floor(t * 1.2) % 2) {
        g.globalAlpha = 0.5 + 0.5 * env.night;
        R(x + 6, y - 42, 1, 1, '#ff4b4b');
      }
    },
  },

  house: {
    size: () => [22, 16], extra: 11, color: '#a8483c',
    windows: (b) => [{ x: 3, y: 4, w: 4, h: 4 }, { x: b.w - 7, y: 4, w: 4, h: 4 }],
    draw(b, x, y) {
      const wall = col(b, '#e3d5b8'), roof = col(b, b.color), panel = col(b, '#2b3f6b');
      R(x, y, b.w, b.h, wall);
      R(x + b.w - 2, y, 2, b.h, shade(wall, -0.2));
      R(x + 4, y - 8, 2, 5, col(b, '#7a5c48'));
      for (let r = 0; r <= 8; r++) {
        const ww = Math.round(4 + ((b.w - 2) * r) / 8);
        R(x + ((b.w - ww) >> 1), y - 9 + r, ww, 1, r === 8 ? shade(roof, -0.25) : roof);
        if (r >= 3 && r <= 6) R(x + ((b.w + ww) >> 1) - 5, y - 9 + r, 3, 1, panel);
      }
      door(b, x);
    },
    glow(b, x, y, t, env) {
      g.globalAlpha = 0.6 + 0.4 * env.night;
      R(x + (b.w >> 1), y - 10, 1, 1, `hsl(${Math.floor(t * 40 + b.seed) % 360} 90% 65%)`);
      g.globalAlpha = env.night;
      R(x + (b.w >> 1) + 2, GROUND - 6, 1, 1, '#fff1b0');
    },
  },

  postoffice: {
    size: () => [26, 20], extra: 3, color: '#c0392b',
    windows: (b) => [{ x: 3, y: 11, w: 4, h: 3 }, { x: b.w - 7, y: 11, w: 4, h: 3 }],
    draw(b, x, y) {
      const body = col(b, '#c9b79a'), red = col(b, b.color);
      R(x, y, b.w, b.h, body);
      R(x + b.w - 2, y, 2, b.h, shade(body, -0.25));
      R(x - 1, y - 2, b.w + 2, 2, shade(red, -0.2));
      R(x + 2, y + 2, b.w - 4, 7, red);
      text('POST', x + ((b.w - textWidth('POST')) >> 1), y + 3, col(b, '#ffd86b'));
      R(x + 2, GROUND - 6, 3, 4, col(b, '#c0392b'));
      R(x + 3, GROUND - 2, 1, 2, col(b, '#3a3a44'));
      door(b, x);
    },
    glow(b, x, y, t, env, dt) {
      const traffic = b.c.netRx + b.c.netTx;
      if (traffic > 2000 && Math.random() < dt * Math.min(3, traffic / 20e3)) {
        particles.push({ x: x + 4 + Math.random() * (b.w - 8), y: y - 3, vx: (Math.random() - 0.5) * 16, vy: -14 - Math.random() * 8, life: 1.6, max: 1.6, c: '#f4f1e8', s: 2, grav: 4 });
      }
    },
  },

  observatory: {
    size: () => [22, 18], extra: 11, color: '#dfe3ea',
    windows: (b) => [{ x: 3, y: 5, w: 3, h: 3 }, { x: b.w - 6, y: 5, w: 3, h: 3 }],
    draw(b, x, y, t) {
      const wall = col(b, '#dfe3ea'), dome = col(b, '#b8c2cf'), cx = x + (b.w >> 1), rad = 9;
      R(x, y, b.w, b.h, wall);
      R(x + b.w - 2, y, 2, b.h, shade(wall, -0.25));
      for (let r = 0; r < rad; r++) {
        const half = Math.round(Math.sqrt(rad * rad - (rad - r) ** 2));
        R(cx - half, y - rad + r, half * 2, 1, dome);
        R(cx - half, y - rad + r, 1, 1, shade(dome, 0.3));
      }
      R(cx - 1, y - rad + 1, 2, rad - 1, col(b, '#26304a'));
      const a = -1.25 + Math.sin(t * 0.15 + b.seed) * (b.dead ? 0 : 0.35);
      for (let i = 0; i < 7; i++) R(cx + Math.cos(a) * i, y - 4 + Math.sin(a) * i, 1, 1, col(b, '#5a5f6a'));
      door(b, x);
    },
    glow(b, x, y, t, env) {
      const cx = x + (b.w >> 1);
      g.globalAlpha = 0.15 + 0.6 * env.night;
      R(cx - 1, y - 8, 2, 7, '#9fd4ff');
    },
  },

  bank: {
    size: () => [28, 22], extra: 7, color: '#d4a83a',
    windows: (b) => [{ x: 3, y: 4, w: 3, h: 6 }, { x: b.w - 6, y: 4, w: 3, h: 6 }],
    draw(b, x, y) {
      const stone = col(b, '#cfc6b0'), gold = col(b, b.color), metal = col(b, '#9aa0a8');
      R(x, y, b.w, b.h, stone);
      for (let yy = 3; yy < b.h - 2; yy += 4) R(x, y + yy, b.w, 1, shade(stone, -0.12));
      R(x + b.w - 2, y, 2, b.h, shade(stone, -0.25));
      for (let r = 0; r < 6; r++) {
        const ww = Math.round(((b.w + 2) * (r + 1)) / 6);
        R(x + ((b.w - ww) >> 1), y - 7 + r, ww, 1, stone);
      }
      R(x - 1, y - 1, b.w + 2, 1, gold);
      const cx = x + (b.w >> 1), cy = GROUND - 9;
      disc(cx, cy, 5, metal);
      disc(cx, cy, 3, shade(metal, -0.2));
      R(cx - 3, cy, 7, 1, shade(metal, -0.45));
      R(cx, cy - 3, 1, 7, shade(metal, -0.45));
      R(x - 1, GROUND - 2, b.w + 2, 2, shade(stone, -0.2));
    },
    glow(b, x, y, t, env) {
      const cx = x + (b.w >> 1), cy = GROUND - 9;
      if (b.c.cpu > 0.5) {
        const a = t * Math.min(6, 0.5 + b.c.cpu / 10);
        g.globalAlpha = 0.8;
        for (let k = 0; k < 4; k++) {
          const ang = a + (k * Math.PI) / 2;
          R(cx + Math.round(Math.cos(ang) * 3), cy + Math.round(Math.sin(ang) * 3), 1, 1, '#f0dc8c');
        }
      }
      g.globalAlpha = 0.4 + 0.6 * env.night;
      R(cx, y - 8, 1, 1, '#ffd86b');
    },
  },

  library: {
    size: () => [26, 26], extra: 2, color: '#8a4b3a',
    windows: () => [],
    draw(b, x, y) {
      const brick = col(b, b.color), dark = col(b, '#2a1f2e');
      const spines = ['#c0392b', '#e6b83c', '#37946e', '#5b6ee1', '#d77bba', '#d9a066'];
      R(x, y, b.w, b.h, brick);
      R(x + b.w - 2, y, 2, b.h, shade(brick, -0.3));
      R(x - 1, y, b.w + 2, 2, shade(brick, 0.25));
      for (const sy of [y + 5, y + 13]) {
        R(x + 3, sy, b.w - 6, 7, dark);
        for (let i = 0; i < b.w - 8; i += 2) {
          const tall = (i * 7 + b.seed) % 3;
          R(x + 4 + i, sy + 1 + tall, 1, 5 - tall, col(b, spines[(i + b.seed) % spines.length]));
        }
      }
      door(b, x);
    },
    glow(b, x, y, t, env) {
      g.globalAlpha = 0.08 + 0.3 * env.night;
      R(x + 3, y + 5, b.w - 6, 7, '#ffd98a');
      R(x + 3, y + 13, b.w - 6, 7, '#ffd98a');
    },
  },

  factory: {
    size: () => [30, 16], extra: 20, color: '#8a7a6a',
    windows: (b) => {
      const out = [];
      for (let wx = 2; wx <= b.w - 9; wx += 5) out.push({ x: wx, y: 4, w: 3, h: 3 });
      return out;
    },
    draw(b, x, y) {
      const body = col(b, b.color), roof = col(b, '#5a4e46'), glass = col(b, '#7fa8c8'), brick = col(b, '#7a3a2a');
      R(x, y, b.w, b.h, body);
      R(x + b.w - 2, y, 2, b.h, shade(body, -0.3));
      for (let i = 0; i + 9 < b.w - 6; i += 10) {
        for (let r = 0; r < 5; r++) R(x + i, y - 5 + r, 1 + r * 2, 1, roof);
        R(x + i + 9, y - 5, 1, 5, glass);
      }
      R(x + b.w - 6, y - 18, 4, 18, brick);
      for (let yy = y - 15; yy < y; yy += 5) R(x + b.w - 6, yy, 4, 1, shade(brick, -0.3));
      R(x + 3, GROUND - 7, 7, 7, col(b, '#5d6266'));
      for (let yy = GROUND - 6; yy < GROUND; yy += 2) R(x + 3, yy, 7, 1, col(b, '#4a4e52'));
    },
    glow(b, x, y, t, env, dt) {
      if (Math.random() < dt * (1.2 + Math.min(b.c.cpu, 200) / 5)) {
        const grey = ['#c4c4cc', '#a8a8b2', '#8a8a96'][Math.floor(Math.random() * 3)];
        const life = 3 + Math.random() * 1.5;
        particles.push({ x: x + b.w - 5 + Math.random() * 2, y: y - 19, vx: 3 + Math.random() * 4, vy: -6 - Math.random() * 5, life, max: life, c: grey, s: b.c.cpu > 20 ? 3 : 2, grav: -1 });
      }
      if (Math.floor(t * 1.3 + b.seed) % 2) {
        g.globalAlpha = 0.4 + 0.6 * env.night;
        R(x + b.w - 4, y - 19, 1, 1, '#ff4b4b');
      }
    },
  },

  office: {
    size: (r) => [18, 42 + Math.floor(r() * 20)], extra: 5, color: '#4a7fb0',
    windows: (b) => {
      const out = [];
      for (let wy = 2; wy <= b.h - 10; wy += 4)
        for (let wx = 2; wx <= b.w - 5; wx += 4) out.push({ x: wx, y: wy, w: 2, h: 2 });
      return out;
    },
    draw(b, x, y) {
      const c = col(b, b.color);
      R(x, y, b.w, b.h, c);
      for (let xx = 0; xx < b.w; xx += 4) R(x + xx, y, 1, b.h, shade(c, -0.18));
      for (let yy = 0; yy < b.h; yy += 4) R(x, y + yy, b.w, 1, shade(c, -0.25));
      R(x + 5, y + 1, 1, b.h - 2, shade(c, 0.3));
      R(x + b.w - 2, y, 2, b.h, shade(c, -0.35));
      R(x + 3, y - 4, b.w - 6, 3, col(b, '#e8e8f0'));
      R(x + (b.w >> 1) - 1, y - 3, 2, 1, c);
      R(x + (b.w >> 1) - 3, GROUND - 6, 6, 6, col(b, '#1a2a3a'));
    },
  },

  townhall: {
    size: () => [28, 20], extra: 22, color: '#3f6b5a',
    windows: (b) => [{ x: 3, y: 12, w: 3, h: 4 }, { x: b.w - 6, y: 12, w: 3, h: 4 }],
    draw(b, x, y) {
      const wall = col(b, '#d8c8a8'), copper = col(b, b.color), cx = x + (b.w >> 1);
      R(x, y, b.w, b.h, wall);
      R(x + b.w - 2, y, 2, b.h, shade(wall, -0.25));
      R(x - 1, y, b.w + 2, 1, shade(wall, -0.2));
      R(cx - 4, y - 16, 8, 16, wall);
      R(cx + 2, y - 16, 2, 16, shade(wall, -0.25));
      for (let r = 0; r < 6; r++) R(cx - 1 - (r >> 1), y - 22 + r, 2 + (r >> 1) * 2, 1, copper);
      R(x + 3, y + 3, b.w - 6, 7, col(b, '#1a1220'));
      disc(cx, y - 10, 3, col(b, '#f4f1e8'));
      clockHands(cx, y - 10, col(b, '#26304a'));
      door(b, x);
    },
    glow(b, x, y, t, env) {
      const cx = x + (b.w >> 1);
      g.globalAlpha = 0.3 + 0.7 * env.night;
      disc(cx, y - 10, 3, '#fff6c8');
      clockHands(cx, y - 10, '#26304a');
      g.globalAlpha = 1;
      const up = buildings.filter((o) => !o.dead).length;
      const label = up < 100 ? `${up} UP` : String(up);
      text(label, x + ((b.w - textWidth(label)) >> 1), y + 4, '#8fe388');
    },
  },

  shop: {
    size: () => [20, 14], extra: 7,
    windows: () => [{ x: 2, y: 7, w: 8, h: 5 }],
    draw(b, x, y) {
      const wall = col(b, '#e8dcc0'), stripe = col(b, b.color), white = col(b, '#f4f1e8');
      R(x, y, b.w, b.h, wall);
      R(x + b.w - 2, y, 2, b.h, shade(wall, -0.2));
      R(x + 1, y - 7, b.w - 2, 7, col(b, '#3a2a2a'));
      for (let i = 0; i < b.w + 2; i++) {
        const c = (i >> 1) % 2 ? white : stripe;
        R(x - 1 + i, y + 1, 1, 3, c);
        if (i % 2 === 0) R(x - 1 + i, y + 4, 1, 1, c);
      }
      R(x + b.w - 7, GROUND - 7, 4, 7, col(b, '#5a3a2a'));
    },
    glow(b, x, y, t, env) {
      g.globalAlpha = 0.35 + 0.65 * env.night;
      text('OPEN', x + ((b.w - textWidth('OPEN')) >> 1), y - 6, '#ff6b9a');
    },
  },
};

function clockHands(cx, cy, c) {
  const h = currentHour(), m = (h % 1) * 60;
  const ah = ((h % 12) / 12) * Math.PI * 2 - Math.PI / 2, am = (m / 60) * Math.PI * 2 - Math.PI / 2;
  for (let i = 1; i <= 3; i++) R(cx + Math.round(Math.cos(am) * i), cy + Math.round(Math.sin(am) * i), 1, 1, c);
  for (let i = 1; i <= 2; i++) R(cx + Math.round(Math.cos(ah) * i), cy + Math.round(Math.sin(ah) * i), 1, 1, c);
  R(cx, cy, 1, 1, c);
}

const buildingCache = new Map(); // name -> building, survives re-layouts
let buildings = [];
let districts = [];
let contentWidth = 320;
const GAP = 3, DISTRICT_GAP = 12, MARGIN = 10;

function makeBuilding(c) {
  const seed = hash(c.name), r = rng(seed);
  const kind = kindOf(c), spec = KINDS[kind];
  const [w, h] = spec.size(r);
  const brand = Object.keys(BRAND).find((k) => (c.name + ' ' + c.image).toLowerCase().includes(k));
  const fallback = kind === 'silo' ? '#9aa3ad' : kind === 'gate' ? '#d04648' : spec.color ?? PALETTE[seed % PALETTE.length];
  const b = {
    name: c.name, kind, spec, w, h: 0, hBase: h, extra: spec.extra, seed: seed % 1000,
    color: brand ? BRAND[brand] : fallback, roof: Math.floor(r() * 4), c, x: 0, flash: 0,
  };
  applySize(b);
  return b;
}

// Tall things grow into the available sky so the city doesn't look lost on wide screens.
const GROWTH = { tower: 1, office: 1, lighthouse: 1, watchtower: 1, silo: 0.35 };
let heightBoost = 1;

function applySize(b) {
  const k = GROWTH[b.kind] ?? 0;
  const h = Math.round(b.hBase * (1 + (heightBoost - 1) * k));
  if (h === b.h) return;
  b.h = h;
  const r = rng(hash(b.name) + 7);
  b.windows = b.spec.windows(b).map((win) => ({ ...win, thr: r(), tv: r() < 0.15, flip: 0 }));
}

function layout() {
  const groups = new Map();
  for (const c of state.containers) {
    const p = c.project || 'standalone';
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(c);
  }
  const projects = [...groups.keys()].sort((a, b) => (a === 'standalone') - (b === 'standalone') || a.localeCompare(b));

  buildings = [];
  districts = [];
  let x = 0;
  for (const p of projects) {
    const start = x;
    for (const c of groups.get(p).sort((a, b) => a.name.localeCompare(b.name))) {
      let b = buildingCache.get(c.name);
      if (!b) buildingCache.set(c.name, (b = makeBuilding(c)));
      b.c = c;
      b.rx = x;
      x += b.w + GAP;
      buildings.push(b);
    }
    districts.push({ name: p, rx0: start, rx1: x - GAP });
    x += DISTRICT_GAP;
  }
  contentWidth = Math.max(160, x - DISTRICT_GAP + MARGIN * 2);
}

function position() {
  const off = contentWidth <= W ? Math.floor((W - contentWidth) / 2) + MARGIN : MARGIN;
  for (const b of buildings) b.x = b.rx + off;
  for (const d of districts) { d.x0 = d.rx0 + off; d.x1 = d.rx1 + off; }
  cam.max = Math.max(0, contentWidth - W);
  cam.x = clamp(cam.x, 0, cam.max);
  cam.target = clamp(cam.target, 0, cam.max);
  display.classList.toggle('pannable', cam.max > 0);
}


const cam = { x: 0, target: 0, max: 0, dir: 1, pauseUntil: 0, holdUntil: 0, manualUntil: 0, dragging: null };
const DRIFT = 7;
const clock = () => performance.now() / 1000;

function updateCamera(dt, t) {
  if (cam.max <= 0) {
    cam.x = cam.target = 0;
    return;
  }
  if (!cam.dragging && t > cam.holdUntil && t > cam.manualUntil && t > cam.pauseUntil) {
    cam.target += cam.dir * DRIFT * dt;
    if (cam.target <= 0 || cam.target >= cam.max) {
      cam.dir = cam.target <= 0 ? 1 : -1;
      cam.pauseUntil = t + 6;
    }
  }
  cam.target = clamp(cam.target, 0, cam.max);
  cam.x += (cam.target - cam.x) * Math.min(1, dt * 3);
}

function focusOn(b) {
  const t = clock();
  if (cam.max <= 0 || t < cam.manualUntil) return;
  cam.target = clamp(b.x + b.w / 2 - W / 2, 0, cam.max);
  cam.holdUntil = t + 12;
}

function panBy(dx, smooth) {
  cam.target = clamp(cam.target + dx, 0, cam.max);
  if (!smooth) cam.x = cam.target;
  cam.manualUntil = clock() + 30;
}

let camI = 0;
const inWorld = () => g.setTransform(1, 0, 0, 1, -camI, 0);
const onScreen = () => g.setTransform(1, 0, 0, 1, 0, 0);
const visible = (b) => b.x + b.w + 24 >= camI && b.x - 24 <= camI + W;

// ---------- world state ----------

const state = { containers: [], pihole: null, prevBlocked: null, connected: false, layoutKey: '' };
const particles = [];
const cars = [];
const drops = [];
const flashes = [];
const ticker = [];
let dropQueue = 0, dropRate = 0, dropAcc = 0;
let stars = [], clouds = [], grass = [], skyline = [];
let hovered = null;

function spark(x, y, c, life = 0.6) {
  particles.push({ x, y, vx: 0, vy: 0, life, max: life, c, s: 1, grav: 0 });
}

function burst(b, kind) {
  const cx = b.x + b.w / 2, top = GROUND - b.h - b.extra;
  const n = { start: 26, die: 16, restart: 18, oom: 18, healthy: 10, unhealthy: 0 }[kind] ?? 8;
  for (let i = 0; i < n; i++) {
    if (kind === 'start') {
      const confetti = ['#ffd86b', '#8fe388', '#7ff3ff', '#d77bba', '#ffffff'][i % 5];
      particles.push({ x: cx, y: top, vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 50, life: 1.6, max: 1.6, c: confetti, s: 1, grav: 70 });
    } else if (kind === 'healthy') {
      particles.push({ x: cx + (Math.random() - 0.5) * b.w, y: top + Math.random() * 6, vx: 0, vy: -10, life: 1, max: 1, c: '#8fe388', s: 1, grav: 0 });
    } else {
      const grey = ['#9a9aa6', '#7a7a86', '#5a5a66'][i % 3];
      particles.push({ x: cx + (Math.random() - 0.5) * b.w, y: top + Math.random() * b.h * 0.5, vx: (Math.random() - 0.5) * 12, vy: -6 - Math.random() * 14, life: 2.2, max: 2.2, c: grey, s: 2, grav: -2 });
    }
  }
  if (kind === 'oom') particles.push({ x: cx - 7, y: top - 4, vx: 0, vy: -8, life: 2.5, max: 2.5, c: '#ff4b4b', text: 'OOM!', grav: 0 });
  if (kind === 'die' || kind === 'unhealthy' || kind === 'oom') b.flash = 0.6;
}

const VERB = { start: 'started', die: 'stopped', restart: 'restarted', oom: 'ran out of memory', healthy: 'is healthy', unhealthy: 'is unhealthy', pause: 'paused', unpause: 'woke up' };

function onEvent(e) {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  ticker.unshift({ msg: `${hhmm} ${e.name} ${VERB[e.action] ?? e.action}`, bad: ['die', 'oom', 'unhealthy'].includes(e.action) });
  ticker.length = Math.min(ticker.length, 3);
  const b = buildingCache.get(e.name);
  if (b && buildings.includes(b)) {
    burst(b, e.action);
    focusOn(b);
  }
}

function onSnapshot(m) {
  state.containers = m.containers;
  const key = m.containers.map((c) => c.name + ':' + (c.kind || '')).sort().join('|');
  for (const c of m.containers) {
    const b = buildingCache.get(c.name);
    if (b) b.c = c;
  }
  if (key !== state.layoutKey) {
    state.layoutKey = key;
    layout();
    resize();
  }
  for (const b of buildings) b.dead = !['running', 'paused', 'restarting'].includes(b.c.state);

  if (m.pihole) {
    if (state.prevBlocked != null && m.pihole.blocked > state.prevBlocked) {
      dropQueue = Math.min(dropQueue + (m.pihole.blocked - state.prevBlocked), 80);
      dropRate = dropQueue / 2;
    }
    state.prevBlocked = m.pihole.blocked;
  }
  state.pihole = m.pihole || null;
}

function connect() {
  if (params.has('demo')) {
    state.connected = true;
    state.demo = true;
    const n = parseInt(params.get('demo'), 10);
    startDemo({ onSnapshot, onEvent, count: n > 0 ? Math.min(n, 400) : 36 });
    return;
  }
  const es = new EventSource('api/stream');
  es.onopen = () => (state.connected = true);
  es.onerror = () => (state.connected = false);
  es.onmessage = (e) => {
    state.connected = true;
    const m = JSON.parse(e.data);
    if (m.type === 'snapshot') onSnapshot(m);
    else if (m.type === 'event') onEvent(m);
  };
}

// ---------- sizing ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.floor(innerWidth * dpr), ph = Math.floor(innerHeight * dpr);
  const minScale = params.has('fit') ? 1 : Math.max(1, Math.ceil(Math.min(ph, pw) / 450));
  let s = params.has('scale') ? parseInt(params.get('scale'), 10) : Math.max(1, Math.floor(ph / 190));
  if (!params.has('scale')) while (s > minScale && Math.ceil(pw / s) < contentWidth) s--;
  S = s;
  W = Math.ceil(pw / s);
  H = Math.ceil(ph / s);
  GROUND = H - 46;
  heightBoost = clamp((GROUND - 50) / 110, 1, 2.4);
  for (const b of buildingCache.values()) applySize(b);
  display.width = pw;
  display.height = ph;
  frame.width = layer.width = W;
  frame.height = layer.height = H;
  position();

  const r = rng(42);
  stars = Array.from({ length: Math.floor((W * GROUND) / 260) }, () => ({ x: Math.floor(r() * W), y: Math.floor(r() * (GROUND - 30)), p: r() * 6, big: r() < 0.08 }));
  clouds = Array.from({ length: 5 }, (_, i) => {
    const puffs = Array.from({ length: 3 + Math.floor(r() * 3) }, (_, k) => ({ dx: k * 6 + Math.floor(r() * 3), dy: Math.floor(r() * 3) - 1, r: 3 + Math.floor(r() * 3) }));
    return { x: r() * W, y: 12 + r() * (GROUND * 0.35), v: 1.5 + r() * 3, puffs, seed: i };
  });
  // a hazy far-away skyline that isn't backed by any container
  const worldW = Math.max(W, contentWidth);
  skyline = [];
  for (let x = -4; x < W + cam.max / 3 + 4; ) {
    const w = 8 + Math.floor(r() * 14);
    const h = Math.floor((14 + r() * 46) * heightBoost * 0.8);
    skyline.push({ x, w, h, lights: Array.from({ length: Math.floor((w * h) / 90) }, () => ({ x: 2 + Math.floor(r() * (w - 4)), y: 3 + Math.floor(r() * (h - 6)), p: r() })) });
    x += w + Math.floor(r() * 3) - 1;
  }
  grass = Array.from({ length: Math.floor(worldW / 3) }, () => ({ x: Math.floor(r() * worldW), y: GROUND + 15 + Math.floor(r() * 31), c: r() < 0.5 ? '#26402c' : '#365a3c' }));
}

// ---------- simulation ----------

function carRate(bytesPerSec) {
  return bytesPerSec < 5000 ? 0 : Math.min(0.8, (Math.log10(bytesPerSec) - 3.6) * 0.3);
}

function domeY(x) {
  const k = (x - W / 2) / (W * 0.62);
  return GROUND - (GROUND - 24) * Math.sqrt(Math.max(0, 1 - k * k));
}

function update(dt, t) {
  // traffic: cars leave a building for outgoing bytes, arrive for incoming
  for (const b of buildings) {
    if (b.dead || cars.length > 22 || !visible(b)) continue;
    const cx = b.x + (b.w >> 1);
    if (Math.random() < dt * carRate(b.c.netTx)) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      cars.push({ x: cx, dir, v: 18 + Math.random() * 16, c: b.color });
    }
    if (Math.random() < dt * carRate(b.c.netRx)) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const from = dir > 0 ? Math.min(camI - 8, cx - 60) : Math.max(camI + W + 8, cx + 60);
      cars.push({ x: from, dir, v: 18 + Math.random() * 16, c: b.color, target: cx });
    }
  }
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    car.x += car.dir * car.v * dt;
    const arrived = car.target != null && (car.dir > 0 ? car.x >= car.target : car.x <= car.target);
    if (arrived || car.x < camI - W || car.x > camI + 2 * W) cars.splice(i, 1);
  }

  // window flicker: busier containers flick lights on and off more often
  for (const b of buildings) {
    if (b.dead || !b.windows.length) continue;
    if (Math.random() < dt * (0.15 + Math.min(b.c.cpu, 200) / 15)) {
      b.windows[Math.floor(Math.random() * b.windows.length)].flip = t + 0.4 + Math.random() * 2.5;
    }
    if (b.c.health === 'unhealthy' && Math.random() < dt * 3) {
      particles.push({ x: b.x + b.w / 2 + (Math.random() - 0.5) * 4, y: GROUND - b.h - 2, vx: (Math.random() - 0.5) * 4, vy: -8 - Math.random() * 6, life: 2, max: 2, c: '#5a5a66', s: 2, grav: -1 });
    }
    if (b.c.state === 'paused' && Math.random() < dt * 0.7) {
      particles.push({ x: b.x + b.w - 2, y: GROUND - b.h - 4, vx: 3, vy: -6, life: 2.5, max: 2.5, c: '#c8d0ff', text: 'Z', grav: 0 });
    }
    b.flash = Math.max(0, b.flash - dt);
  }

  // pi-hole: every blocked query is a drop of rain bouncing off the shield
  if (dropQueue > 0) {
    dropAcc += dropRate * dt;
    while (dropAcc >= 1 && dropQueue > 0) {
      drops.push({ x: Math.random() * W, y: -2, v: 70 + Math.random() * 40 });
      dropAcc--;
      dropQueue--;
    }
  }
  const shield = !!state.pihole;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.y += d.v * dt;
    const floor = shield ? domeY(d.x) : GROUND;
    if (d.y >= floor) {
      drops.splice(i, 1);
      if (shield) flashes.push({ x: d.x, life: 0.5 });
      for (let k = 0; k < 3; k++) {
        particles.push({ x: d.x + camI, y: floor, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 15, life: 0.4, max: 0.4, c: '#ff8a9a', s: 1, grav: 80 });
      }
    }
  }
  for (let i = flashes.length - 1; i >= 0; i--) if ((flashes[i].life -= dt) <= 0) flashes.splice(i, 1);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
    if ((p.life -= dt) <= 0) particles.splice(i, 1);
  }
  if (particles.length > 600) particles.splice(0, particles.length - 600);

  for (const c of clouds) {
    c.x += c.v * dt;
    if (c.x > W + 30) c.x = -40;
  }
}

// ---------- rendering ----------

function drawSky(env, t) {
  const [top, horizon] = skyAt(env.hour);
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor((GROUND * i) / bands), y1 = Math.floor((GROUND * (i + 1)) / bands);
    R(0, y0, W, y1 - y0, mix(top, horizon, (i / (bands - 1)) ** 1.6));
  }

  if (env.night > 0) {
    for (const s of stars) {
      g.globalAlpha = env.night * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.7 + s.p)));
      R(s.x, s.y, 1, 1, '#ffffff');
      if (s.big) { R(s.x - 1, s.y, 3, 1, '#c8d0ff'); R(s.x, s.y - 1, 1, 3, '#c8d0ff'); }
    }
    g.globalAlpha = 1;
  }

  const sunP = (env.hour - 6) / 14;
  if (sunP > 0 && sunP < 1) {
    const x = sunP * W, y = GROUND - 10 - Math.sin(sunP * Math.PI) * (GROUND - 40);
    g.globalAlpha = 0.25;
    disc(x, y, 9, '#fff1c0');
    g.globalAlpha = 1;
    disc(x, y, 6, mix('#ffe28a', '#ff9a5a', env.golden));
  }
  const moonP = ((env.hour - 20 + 24) % 24) / 10;
  if (moonP > 0 && moonP < 1) {
    const x = moonP * W, y = GROUND - 10 - Math.sin(moonP * Math.PI) * (GROUND - 40);
    disc(x, y, 5, '#e8ecf5');
    R(x - 2, y - 1, 2, 2, '#c4cada');
    R(x + 1, y + 2, 1, 1, '#c4cada');
  }

  const cloudC = mix(mix('#ffffff', '#ffd2b0', env.golden), '#2a3060', env.night * 0.85);
  g.globalAlpha = 0.85;
  for (const c of clouds) for (const p of c.puffs) disc(c.x + p.dx, c.y + p.dy, p.r, cloudC);
  g.globalAlpha = 1;

  const far = mix(horizon, top, 0.45);
  const farLit = mix(far, '#ffd98a', 0.55);
  const shift = Math.round(camI / 3);
  for (const s of skyline) {
    const sx = s.x - shift;
    if (sx + s.w < 0 || sx > W) continue;
    R(sx, GROUND - s.h, s.w, s.h, far);
    if (env.night > 0.3) {
      g.globalAlpha = (env.night - 0.3) / 0.7;
      for (const l of s.lights) if (l.p < 0.45) R(sx + l.x, GROUND - s.h + l.y, 1, 1, farLit);
      g.globalAlpha = 1;
    }
  }
}

function drawGround() {
  onScreen();
  R(0, GROUND, W, 2, '#9a9aa6');
  R(0, GROUND + 2, W, 1, '#6b6b78');
  R(0, GROUND + 3, W, 11, '#3b3b48');
  R(0, GROUND + 14, W, 1, '#6b6b78');
  R(0, GROUND + 15, W, H - GROUND - 15, '#2d4a33');
  inWorld();
  for (let x = Math.floor(camI / 8) * 8; x < camI + W; x += 8) R(x, GROUND + 8, 4, 1, '#d8d0a0');
  for (const p of grass) if (p.x >= camI && p.x < camI + W) R(p.x, p.y, 1, 1, p.c);
  for (const d of lamps()) {
    R(d, GROUND - 14, 1, 14, '#4a4a56');
    R(d - 1, GROUND - 15, 3, 1, '#4a4a56');
  }
}

function lamps() {
  const xs = [];
  for (let i = 0; i < districts.length - 1; i++) xs.push(Math.floor((districts[i].x1 + districts[i + 1].x0) / 2));
  return xs;
}

function laneY(dir) {
  return dir > 0 ? GROUND + 5 : GROUND + 11;
}

function drawCars() {
  for (const car of cars) {
    const x = Math.floor(car.x), y = laneY(car.dir);
    R(x, y, 7, 2, car.c);
    R(x + 2, y - 2, 3, 2, shade(car.c, 0.2));
    R(car.dir > 0 ? x + 4 : x + 2, y - 2, 1, 1, '#9cc9e8');
    R(x + 1, y + 2, 1, 1, '#111111');
    R(x + 5, y + 2, 1, 1, '#111111');
  }
}

function drawBuildings(t) {
  inWorld();
  for (const b of buildings) {
    if (!visible(b)) continue;
    const x = b.x, y = GROUND - b.h;
    b.spec.draw(b, x, y, t);
    for (const w of b.windows) R(x + w.x, y + w.y, w.w, w.h, b.dead ? '#4a3a30' : '#26304a');
    if (b.c.health === 'starting' || b.c.state === 'restarting') {
      for (let xx = 0; xx < b.w; xx += 4) R(x + xx, y - 2, 1, b.h + 2, '#c8a050');
      for (let yy = 2; yy < b.h; yy += 6) R(x - 1, y + yy, b.w + 2, 1, '#c8a050');
    }
  }
}

function drawGlow(env, t, dt) {
  inWorld();
  for (const b of buildings) {
    if (!visible(b)) continue;
    const x = b.x, y = GROUND - b.h;
    if (!b.dead && b.c.state !== 'paused') {
      const lit = 0.2 + 0.7 * Math.min(1, b.c.cpu / 40);
      g.globalAlpha = 0.14 + 0.86 * env.night;
      for (const w of b.windows) {
        const on = (w.thr < lit) !== (w.flip > t);
        if (on) R(x + w.x, y + w.y, w.w, w.h, w.tv ? '#9fd4ff' : '#ffd98a');
      }
      if (b.spec.glow) b.spec.glow(b, x, y, t, env, dt);
    }
    if (b.c.health === 'unhealthy' && Math.floor(t * 4) % 2) {
      g.globalAlpha = 1;
      R(x + (b.w >> 1) - 1, y - b.extra - 3, 2, 2, '#ff4b4b');
    }
    if (b.flash > 0) {
      g.globalAlpha = b.flash * 0.6;
      R(x, y, b.w, b.h, '#ff6b6b');
    }
    g.globalAlpha = 1;
  }

  // street lamps
  g.globalAlpha = env.night * 0.9;
  for (const lx of lamps()) {
    R(lx - 1, GROUND - 14, 3, 1, '#fff1b0');
    g.globalAlpha = env.night * 0.12;
    for (let r = 1; r < 14; r++) R(lx - Math.floor(r / 2.2), GROUND - 14 + r, Math.floor(r / 1.1) + 1, 1, '#fff1b0');
    g.globalAlpha = env.night * 0.9;
  }

  // headlights
  g.globalAlpha = 0.25 + 0.75 * env.night;
  for (const car of cars) {
    const x = Math.floor(car.x), y = laneY(car.dir);
    R(car.dir > 0 ? x + 7 : x - 1, y, 1, 1, '#fff6c0');
    R(car.dir > 0 ? x - 1 : x + 7, y, 1, 1, '#ff4b4b');
  }

  // pi-hole shield
  onScreen();
  if (state.pihole) {
    g.globalAlpha = 0.05 + 0.05 * env.night;
    for (let x = 0; x < W; x++) R(x, domeY(x), 1, 1, '#8ff3ff');
    for (const f of flashes) {
      for (let dx = -6; dx <= 6; dx++) {
        g.globalAlpha = (f.life / 0.5) * (1 - Math.abs(dx) / 7);
        R(f.x + dx, domeY(f.x + dx), 1, 1, '#b8faff');
      }
    }
  }
  g.globalAlpha = 1;
  for (const d of drops) R(d.x, d.y, 1, 2, '#ff5d73');

  inWorld();
  for (const p of particles) {
    g.globalAlpha = clamp(p.life / p.max, 0, 1);
    if (p.text) text(p.text, p.x, p.y, p.c);
    else R(p.x, p.y, p.s, p.s, p.c);
  }
  g.globalAlpha = 1;

  if (hovered) {
    const ax = hovered.x + (hovered.w >> 1), ay = GROUND - hovered.h - hovered.extra - 8 + Math.round(Math.sin(t * 4));
    R(ax - 2, ay, 5, 1, '#ffd86b'); R(ax - 1, ay + 1, 3, 1, '#ffd86b'); R(ax, ay + 2, 1, 1, '#ffd86b');
  }
  onScreen();
}

function drawMinimap(t) {
  if (cam.max <= 0 || !buildings.length) return;
  const mw = Math.min(140, Math.floor(W * 0.3)), x0 = W - mw - 6, base = H - 4;
  const k = mw / contentWidth, tallest = Math.max(...buildings.map((b) => b.h));
  const blink = Math.floor(t * 2) % 2;
  for (const b of buildings) {
    const bad = b.dead || b.c.health === 'unhealthy';
    const h = Math.max(1, Math.round((b.h / tallest) * 8));
    g.globalAlpha = bad ? (blink ? 1 : 0.5) : 0.75;
    R(x0 + b.x * k, base - h, Math.max(1, Math.round(b.w * k)), h, bad ? '#ff4b4b' : b.color);
  }
  g.globalAlpha = 0.8;
  const vx = x0 + Math.round(camI * k), vw = Math.max(3, Math.round(W * k));
  R(vx, base - 10, vw, 1, '#c8d0ff');
  R(vx, base + 1, vw, 1, '#c8d0ff');
  R(vx, base - 10, 1, 12, '#c8d0ff');
  R(vx + vw - 1, base - 10, 1, 12, '#c8d0ff');
  g.globalAlpha = 1;
}

function drawHud(env, t) {
  inWorld();
  for (const d of districts) {
    if (d.x1 < camI || d.x0 > camI + W) continue;
    const max = Math.max(1, Math.floor((d.x1 - d.x0 + DISTRICT_GAP) / 4));
    const label = d.name.length > max ? d.name.slice(0, max - 1) + '.' : d.name;
    text(label, Math.floor((d.x0 + d.x1 - textWidth(label)) / 2), GROUND + 18, '#8fb48a');
  }
  onScreen();
  drawMinimap(t);
  ticker.forEach((e, i) => {
    g.globalAlpha = 1 - i * 0.3;
    text(e.msg, 6, GROUND + 25 + i * 7, e.bad ? '#ff8a8a' : '#e8e8f0');
  });
  g.globalAlpha = 1;

  const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
  const hudC = env.night > 0.5 ? '#c8d0ff' : '#1d2148';
  text(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 6, 6, hudC);
  if (state.pihole) text(`pi-hole blocked ${state.pihole.blocked}`, 6, 13, hudC);

  const up = buildings.filter((b) => !b.dead).length, down = buildings.length - up;
  const s1 = `${up} up`, s2 = down ? `  ${down} down` : '';
  const x0 = W - 6 - textWidth(s1 + s2);
  text(s1, x0, 6, env.night > 0.5 ? '#8fe388' : '#24602a');
  if (down) text(s2, x0 + textWidth(s1) + 1, 6, '#ff6b6b');

  if (!state.connected || state.demo) {
    const msg = state.demo ? 'demo' : 'connecting...';
    text(msg, (W - textWidth(msg)) >> 1, 6, '#ffd86b');
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const hour = currentHour();
  const env = { hour, night: nightAt(hour), golden: goldenAt(hour) };

  updateCamera(dt, t);
  camI = Math.round(cam.x);
  update(dt, t);

  g = fctx;
  g.globalAlpha = 1;
  onScreen();
  drawSky(env, t);
  inWorld();
  for (const b of buildings) if (!b.dead && b.spec.sky) b.spec.sky(b, b.x, GROUND - b.h, t, env);
  onScreen();
  g.globalAlpha = 1;

  // buildings, ground and cars go on their own layer so the night tint only touches them, not the sky
  g = lctx;
  onScreen();
  g.clearRect(0, 0, W, H);
  drawGround();
  drawBuildings(t);
  drawCars();
  onScreen();
  g.globalCompositeOperation = 'source-atop';
  if (env.night > 0) { g.globalAlpha = 0.62 * env.night; R(0, 0, W, H, '#12142e'); }
  if (env.golden > 0) { g.globalAlpha = 0.14 * env.golden; R(0, 0, W, H, '#ff8a50'); }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  g = fctx;
  g.drawImage(layer, 0, 0);
  drawGlow(env, t, dt);
  drawHud(env, t);

  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(frame, 0, 0, W * S, H * S);
  requestAnimationFrame(loop);
}

// ---------- interaction ----------

const toLogical = (px) => (px * (window.devicePixelRatio || 1)) / S;

function showTip(e) {
  const lx = toLogical(e.clientX) + camI, ly = toLogical(e.clientY);
  hovered = buildings.find((b) => lx >= b.x - 2 && lx < b.x + b.w + 2 && ly >= GROUND - b.h - b.extra - 3 && ly <= GROUND) || null;
  if (!hovered) { tip.hidden = true; return; }
  const c = hovered.c;
  const health = c.health ? ` <span class="${c.health === 'healthy' ? 'ok' : c.health === 'unhealthy' ? 'bad' : 'meh'}">${esc(c.health)}</span>` : '';
  const stateCls = c.state === 'running' ? 'ok' : c.state === 'exited' ? 'bad' : 'meh';
  tip.innerHTML = `<b>${esc(c.name)}</b>`
    + `<span class="${stateCls}">${esc(c.state)}</span>${health}<br>`
    + (c.state === 'running' ? `cpu ${c.cpu.toFixed(1)}%  ·  mem ${fmtBytes(c.mem)}<br>net ↓${fmtBytes(c.netRx)}/s ↑${fmtBytes(c.netTx)}/s<br>` : '')
    + `<span class="dim">${esc(c.project || 'standalone')} · ${esc(c.image)}</span>`;
  tip.hidden = false;
  const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const ty = Math.max(8, e.clientY - tip.offsetHeight - 14);
  tip.style.left = tx + 'px';
  tip.style.top = ty + 'px';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

display.addEventListener('pointerdown', (e) => {
  if (cam.max <= 0) return;
  cam.dragging = { x: e.clientX, moved: false };
  display.setPointerCapture(e.pointerId);
});
display.addEventListener('pointermove', (e) => {
  if (cam.dragging) {
    const dx = e.clientX - cam.dragging.x;
    if (Math.abs(dx) > 2) cam.dragging.moved = true;
    if (cam.dragging.moved) {
      cam.dragging.x = e.clientX;
      panBy(-toLogical(dx), false);
      display.classList.add('dragging');
      tip.hidden = true;
      return;
    }
  }
  if (e.pointerType === 'mouse') showTip(e);
});
const endDrag = () => {
  cam.dragging = null;
  display.classList.remove('dragging');
};
display.addEventListener('pointerup', endDrag);
display.addEventListener('pointercancel', endDrag);
display.addEventListener('wheel', (e) => {
  if (cam.max <= 0) return;
  e.preventDefault();
  panBy(toLogical(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY), false);
  tip.hidden = true;
}, { passive: false });
display.addEventListener('mouseleave', () => { hovered = null; tip.hidden = true; });
display.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') forcedIdx = (forcedIdx + 1) % FORCED.length;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') panBy((e.key === 'ArrowLeft' ? -1 : 1) * W * 0.4, true);
  if ((e.key === 'd' || e.key === 'D') && buildings.length) {
    const b = buildings[Math.floor(Math.random() * buildings.length)];
    const action = ['start', 'die', 'restart', 'oom', 'healthy', 'unhealthy'][Math.floor(Math.random() * 6)];
    onEvent({ name: b.name, action });
    dropQueue += 30;
    dropRate = dropQueue / 2;
    if (!state.pihole) state.pihole = { total: 0, blocked: 0, demo: true };
  }
});

window.addEventListener('resize', resize);
resize();
connect();
requestAnimationFrame(loop);
