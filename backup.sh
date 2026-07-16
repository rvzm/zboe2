#!/usr/bin/env bash

set -euo pipefail

REMOTE_HOST="rvzm@vulkan.rvzm.me"

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <remote-directory>"
    exit 1
fi

REMOTE_DIR="$1"

echo "Backing up to cold storage"
rsync \
    -av \
    --mkpath \
    --delete \
    --filter=':- .gitignore' \
    ./ \
    "${REMOTE_HOST}:${REMOTE_DIR}"
echo "Uploading to live"
rsync \
    -av \
    --delete \
    --filter=':- .gitignore' \
    ./ \
    "rvzm@kelvin.rvzm.me:/home/rvzm/projects/zboe2/"
echo "Backup and Upload complete"
