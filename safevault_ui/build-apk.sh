#!/usr/bin/env bash
#
# 一键将 SafeVault 前端打包为 Android APK
# ------------------------------------------------------------
# 首次运行：自动完成 Capacitor 接入（装依赖 → 初始化 → 生成 android/ 原生工程）。
# 之后运行：仅重新构建 Web 产物并出包。脚本幂等，可反复执行。
#
# 用法：
#   ./build-apk.sh                    # 出调试版 APK（自带调试签名，可直接装机）
#   ./build-apk.sh release            # 出正式版 APK（需提供签名，见下方环境变量）
#   ./build-apk.sh --install          # 出调试版并通过 USB 自动安装到已连设备
#   ./build-apk.sh --install --launch # 安装后并在手机上启动 App
#   ./build-apk.sh release --install  # 组合使用（顺序随意）
#
# 正式版签名（可选，缺省则产出未签名包并提示）：
#   KEYSTORE_PATH=~/safevault.keystore \
#   KEYSTORE_PASSWORD=xxx KEY_ALIAS=safevault KEY_PASSWORD=xxx \
#   ./build-apk.sh release
#
set -euo pipefail

# ---------- 可配置项 ----------
APP_NAME="SafeVault"           # 应用显示名
APP_ID="com.safevault.app"     # 应用包名（唯一标识，正式发布前请改成你自己的域名反写）
WEB_DIR="dist"                 # vite build 产物目录

# ---------- 参数解析（顺序随意）----------
BUILD_TYPE="debug"             # debug | release
INSTALL=false                  # 是否打包后自动安装到已连设备
LAUNCH=false                   # 安装后是否启动 App
for arg in "$@"; do
  case "$arg" in
    debug|release) BUILD_TYPE="$arg" ;;
    --install) INSTALL=true ;;
    --launch) INSTALL=true; LAUNCH=true ;;
    *) printf '未知参数：%s（可用：debug|release|--install|--launch）\n' "$arg" >&2; exit 1 ;;
  esac
done

# ---------- 日志辅助 ----------
info()  { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die()   { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 切到脚本所在目录（safevault_ui），保证相对路径稳定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- 前置检查 ----------
info "检查工具链…"
command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js"
command -v npm  >/dev/null 2>&1 || die "未找到 npm"

# Capacitor 的 Android 工程要求 JDK 21：优先用 Android Studio 自带 JBR，
# 其次系统 JAVA_HOME（若已是 21+），最后回落 /usr/libexec/java_home。
java_major() { "$1" -version 2>&1 | awk -F '"' '/version/{print $2}' | cut -d. -f1; }
JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" && "$(java_major "$JAVA_HOME/bin/java")" -ge 21 ]]; then
  : # 当前 JAVA_HOME 已满足，沿用
elif [[ -x "$JBR/bin/java" && "$(java_major "$JBR/bin/java")" -ge 21 ]]; then
  export JAVA_HOME="$JBR"
elif command -v /usr/libexec/java_home >/dev/null 2>&1 && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
else
  die "未找到 JDK 21（Capacitor Android 要求）。请安装 JDK 21，或确保 Android Studio 已正确安装。"
fi
export PATH="$JAVA_HOME/bin:$PATH"
ok "JDK 21: $JAVA_HOME"

# 自动探测 Android SDK（macOS 默认安装路径）
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi
[[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]] \
  || die "未找到 Android SDK。请安装 Android Studio 并配置 ANDROID_HOME 后重试。"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ok "Android SDK: $ANDROID_HOME"

# ---------- 1. 安装 Capacitor（仅首次） ----------
if ! npx --no-install cap --version >/dev/null 2>&1; then
  info "首次接入：安装 Capacitor 依赖…"
  npm install @capacitor/core @capacitor/android
  npm install -D @capacitor/cli
  ok "Capacitor 依赖安装完成"
fi

# ---------- 2. 初始化 Capacitor 配置（仅首次） ----------
if ! ls capacitor.config.* >/dev/null 2>&1; then
  info "生成 capacitor.config…"
  npx cap init "$APP_NAME" "$APP_ID" --web-dir="$WEB_DIR"
  ok "Capacitor 初始化完成"
fi

# ---------- 3. 构建 Web 产物 ----------
info "构建 Web 产物（vite build）…"
npm run build
[[ -d "$WEB_DIR" ]] || die "构建产物 $WEB_DIR/ 不存在，构建可能失败"

# ---------- 4. 添加 android 原生工程（仅首次） ----------
if [[ ! -d android ]]; then
  info "生成 android/ 原生工程…"
  npx cap add android
  ok "android 工程已生成"
fi

# ---------- 5. 同步产物到原生工程 ----------
info "同步 Web 产物到 android 工程（cap sync）…"
npx cap sync android

# ---------- 6. Gradle 出包 ----------
cd android
chmod +x ./gradlew 2>/dev/null || true

if [[ "$BUILD_TYPE" == "release" ]]; then
  if [[ -n "${KEYSTORE_PATH:-}" ]]; then
    info "构建正式版 APK（已签名）…"
    ./gradlew assembleRelease \
      -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
      -Pandroid.injected.signing.store.password="${KEYSTORE_PASSWORD:?需提供 KEYSTORE_PASSWORD}" \
      -Pandroid.injected.signing.key.alias="${KEY_ALIAS:?需提供 KEY_ALIAS}" \
      -Pandroid.injected.signing.key.password="${KEY_PASSWORD:?需提供 KEY_PASSWORD}"
  else
    warn "未提供签名（KEYSTORE_PATH 等），将产出未签名包，无法直接安装。"
    ./gradlew assembleRelease
  fi
  SEARCH_DIR="app/build/outputs/apk/release"
else
  info "构建调试版 APK…"
  ./gradlew assembleDebug
  SEARCH_DIR="app/build/outputs/apk/debug"
fi
cd "$SCRIPT_DIR"

# ---------- 7. 收集产物到 apk-output/ ----------
APK_SRC="$(find "android/$SEARCH_DIR" -maxdepth 1 -name '*.apk' -print -quit 2>/dev/null || true)"
[[ -n "$APK_SRC" ]] || die "未找到生成的 APK，请检查上面的 Gradle 输出"

OUT_DIR="$SCRIPT_DIR/apk-output"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
APK_DEST="$OUT_DIR/${APP_NAME}-${BUILD_TYPE}-${STAMP}.apk"
cp "$APK_SRC" "$APK_DEST"

ok "打包完成！"
echo "  原始产物：$APK_SRC"
echo "  归档副本：$APK_DEST"

# ---------- 8. （可选）通过 USB 安装到已连设备 ----------
if [[ "$INSTALL" == true ]]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
  [[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
  [[ -n "$ADB" && -x "$ADB" ]] || die "未找到 adb，无法安装（请确认 Android SDK platform-tools 已安装）"

  # 统计 device 状态（已授权）的设备数
  DEVICE_COUNT="$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
  if [[ "$DEVICE_COUNT" -eq 0 ]]; then
    warn "未检测到已授权的 USB 设备。请连上手机、开启「USB 调试」并在手机上允许调试授权后重试。"
    "$ADB" devices
    exit 1
  elif [[ "$DEVICE_COUNT" -gt 1 ]]; then
    warn "检测到多台设备，将安装到第一台。如需指定，请手动：adb -s <序列号> install -r \"$APK_DEST\""
  fi

  info "通过 USB 安装到设备…"
  "$ADB" install -r "$APK_DEST"
  ok "安装成功"

  if [[ "$LAUNCH" == true ]]; then
    info "在手机上启动 ${APP_NAME}…"
    "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
      && ok "已启动" || warn "启动失败，请在手机上手动打开"
  fi
else
  echo
  echo "安装到已连 USB 的手机：adb install -r \"$APK_DEST\""
  echo "或下次直接：./build-apk.sh --install（打包并自动安装）"
fi
