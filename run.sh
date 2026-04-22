#!/bin/bash
echo "=== Hieusi-CRM Deploy ==="

echo "[1/3] Push code len GitHub..."
git add -A
git commit -m "auto: update" 2>/dev/null
git push origin main

echo "[2/3] Deploy len VPS..."
ssh root@14.225.224.8 'PATH=$PATH:$HOME/.bun/bin && cd /root/Hieusi-CRM && git pull origin main && bun install 2>/dev/null && pkill -f "bun.*src" 2>/dev/null; sleep 1 && nohup bun run start > crm.log 2>&1 &'

echo "[3/3] Cho server khoi dong..."
sleep 5

echo "=== DONE! Truy cap: http://14.225.224.8:10001 ==="
