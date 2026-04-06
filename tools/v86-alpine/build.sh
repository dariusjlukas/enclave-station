#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${SCRIPT_DIR}/../../frontend"
PUBLIC_V86_DIR="${FRONTEND_DIR}/public/v86"
ASSETS_DIR="${FRONTEND_DIR}/v86-assets"
CONTAINER_NAME="v86-alpine-build"
IMAGE_NAME="v86-alpine"

echo "==> Building Alpine Linux image for v86..."

# Build Docker image (32-bit)
docker build --platform linux/386 -t "$IMAGE_NAME" "$SCRIPT_DIR"

# Create container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker create --platform linux/386 -ti --name "$CONTAINER_NAME" "$IMAGE_NAME" /bin/sh

# Export rootfs
echo "==> Exporting rootfs..."
docker export "$CONTAINER_NAME" > /tmp/alpine-rootfs.tar

# Extract kernel and initramfs
echo "==> Extracting kernel and initramfs..."
mkdir -p /tmp/v86-alpine-extract "$PUBLIC_V86_DIR"
cd /tmp/v86-alpine-extract
tar xf /tmp/alpine-rootfs.tar boot/
cp boot/vmlinuz-lts "$PUBLIC_V86_DIR/vmlinuz-alpine"
cp boot/initramfs-lts "$PUBLIC_V86_DIR/initramfs-alpine"
chmod 644 "$PUBLIC_V86_DIR/vmlinuz-alpine" "$PUBLIC_V86_DIR/initramfs-alpine"

# Extract rootfs for 9p serving (served by nginx/Vite dev plugin)
echo "==> Extracting rootfs for 9p filesystem..."
rm -rf "$ASSETS_DIR/alpine-rootfs"
mkdir -p "$ASSETS_DIR/alpine-rootfs"
cd "$ASSETS_DIR/alpine-rootfs"
tar xf /tmp/alpine-rootfs.tar
rm -rf boot
chmod -R u+r .

# Generate the v86 filesystem JSON index using v86's fs2json.py
echo "==> Generating v86 filesystem index (basefs)..."
python3 "$SCRIPT_DIR/fs2json.py" --exclude boot --out "$PUBLIC_V86_DIR/alpine-basefs.json" "$ASSETS_DIR/alpine-rootfs"
echo "  Index size: $(du -h "$PUBLIC_V86_DIR/alpine-basefs.json" | cut -f1)"

# Create flat hash-named files for 9p serving
# v86 fetches files by their SHA256 hash (e.g., "2760cf8d.bin")
echo "==> Creating hash-named files for 9p..."
rm -rf "$ASSETS_DIR/alpine-flat"
mkdir -p "$ASSETS_DIR/alpine-flat"
python3 - "$ASSETS_DIR/alpine-rootfs" "$ASSETS_DIR/alpine-flat" << 'PYTHON'
import hashlib
import os
import sys
import shutil

rootfs = sys.argv[1]
flat_dir = sys.argv[2]
count = 0

for dirpath, _, filenames in os.walk(rootfs):
    for fname in filenames:
        full = os.path.join(dirpath, fname)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        with open(full, "rb") as f:
            h = hashlib.sha256()
            for chunk in iter(lambda: f.read(128 * 1024), b""):
                h.update(chunk)
        hash_name = h.hexdigest()[:8] + ".bin"
        dest = os.path.join(flat_dir, hash_name)
        if not os.path.exists(dest):
            shutil.copy2(full, dest)
            count += 1

print(f"  Created {count} hash-named files")
PYTHON
echo "  Flat dir size: $(du -sh "$ASSETS_DIR/alpine-flat" | cut -f1)"

# Cleanup
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
rm -rf /tmp/v86-alpine-extract /tmp/alpine-rootfs.tar

echo ""
echo "==> Done! Files:"
echo "  public/v86/ (bundled by Vite):"
ls -lh "$PUBLIC_V86_DIR/vmlinuz-alpine" "$PUBLIC_V86_DIR/initramfs-alpine" "$PUBLIC_V86_DIR/alpine-basefs.json"
echo "  v86-assets/ (served separately):"
du -sh "$ASSETS_DIR/alpine-rootfs/"
