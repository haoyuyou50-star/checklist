#!/bin/bash
cd "$(dirname "$0")"
echo "Monet Immersive - http://localhost:8123  (Ctrl+C to stop)"
(sleep 1; open "http://localhost:8123/") &
python3 -m http.server 8123
