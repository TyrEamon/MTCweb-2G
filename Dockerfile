# ----------------------------------------------------
# 阶段 1: 从官方镜像获取二进制文件
# ----------------------------------------------------
FROM aiogram/telegram-bot-api:latest AS api-source

# ----------------------------------------------------
# 阶段 2: 最终镜像 (使用 full 版本，避免缺库)
# ----------------------------------------------------
FROM python:3.10-slim-bullseye

# 1. 拷贝二进制文件
# 注意：我们这里尝试拷贝整个 /usr/bin 目录下的 telegram-bot-api
# 如果路径不对，构建阶段就会直接报错停止，不会等到运行时才崩
COPY --from=api-source /usr/bin/telegram-bot-api /usr/bin/telegram-bot-api

# 2. 安装运行时依赖 (防缺库)
RUN apt-get update && apt-get install -y \
    libssl-dev zlib1g \
    && rm -rf /var/lib/apt/lists/*

# 3. 赋予执行权限
RUN chmod +x /usr/bin/telegram-bot-api

# 4. 创建数据目录
RUN mkdir -p /var/lib/telegram-bot-api

# 5. Python 环境
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 6. 拷贝代码
COPY . ./

# 7. 启动脚本
RUN echo '#!/bin/bash\n\
echo "Starting Local Bot API..."\n\
telegram-bot-api --api-id=${TELEGRAM_API_ID} --api-hash=${TELEGRAM_API_HASH} --local --http-port=8081 --dir=/var/lib/telegram-bot-api &\n\
sleep 3\n\
echo "Starting Bot..."\n\
python bot.py\n\
' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
