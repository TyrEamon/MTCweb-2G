import os
import json
import logging
import requests
import time
import threading
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, AIORateLimiter,
    MessageHandler, ContextTypes, filters, CallbackQueryHandler
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- 配置区 ---
LOCAL_API_URL = os.getenv("LOCAL_API_URL", "http://127.0.0.1:8081/bot") 
LOCAL_FILE_URL = os.getenv("LOCAL_FILE_URL", "http://127.0.0.1:8081/file/bot")
PUBLIC_DOWNLOAD_ROOT = os.getenv("PUBLIC_DOWNLOAD_ROOT", "http://localhost:8081/file")

# ⚠️ 请确保这里填对您的 ID (数字)
OWNER_ID = 8040798522
ALLOWED_USERS = set([OWNER_ID])

CHANNEL_ID = int(os.environ.get("CHANNEL_ID", "0"))
CHANNEL_LINK_PREFIX = os.environ.get("CHANNEL_LINK_PREFIX", "")

BOT_TOKEN = os.environ["BOT_TOKEN"]
CF_ACCOUNT_ID = os.environ["CF_ACCOUNT_ID"]
CF_NAMESPACE_ID = os.environ["CF_NAMESPACE_ID"]
CF_API_TOKEN = os.environ["CF_API_TOKEN"]
WORKER_BASE_URL = os.getenv("WORKER_BASE_URL", "https://example.workers.dev")

DEFAULT_CATS = "Popular Cosplay,Video Cosplay,Explore Categories,Best Cosplayer,Level Cosplay,Top Cosplay"
raw_cats = os.getenv("CATEGORIES", DEFAULT_CATS)
CATEGORIES = [c.strip() for c in raw_cats.split(",") if c.strip()]

current_albums = {}
pending_deletes = {}
COUNTER_KEY = "__counter"

# --- 辅助函数 ---
def kv_headers():
    return {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "text/plain"}

def kv_base():
    return f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_NAMESPACE_ID}"

def kv_put(key, value):
    return requests.put(f"{kv_base()}/values/{key}", headers=kv_headers(), data=value.encode("utf-8")).status_code == 200

def kv_get(key):
    r = requests.get(f"{kv_base()}/values/{key}", headers=kv_headers())
    return r.text if r.status_code == 200 else None

def kv_delete(key):
    return requests.delete(f"{kv_base()}/values/{key}", headers=kv_headers()).status_code in (200, 204)

def next_code():
    cur = kv_get(COUNTER_KEY)
    n = int(cur) + 1 if cur else 1
    kv_put(COUNTER_KEY, str(n))
    return f"a0{n}" if n < 10 else f"a{n}"

async def ensure_allowed(update: Update):
    uid = update.effective_user.id
    if uid != OWNER_ID and uid not in ALLOWED_USERS:
        await update.message.reply_text("❌ 无权使用。")
        return False
    return True

# --- 自动清理线程 ---
CACHE_DIR = "/var/lib/telegram-bot-api"
def cleanup_loop():
    logger.info("Auto-cleanup thread started.")
    while True:
        try:
            if not os.path.exists(CACHE_DIR):
                time.sleep(60)
                continue

            try:
                stat = os.statvfs(CACHE_DIR)
                free_space = stat.f_bavail * stat.f_frsize
            except:
                free_space = 99999999999

            if free_space < 2 * 1024 * 1024 * 1024:
                logger.warning(f"Low disk space. Cleaning up...")
                files = []
                for r, d, f in os.walk(CACHE_DIR):
                    for file in f:
                        fp = os.path.join(r, file)
                        files.append((fp, os.path.getmtime(fp)))
                files.sort(key=lambda x: x[1])

                deleted_size = 0
                for fp, mtime in files:
                    try:
                        sz = os.path.getsize(fp)
                        os.remove(fp)
                        deleted_size += sz
                        if deleted_size > 1 * 1024 * 1024 * 1024:
                            break
                    except: pass
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
        time.sleep(300)

# --- Bot 逻辑 ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    # 修复：使用单行字符串拼接，避免 SyntaxError
    msg = "📸 **Bot Ready (Local API Mode)**\n🔹 /start_album - 开始新图包\n🔹 /nav - 切换分类\n🔹 /end_album - 发布\n🔸 直接发送 图片/视频/文件 即可添加"
    await update.message.reply_text(msg)

async def start_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    default_cat = CATEGORIES[0] if CATEGORIES else ""
    current_albums[update.effective_user.id] = {
        "title": "未命名图包",
        "category": default_cat,
        "files": [],
        "attachments": [],
        "zip": None,
        "password": None,
    }
    # 修复：单行拼接
    msg = f"🟦 已开始！默认分类：**{default_cat}**\n请发送标题。"
    await update.message.reply_text(msg)

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    uid = update.effective_user.id
    text = update.message.text.strip()

    if uid in pending_deletes:
        if text.lower() == "yes":
            code = pending_deletes.pop(uid)
            kv_delete(code)
            await update.message.reply_text(f"🗑 已删除 {code}")
        elif text.lower() == "no":
            pending_deletes.pop(uid)
            await update.message.reply_text("已取消删除")
        else:
            await update.message.reply_text("请回复 yes 或 no")
        return

    album = current_albums.get(uid)
    if album:
        album["title"] = text
        await update.message.reply_text(f"✅ 标题：**{text}**\n(/nav 修改分类，或直接发图)")

async def handle_nav(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    uid = update.effective_user.id
    if uid not in current_albums: return await update.message.reply_text("请先 /start_album")

    keyboard = []
    for i in range(0, len(CATEGORIES), 2):
        row = [InlineKeyboardButton(CATEGORIES[i], callback_data=f"cat_{i}")]
        if i + 1 < len(CATEGORIES):
            row.append(InlineKeyboardButton(CATEGORIES[i + 1], callback_data=f"cat_{i+1}"))
        keyboard.append(row)
    await update.message.reply_text(f"👇 当前：{current_albums[uid]['category']}", reply_markup=InlineKeyboardMarkup(keyboard))

async def handle_cat_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = query.from_user.id
    if uid not in current_albums: return await query.edit_message_text("过期")
    current_albums[uid]["category"] = CATEGORIES[int(query.data.split("_")[1])]
    await query.edit_message_text(f"✅ 分类：**{current_albums[uid]['category']}**")

async def set_pass(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    uid = update.effective_user.id
    if uid not in current_albums: return await update.message.reply_text("未开始")
    try:
        pw = update.message.text.split()[1]
        current_albums[uid]["password"] = pw
        await update.message.reply_text(f"🔒 密码：{pw}")
    except:
        await update.message.reply_text("用法: /set_pass 1234")

async def delete_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    try:
        if len(update.message.text.split()) < 2:
            return await update.message.reply_text("用法: /delete a01")
        code = update.message.text.split()[1]
        if not kv_get(code):
            return await update.message.reply_text("KV中不存在该代码")
        pending_deletes[update.effective_user.id] = code
        await update.message.reply_text(f"⚠️ 确认删除 {code}？(回复 yes/no)")
    except Exception as e:
        logger.error(f"Delete error: {e}")
        await update.message.reply_text("发生错误")

async def end_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    uid = update.effective_user.id
    album = current_albums.get(uid)
    if not album or (not album["files"] and not album["attachments"]):
        return await update.message.reply_text("无数据")

    code = next_code()
    if kv_put(code, json.dumps(album, ensure_ascii=False)):
        del current_albums[uid]
        await update.message.reply_text(
            f"🎉 **发布成功**\nCode: `{code}`\nTitle: {album['title']}\nCat: {album['category']}\n{WORKER_BASE_URL}/{code}",
            parse_mode="Markdown"
        )
    else:
        await update.message.reply_text("❌ 发布失败 (写入KV错误)")

async def allow_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        ALLOWED_USERS.add(int(update.message.text.split()[1]))
        await update.message.reply_text("✅ Added")
    except: pass

async def list_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    await update.message.reply_text(f"Users: {ALLOWED_USERS}")

# --- 核心：文件处理 (Local API) ---
async def handle_media(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update): return
    uid = update.effective_user.id
    album = current_albums.get(uid)
    if not album: return

    msg = update.message

    # 1. 图片
    if msg.photo:
        album["files"].append(msg.photo[-1].file_id)
        return

    # 2. 视频/文件
    if msg.video or msg.document:
        status_msg = await msg.reply_text("⏳ 正在请求 Local API 下载缓存 (大文件请耐心等待)...")

        try:
            if msg.video:
                new_file = await msg.video.get_file() 
                fname = msg.video.file_name or "video.mp4"
                mime = msg.video.mime_type
            else:
                new_file = await msg.document.get_file()
                fname = msg.document.file_name or "file"
                mime = msg.document.mime_type

            direct_url = f"{PUBLIC_DOWNLOAD_ROOT}/bot{BOT_TOKEN}/{new_file.file_path}"

            info = {
                "file_id": new_file.file_id, 
                "file_name": fname, 
                "mime_type": mime,
                "direct_url": direct_url 
            }

            album["attachments"].append(info)
            if not album["zip"] and fname.lower().endswith((".zip", ".rar", ".7z")):
                album["zip"] = info

            await context.bot.edit_message_text(
                chat_id=msg.chat_id,
                message_id=status_msg.message_id,
                text=f"✅ 已缓存！\n直链: {direct_url}"
            )

        except Exception as e:
            logger.error(f"Download error: {e}")
            await context.bot.edit_message_text(
                chat_id=msg.chat_id,
                message_id=status_msg.message_id,
                text=f"❌ 缓存失败: {e}"
            )

def main():
    threading.Thread(target=cleanup_loop, daemon=True).start()
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .base_url(LOCAL_API_URL) 
        .base_file_url(LOCAL_FILE_URL)
        .rate_limiter(AIORateLimiter()) 
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("start_album", start_album))
    app.add_handler(CommandHandler("nav", handle_nav))
    app.add_handler(CommandHandler("set_pass", set_pass))
    app.add_handler(CommandHandler("delete", delete_album))
    app.add_handler(CommandHandler("end_album", end_album))
    app.add_handler(CommandHandler("allow", allow_user))
    app.add_handler(CommandHandler("list_users", list_users))

    app.add_handler(CallbackQueryHandler(handle_cat_cb))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.ALL | filters.VIDEO, handle_media))

    logger.info("Bot running...")
    app.run_polling()

if __name__ == "__main__":
    main()
