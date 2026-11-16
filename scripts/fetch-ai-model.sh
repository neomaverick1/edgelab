#!/usr/bin/env bash
# Puts the built-in AI model (all-MiniLM-L6-v2, 8-bit, about 21 MB) into public/models, so every build of the app
# (web, Android and iPhone) carries it and never needs a download.
set -euo pipefail
MODEL=${1:-Xenova/all-MiniLM-L6-v2}
DEST="public/models/$MODEL"
mkdir -p "$DEST/onnx"
for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx; do
  [ -s "$DEST/$f" ] || curl -fsSL --retry 3 -o "$DEST/$f" "https://huggingface.co/$MODEL/resolve/main/$f"
  echo "$f $(du -h "$DEST/$f" | cut -f1)"
done
