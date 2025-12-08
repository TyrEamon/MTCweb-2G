FROM python:3.10-slim

# 1. 安装 wget 和必要库
RUN apt-get update && apt-get install -y wget curl ca-certificates && rm -rf /var/lib/apt/lists/*

# 2. 直接下载并解压官方二进制包 (v6.0 版本比较通用)
# 注意：我们下载到 /usr/bin 并直接命名为 telegram-bot-api
RUN wget https://github.com/tdlib/telegram-bot-api/releases/download/v6.0/telegram-bot-api-linux-amd64.tar.gz -O /tmp/api.tar.gz \
    && tar -xzf /tmp/api.tar.gz -C /usr/bin/ \
    && mv /usr/bin/telegram-bot-api-linux-amd64 /usr/bin/telegram-bot-api \
    && chmod +x /usr/bin/telegram-bot-api \
    && rm /tmp/api.tar.gz

# 3. 创建数据目录
RUN mkdir -p /var/lib/telegram-bot-api

# 4. Python 环境
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 5. 拷贝代码
COPY . ./

# 6. 启动脚本
RUN echo '#!/bin/bash\n\
echo "Starting Local Bot API..."\n\
telegram-bot-api --api-id=${TELEGRAM_API_ID} --api-hash=${TELEGRAM_API_HASH} --local --http-port=8081 --dir=/var/lib/telegram-bot-api &\n\
sleep 3\n\
echo "Starting Bot..."\n\
python bot.py\n\
' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
