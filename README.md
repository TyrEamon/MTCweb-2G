# MTC-WebDepot 🎥

> **Turn your Telegram Channel into a Private Unlimited Cloud Storage & Streaming Platform.**

**MTC-WebDepot** 是一个全栈解决方案，利用 Telegram 本地机器人 API (Local Bot API) 作为无限存储后端，配合 Python 文件服务器进行流式传输，并使用 Cloudflare Workers 作为高性能前端展示页面。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/backend-Python%203.10-yellow)
![Cloudflare](https://img.shields.io/badge/frontend-Cloudflare%20Workers-orange)
![Telegram](https://img.shields.io/badge/API-Local%20Bot%20API-blue)

## ✨ 主要特性 (Features)

*   **🚀 无限空间 & 大文件支持**：通过 Local Bot API 绕过官方 20MB/50MB 限制，支持上传 2GB+ 单个视频/文件。
*   **⚡ 全球 CDN 加速**：前端部署在 Cloudflare Worker，配合 KV 存储元数据，实现秒级响应。
*   **🎬 在线流媒体播放**：后端 Python 服务支持 HTTP Range 请求，实现视频拖拽播放、倍速观看。
*   **🛡️ 安全隐私设计**：
    *   **Token 隐藏**：自研安全路由逻辑，公开链接不包含 Bot Token。
    *   **密码保护**：支持为特定图包/相册设置访问密码。
    *   **智能清理**：内置 LRU 自动清理脚本，在有限的 VPS/容器硬盘上实现“无限”流转。
*   **🎨 现代化 UI**：
    *   响应式设计 (手机/PC 自适应)。
    *   深色毛玻璃风格。
    *   **功能全**：支持 **搜索**、**分页**、**分类导航**、**侧边栏菜单**。
    *   内置视频播放器与下载管理。

## 🏗️ 架构概览 (Architecture)

graph LR
    User[用户] --> CF[Cloudflare Worker <br/> (UI / Cache / Search)]
    CF -- Metadata --> KV[Cloudflare KV]
    CF -- Stream/Download --> Leaflow[Leaflow / VPS Container]
    Leaflow -- Local API --> TG[Telegram Server]

## 🛠️ 部署指南 (Deployment)

### 1. 后端部署 (Leaflow / VPS)
后端运行在 Docker 容器中，包含 `telegram-bot-api` 和本项目的 `bot.py`。

**环境要求**:
*   Python 3.10+
*   Telegram Bot Token
*   Cloudflare Account ID / API Token (用于写 KV)

**关键环境变量**:
```bash
BOT_TOKEN=123456:ABC-Def...
CF_ACCOUNT_ID=your_cf_account_id
CF_NAMESPACE_ID=your_kv_namespace_id
CF_API_TOKEN=your_cf_api_token
PUBLIC_DOWNLOAD_ROOT=https://your-domain.com  # 你的后端域名
CATEGORIES="Cosplay,Video,Software"           # 自定义分类
```

**运行 Bot**:
```bash
python bot.py
```
*(脚本会自动启动 8080 端口的文件服务器和 1 分钟一次的磁盘清理线程)*

### 2. 前端部署 (Cloudflare Workers)
1.  在 Cloudflare 创建一个新的 Worker。
2.  创建一个 **KV Namespace**，命名为 `ALBUMS`，并在 Worker 设置中绑定变量名为 `ALBUMS`。
3.  复制 `worker.js` 的代码到编辑器。
4.  **配置顶部常量**:
    ```javascript
    const SITE_TITLE = "MTCweb";
    const LOGO_URL = "https://..."; // 你的 Logo 图片链接 (可选)
    ```
5.  点击 **Deploy**。

## 🤖 机器人指令 (Bot Commands)

| 指令 | 描述 |
| :--- | :--- |
| `/start` | 查看机器人状态 |
| `/start_album` | **[第一步]** 开始创建一个新图包 |
| `/nav` | 修改当前图包的**分类** |
| `/set_pass <pwd>` | 为当前图包设置访问密码 |
| `/end_album` | **[最后一步]** 发布图包到 Cloudflare KV |
| `/delete <code>` | 从 KV 中删除某个图包 |

**使用流程**:
1.  `/start_album` -> 输入标题。
2.  发送图片、视频或文件（支持多选发送）。
3.  `/end_album` -> 获得发布链接 🎉。

## ⚙️ 自动清理机制 (Auto-Cleanup)
为了在小容量 VPS (如 Leaflow 20GB) 上运行，后端内置了智能清理逻辑：
*   **触发条件**: 硬盘剩余空间 < 5GB。
*   **清理动作**: 按文件修改时间 (mtime) 排序，优先删除**最旧**的文件。
*   **停止条件**: 腾出 2GB 空间或水位恢复。
*   **频率**: 每 1 分钟检查一次。

## 📄 免责声明 (Disclaimer)
本项目仅供技术研究与教育目的使用。请勿用于存储违反 Telegram 服务条款或当地法律法规的内容。使用者需自行承担数据安全与合规责任。

---
*Built with ❤️ by TyrEamon*
