#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ ! -d dev/node_modules/playwright ]; then
  echo "first run: (cd dev && npm install && npx playwright install --only-shell chromium)" >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed to encode the GIF" >&2; exit 1; }

frames=$(mktemp -d)
trap 'rm -rf "$frames"' EXIT

node dev/record-gif.cjs "$frames" "file://$PWD/web/index.html?demo&hour=20.3&scale=2"
ffmpeg -loglevel error -y -framerate 15 -i "$frames/f%04d.png" -vf "palettegen=max_colors=256:stats_mode=full" "$frames/palette.png"
ffmpeg -loglevel error -y -framerate 15 -i "$frames/f%04d.png" -i "$frames/palette.png" -lavfi "paletteuse=dither=none:diff_mode=rectangle" -loop 0 assets/demo.gif
echo "assets/demo.gif: $(du -h assets/demo.gif | cut -f1)"
