#!/usr/bin/env bash
set -euo pipefail

echo "== northmadbot Linux deploy helper =="

if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Script ini saat ini khusus Ubuntu/Debian (apt-get)."
  exit 1
fi

echo "Install system packages (curl, ffmpeg, build-essential)..."
$SUDO apt-get update -y
$SUDO apt-get install -y curl ca-certificates ffmpeg build-essential

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum ada, install Node 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

echo "Install dependencies project..."
npm install

echo "Jalankan setup PM2..."
node setup.js
