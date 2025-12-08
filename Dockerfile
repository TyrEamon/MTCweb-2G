# ----------------------------------------------------
# 阶段 1: 编译阶段 (按照官方文档操作)
# ----------------------------------------------------
FROM python:3.10-slim-bullseye AS builder

# 1. 安装官方文档要求的依赖: git, cmake, g++, zlib, openssl, gperf
RUN apt-get update && apt-get install -y \
    git \
    cmake \
    g++ \
    make \
    zlib1g-dev \
    libssl-dev \
    gperf \
    && rm -rf /var/lib/apt/lists/*

# 2. 拉取源码
WORKDIR /tmp
RUN git clone --recursive https://github.com/tdlib/telegram-bot-api.git

# 3. 编译 (官方命令)
WORKDIR /tmp/telegram-bot-api
RUN rm -rf build && mkdir build && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX:PATH=/usr/local .. \
    && cmake --build . --target install

# ----------------------------------------------------
# 阶段 2: 运行阶段
# ----------------------------------------------------
FROM python:3.10-slim-bullseye

# 1. 安装运行时依赖 (编译后的程序需要这些库才能跑)
# 对应官方文档提到的: OpenSSL, zlib
RUN apt-get update && apt-get install -y \
    libssl1.1 \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

# 2. 从编译阶段把生成的二进制文件拷过来
COPY --from=builder /usr/local/bin/telegram-bot-api /usr/bin/telegram-bot-api

# 3. 创建数据目录
RUN mkdir -p /var/lib/telegram-bot-api

# 4. 配置 Python 环境
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 5. 拷贝代码
COPY . ./

# 6. 启动脚本 (同时启动 API 和 Bot)
RUN echo '#!/bin/bash\n\
echo "Starting Telegram Bot API..."\n\
telegram-bot-api --api-id=${TELEGRAM_API_ID} --api-hash=${TELEGRAM_API_HASH} --local --http-port=8081 --dir=/var/lib/telegram-bot-api &\n\
sleep 5\n\
echo "Starting Python Bot..."\n\
python bot.py\n\
' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
