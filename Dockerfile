# ----------------------------------------------------
# 阶段 1: 获取 telegram-bot-api 二进制文件
# ----------------------------------------------------
FROM aiogram/telegram-bot-api:latest AS api-source

# ----------------------------------------------------
# 阶段 2: 构建最终的运行环境
# ----------------------------------------------------
FROM python:3.10-slim

# 1. 安装 curl (可选，用于调试) 和清理缓存
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# 2. 【关键】从阶段1拷贝 telegram-bot-api 到当前镜像
COPY --from=api-source /usr/bin/telegram-bot-api /usr/bin/telegram-bot-api

# 3. 创建数据目录 (用于挂载 20GB 卷)
RUN mkdir -p /var/lib/telegram-bot-api

# 4. 配置 Python 环境
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 5. 拷贝代码
COPY . ./

# 6. 【关键】生成启动脚本：同时启动 API Server 和 Python Bot
# 注意：--http-port=8081 必须与您 Python 代码里的端口一致
RUN echo '#!/bin/bash\n\
echo "Starting Telegram Local Bot API..."\n\
telegram-bot-api --api-id=${TELEGRAM_API_ID} --api-hash=${TELEGRAM_API_HASH} --local --http-port=8081 --dir=/var/lib/telegram-bot-api &\n\
API_PID=$!\n\
\n\
echo "Waiting for API to start..."\n\
sleep 3\n\
\n\
echo "Starting Python Bot..."\n\
python bot.py\n\
' > /app/start.sh && chmod +x /app/start.sh

# 7. 启动入口
CMD ["/app/start.sh"]
