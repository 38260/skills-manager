#!/usr/bin/env bash
# 测量打包产物从「双击」到「本地服务就绪」的墙钟耗时（含便携版自解压）。
set -u
LOG="$USERPROFILE/.skills-manager/logs/server.log"
TARGET="${1:?用法: time-launch.sh <exe路径> <端口>}"
PORT="${2:?}"
BEFORE=$(wc -l < "$LOG" 2>/dev/null || echo 0)
echo "[launcher] 目标: $TARGET 端口: $PORT  起始日志行: $BEFORE"

START=$(date +%s%3N)
SKILLS_MANAGER_PORT="$PORT" "$TARGET" >/dev/null 2>&1 &
PID=$!
echo "[launcher] 已启动 PID=$PID，开始轮询日志…"

elapsed=""
for i in $(seq 1 600); do
  NOW=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE" ]; then
    NEW=$(tail -n +$((BEFORE + 1)) "$LOG")
    if echo "$NEW" | grep -q "本地服务已启动"; then
      END=$(date +%s%3N)
      elapsed=$((END - START))
      echo "[launcher] ✅ 服务就绪，耗时 ${elapsed}ms"
      echo "$NEW" | grep -E "本地服务已启动|占用|失败|startup" | tail -6
      break
    fi
  fi
  sleep 0.1
done
[ -z "$elapsed" ] && echo "[launcher] ❌ 12 秒内未见服务就绪"

# 让前端把 refresh_app_data_* 事件也写进来，便于看首屏数据耗时
sleep 3
tail -n 8 "$LOG"
