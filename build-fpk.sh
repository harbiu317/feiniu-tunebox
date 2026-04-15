#!/bin/bash
set -e

# Tunebox FPK 打包脚本（原生二进制，非 Docker）
#
# 用法: ./build-fpk.sh [版本号] [架构]
# 示例: ./build-fpk.sh 1.3.1 x86
#       ./build-fpk.sh 1.3.1 arm
#       ./build-fpk.sh            # 使用 manifest 中的版本，默认 x86

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR/fnos"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

VERSION="${1:-}"
ARCH="${2:-x86}"

APPNAME=$(grep "^appname" "$PKG_DIR/manifest" | awk -F'=' '{print $2}' | tr -d ' ')
[ -z "$APPNAME" ] && error "无法从 manifest 读取 appname"

if [ -z "$VERSION" ]; then
    VERSION=$(grep "^version" "$PKG_DIR/manifest" | awk -F'=' '{print $2}' | tr -d ' ')
fi
[ -z "$VERSION" ] && error "无法确定版本号"

case "$ARCH" in
    x86|amd64|x86_64) GOARCH="amd64"; ARCH="x86" ;;
    arm|arm64|aarch64) GOARCH="arm64"; ARCH="arm" ;;
    *) error "不支持的架构: $ARCH (支持: x86, arm)" ;;
esac

info "========================================"
info "  Tunebox FPK 打包"
info "========================================"
info "版本: $VERSION | 架构: $ARCH"

# Go 环境
if ! command -v go &>/dev/null; then
    [ -f "/c/Program Files/Go/bin/go" ] && export PATH="$PATH:/c/Program Files/Go/bin" || error "需要 Go 环境"
fi

WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

# === 1. 编译 ===
info "编译 music-dl..."
cd "$SCRIPT_DIR"
CGO_ENABLED=0 GOOS=linux GOARCH=$GOARCH go build -ldflags="-s -w" -o "$WORK_DIR/music-dl" ./cmd/music-dl
info "二进制: $(du -h "$WORK_DIR/music-dl" | cut -f1)"

# === 2. app.tgz ===
info "构建 app.tgz..."
APP_ROOT="$WORK_DIR/app_root"
mkdir -p "$APP_ROOT/bin" "$APP_ROOT/ui"
cp "$WORK_DIR/music-dl" "$APP_ROOT/bin/"
chmod +x "$APP_ROOT/bin/music-dl"
cp "$PKG_DIR/bin/tunebox-server" "$APP_ROOT/bin/"
chmod +x "$APP_ROOT/bin/tunebox-server"
cp -a "$PKG_DIR/ui/"* "$APP_ROOT/ui/"
cd "$APP_ROOT" && tar czf "$WORK_DIR/app.tgz" bin/ ui/
cd "$SCRIPT_DIR"

# === 3. 组装 FPK ===
FPK_DIR="$WORK_DIR/package"
mkdir -p "$FPK_DIR/cmd"

cp "$WORK_DIR/app.tgz" "$FPK_DIR/"

# cmd 脚本：共享框架（_shared_前缀）+ 应用专属 service-setup
for f in "$PKG_DIR"/cmd/_shared_*; do
    target_name=$(basename "$f" | sed 's/^_shared_//')
    cp "$f" "$FPK_DIR/cmd/$target_name"
done
cp "$PKG_DIR/cmd/service-setup" "$FPK_DIR/cmd/"

# 其他文件
cp -a "$PKG_DIR/config" "$FPK_DIR/"
cp -a "$PKG_DIR/wizard" "$FPK_DIR/"
cp "$PKG_DIR/tunebox.sc" "$FPK_DIR/"
cp "$PKG_DIR/ICON.PNG" "$FPK_DIR/"
cp "$PKG_DIR/ICON_256.PNG" "$FPK_DIR/"
cp -a "$PKG_DIR/ui" "$FPK_DIR/"
cp "$FPK_DIR/ICON_256.PNG" "$FPK_DIR/ui/images/256.png"

# manifest + checksum
cp "$PKG_DIR/manifest" "$FPK_DIR/"
CHECKSUM=$(md5sum "$WORK_DIR/app.tgz" | cut -d' ' -f1)
sed -i "s/^version.*=.*/version         = ${VERSION}/" "$FPK_DIR/manifest"
sed -i "s/^checksum.*=.*/checksum        = ${CHECKSUM}/" "$FPK_DIR/manifest"
sed -i "s/^platform.*=.*/platform        = ${ARCH}/" "$FPK_DIR/manifest"

# === 4. 打包 ===
FPK_NAME="${APPNAME}_${VERSION}_${ARCH}.fpk"
mkdir -p "$SCRIPT_DIR/dist"
cd "$FPK_DIR" && tar -czf "$SCRIPT_DIR/dist/$FPK_NAME" *
cd "$SCRIPT_DIR"

info "完成: dist/$FPK_NAME ($(du -h "dist/$FPK_NAME" | cut -f1))"
