#!/bin/bash
# HumHum macOS 安装脚本
# 用法: bash install.sh
# 或者: curl -fsSL <url>/install.sh | bash

set -euo pipefail

APP_NAME="HumHum.app"
INSTALL_DIR="/Applications"

# 查找 .dmg 或 .app（同目录下）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

install_from_dmg() {
  local dmg="$1"
  echo "📦 正在挂载 $dmg ..."
  local mount_point
  mount_point=$(hdiutil attach "$dmg" -nobrowse -quiet 2>/dev/null | tail -1 | awk '{print $NF}')

  if [ ! -d "$mount_point/$APP_NAME" ]; then
    mount_point=$(find /Volumes -maxdepth 1 -name "HumHum*" -type d 2>/dev/null | head -1)
  fi

  if [ ! -d "$mount_point/$APP_NAME" ]; then
    echo "❌ DMG 中未找到 $APP_NAME"
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    exit 1
  fi

  echo "📋 正在安装到 $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR/$APP_NAME"
  cp -R "$mount_point/$APP_NAME" "$INSTALL_DIR/"
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true
}

install_from_app() {
  local app="$1"
  echo "📋 正在安装到 $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR/$APP_NAME"
  cp -R "$app" "$INSTALL_DIR/$APP_NAME"
}

# 自动检测安装源
DMG=$(find "$SCRIPT_DIR" -maxdepth 1 -name "*.dmg" -type f 2>/dev/null | head -1)
APP=$(find "$SCRIPT_DIR" -maxdepth 1 -name "$APP_NAME" -type d 2>/dev/null | head -1)

if [ -n "$DMG" ]; then
  install_from_dmg "$DMG"
elif [ -n "$APP" ]; then
  install_from_app "$APP"
else
  echo "❌ 未找到 HumHum.dmg 或 HumHum.app，请把此脚本和安装包放在同一目录"
  exit 1
fi

# 移除 macOS 隔离属性（绕过 Gatekeeper "恶意软件" 警告）
xattr -cr "$INSTALL_DIR/$APP_NAME"

echo "✅ HumHum 安装完成！"
echo "   可以从启动台或 /Applications 打开"
open "$INSTALL_DIR/$APP_NAME"
