#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
PLATFORMS="linux/amd64,linux/arm64"
IMAGES="backend frontend"
ACTION="load"
REGISTRY=""
TAG="latest"
BUILDER_NAME="enclave-multiarch"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build EnclaveStation Docker images for multiple architectures.

Options:
  --platform PLATFORMS   Comma-separated platforms (default: linux/amd64,linux/arm64)
  --image IMAGE          Build only this image (backend or frontend, default: both)
  --push                 Push to registry instead of loading locally
  --registry REGISTRY    Registry prefix (e.g. ghcr.io/user/repo)
  --tag TAG              Image tag (default: latest)
  -h, --help             Show this help

Examples:
  # Build both images for arm64 only, load into local Docker
  $(basename "$0") --platform linux/arm64

  # Build and push multi-arch images to a registry
  $(basename "$0") --push --registry ghcr.io/myuser/enclave-station --tag v1.0.0

  # Build only the backend for both architectures
  $(basename "$0") --image backend

Notes:
  - Local loads (--load) only support a single platform. If multiple platforms
    are specified without --push, images are built but not loaded.
  - Cross-platform builds use QEMU emulation. The C++ backend build will be
    slow (~15-30 min) when emulating arm64 on x86-64 or vice versa.
  - To speed up cross-platform builds, consider using a remote builder:
      docker buildx create --name remote --driver remote tcp://arm64-host:1234
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)  PLATFORMS="$2"; shift 2 ;;
        --image)     IMAGES="$2"; shift 2 ;;
        --push)      ACTION="push"; shift ;;
        --registry)  REGISTRY="$2"; shift 2 ;;
        --tag)       TAG="$2"; shift 2 ;;
        -h|--help)   usage ;;
        *)           echo "Unknown option: $1"; usage ;;
    esac
done

if [[ "$ACTION" == "push" && -z "$REGISTRY" ]]; then
    echo "Error: --push requires --registry"
    exit 1
fi

# Ensure QEMU is registered for cross-platform builds
setup_qemu() {
    if ! docker buildx ls 2>/dev/null | grep -q "linux/arm64"; then
        echo "==> Setting up QEMU for cross-platform builds..."
        docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
    fi
}

# Create or reuse a buildx builder that supports multi-platform
setup_builder() {
    if ! docker buildx inspect "$BUILDER_NAME" &>/dev/null; then
        echo "==> Creating buildx builder: $BUILDER_NAME"
        docker buildx create --name "$BUILDER_NAME" --driver docker-container --use
    else
        docker buildx use "$BUILDER_NAME"
    fi
}

build_image() {
    local image="$1"
    local context="$SCRIPT_DIR/$image"
    local image_name="$image"

    if [[ -n "$REGISTRY" ]]; then
        image_name="$REGISTRY/$image"
    fi

    echo ""
    echo "=========================================="
    echo "  Building $image for $PLATFORMS"
    echo "=========================================="

    local output_flag
    if [[ "$ACTION" == "push" ]]; then
        output_flag="--push"
    else
        # --load only works with single platform
        local platform_count
        platform_count=$(echo "$PLATFORMS" | tr ',' '\n' | wc -l)
        if [[ "$platform_count" -eq 1 ]]; then
            output_flag="--load"
        else
            echo "  (multi-platform without --push: images will be built but not loaded into local Docker)"
            output_flag=""
        fi
    fi

    docker buildx build \
        --platform "$PLATFORMS" \
        --tag "$image_name:$TAG" \
        $output_flag \
        "$context"
}

setup_qemu
setup_builder

for image in $IMAGES; do
    build_image "$image"
done

echo ""
echo "Done!"
