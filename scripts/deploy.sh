#!/bin/bash

# HackMD Search Deploy Script
# srcディレクトリをDEPLOY_TARGETにrsyncする

set -e

# プロジェクトルートに移動
cd "$(dirname "$0")/.."

# .envファイルを読み込み
if [ ! -f .env ]; then
    echo "Error: .env file not found"
    exit 1
fi

# .envを読み込んでDEPLOY_TARGETを取得（環境変数を展開）
export $(cat .env | grep -v '^#' | xargs)
DEPLOY_TARGET=$(eval echo "$DEPLOY_TARGET")

if [ -z "$DEPLOY_TARGET" ]; then
    echo "Error: DEPLOY_TARGET not set in .env"
    exit 1
fi

echo "Deploying to: $DEPLOY_TARGET"
echo "Source: src/"

# ターゲットディレクトリが存在しない場合は作成
if [ ! -d "$DEPLOY_TARGET" ]; then
    echo "Creating target directory: $DEPLOY_TARGET"
    mkdir -p "$DEPLOY_TARGET"
fi

# rsyncでデプロイ
# -a: アーカイブモード（属性を保持）
# -v: 詳細表示
# --delete: ターゲットにないファイルを削除
# --exclude: 除外するファイル/ディレクトリ
rsync -av --delete \
    --exclude='.DS_Store' \
    --exclude='*.log' \
    src/ "$DEPLOY_TARGET/"

echo "Deploy completed successfully"
