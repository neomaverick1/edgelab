#!/usr/bin/env bash
# Downloads the built-in AI model (Qwen2.5 0.5B Instruct, 4-bit) into a phone app's web folder, so the app
# carries it and never needs a download or a connection. Usage: scripts/fetch-ai-model.sh <folder>
set -euo pipefail
MODEL=onnx-community/Qwen2.5-0.5B-Instruct
DEST="$1/$MODEL"
mkdir -p "$DEST/onnx"
for f in config.json generation_config.json tokenizer.json tokenizer_config.json onnx/model_q4.onnx; do
  curl -fsSL --retry 3 -o "$DEST/$f" "https://huggingface.co/$MODEL/resolve/main/$f"
  echo "$f $(du -h "$DEST/$f" | cut -f1)"
done
