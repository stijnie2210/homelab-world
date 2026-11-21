# Maintainer notes

Run these from the root of the repo.

## The demo GIF

`assets/demo.gif` is recorded from demo mode with Playwright. The recording runs on its own virtual clock with a seeded `Math.random`, so on the same machine and browser build it produces the same GIF byte for byte. It needs Node and ffmpeg:

```sh
(cd dev && npm install && npx playwright install --only-shell chromium)   # once
dev/record-gif.sh
```

The camera position, the time of day and the moments of the confetti, rain and OOM are set in `dev/record-gif.cjs`.

## Releasing

Every push to `main` publishes `ghcr.io/stijnie2210/homelab-world:main` and `:sha-<commit>`. A tag like `v0.1.0` publishes `:0.1.0`, `:0.1` and `:latest`, which is what `compose.yaml` pulls:

```sh
git tag v0.1.0 && git push origin v0.1.0
```
