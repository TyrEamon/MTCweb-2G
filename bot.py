import os
import json
import logging
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler,
    MessageHandler, ContextTypes, filters, CallbackQueryHandler
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- 配置区 ---
OWNER_ID = 8040798522
ALLOWED_USERS = set([OWNER_ID])

# 1. 频道设置
CHANNEL_ID = int(os.environ.get("CHANNEL_ID", "0"))          # -100xxxx 形式
CHANNEL_LINK_PREFIX = os.environ.get("CHANNEL_LINK_PREFIX", "")  # 例如 https://t.me/c/3404008241

# 2. 基础配置
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
async def ensure_allowed(update: Update):
    uid = update.effective_user.id
    if uid != OWNER_ID and uid not in ALLOWED_USERS:
        await update.message.reply_text("❌ 无权使用。")
        return False
    return True

def kv_headers():
    return {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "text/plain"}

def kv_base():
    return f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_NAMESPACE_ID}"

def kv_put(key, value):
    return requests.put(
        f"{kv_base()}/values/{key}", headers=kv_headers(), data=value.encode("utf-8")
    ).status_code == 200

def kv_get(key):
    r = requests.get(f"{kv_base()}/values/{key}", headers=kv_headers())
    return r.text if r.status_code == 200 else None

def kv_delete(key):
    return requests.delete(
        f"{kv_base()}/values/{key}", headers=kv_headers()
    ).status_code in (200, 204)

def next_code():
    cur = kv_get(COUNTER_KEY)
    n = int(cur) + 1 if cur else 1
    kv_put(COUNTER_KEY, str(n))
    return f"a0{n}" if n < 10 else f"a{n}"

# --- 核心流程 ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    await update.message.reply_text(
        "📸 **Bot Ready (Channel Mode)**\n"
        "🔹 /start_album - 开始\n"
        "🔹 直接发消息 - 设标题\n"
        "🔹 /nav - 选分类\n"
        "🔹 /set_pass <密码> - 设密码\n"
        "🔹 /end_album - 发布\n"
        "🔸 /delete <代码> - 删除\n"
        "🔸 /allow <id> - 加白名单"
    )

async def start_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    default_cat = CATEGORIES[0] if CATEGORIES else ""
    current_albums[update.effective_user.id] = {
        "title": "未命名图包",
        "category": default_cat,
        "files": [],
        "attachments": [],
        "zip": None,
        "password": None,
    }
    await update.message.reply_text(
        f"🟦 已开始！默认分类：**{default_cat}**\n请直接发送标题。"
    )

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    uid = update.effective_user.id
    text = update.message.text.strip()

    # 1. 删除确认
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

    # 2. 设置标题
    album = current_albums.get(uid)
    if album:
        album["title"] = text
        await update.message.reply_text(
            f"✅ 标题：**{text}**\n(/nav 修改分类，或直接发图)"
        )

async def handle_nav(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    uid = update.effective_user.id
    if uid not in current_albums:
        return await update.message.reply_text("请先 /start_album")

    keyboard = []
    for i in range(0, len(CATEGORIES), 2):
        row = [InlineKeyboardButton(CATEGORIES[i], callback_data=f"cat_{i}")]
        if i + 1 < len(CATEGORIES):
            row.append(
                InlineKeyboardButton(CATEGORIES[i + 1], callback_data=f"cat_{i+1}")
            )
        keyboard.append(row)
    await update.message.reply_text(
        f"👇 当前：{current_albums[uid]['category']}",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

async def handle_cat_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = query.from_user.id
    if uid not in current_albums:
        return await query.edit_message_text("过期")
    current_albums[uid]["category"] = CATEGORIES[int(query.data.split("_")[1])]
    await query.edit_message_text(
        f"✅ 分类：**{current_albums[uid]['category']}**"
    )

async def set_pass(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    uid = update.effective_user.id
    if uid not in current_albums:
        return await update.message.reply_text("未开始")
    try:
        pw = update.message.text.split()[1]
        current_albums[uid]["password"] = pw
        await update.message.reply_text(f"🔒 密码：{pw}")
    except Exception:
        await update.message.reply_text("用法: /set_pass 1234")

async def delete_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    try:
        code = update.message.text.split()[1]
        if not kv_get(code):
            return await update.message.reply_text("不存在")
        pending_deletes[update.effective_user.id] = code
        await update.message.reply_text(f"⚠️ 确认删除 {code}？(回复 yes/no)")
    except Exception:
        await update.message.reply_text("用法: /delete a01")

async def end_album(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    uid = update.effective_user.id
    album = current_albums.get(uid)
    if not album or (not album["files"] and not album["attachments"]):
        return await update.message.reply_text("无数据")

    code = next_code()
    if kv_put(code, json.dumps(album, ensure_ascii=False)):
        del current_albums[uid]
        await update.message.reply_text(
            f"🎉 **发布成功**\n"
            f"Code: `{code}`\n"
            f"Title: {album['title']}\n"
            f"Cat: {album['category']}\n"
            f"{WORKER_BASE_URL}/{code}",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text("❌ 失败")

# --- 核心修改：媒体处理逻辑 ---
async def handle_media(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await ensure_allowed(update):
        return
    uid = update.effective_user.id
    album = current_albums.get(uid)
    if not album:
        return

    msg = update.message

    # 1. 图片，存到 files，作为封面/预览
    if msg.photo:
        album["files"].append(msg.photo[-1].file_id)
        return

    # 2. 视频 或 文件：统一处理
    if msg.video or msg.document:
        if msg.video:
            file_id = msg.video.file_id
            fname = msg.video.file_name or "video.mp4"
            mime = msg.video.mime_type
        else:
            file_id = msg.document.file_id
            fname = msg.document.file_name or "file"
            mime = msg.document.mime_type

        # 如果配置了频道，优先转发到频道拿跳转链接
        if CHANNEL_ID != 0 and CHANNEL_LINK_PREFIX:
            try:
                forwarded = await msg.forward(chat_id=CHANNEL_ID)
                msg_id = forwarded.message_id
                tg_link = f"{CHANNEL_LINK_PREFIX}/{msg_id}"

                info = {"file_name": fname, "tg_link": tg_link, "type": "tg_link"}
                album["attachments"].append(info)

                if (
                    not album["zip"]
                    and fname.lower().endswith((".zip", ".rar", ".7z"))
                ):
                    album["zip"] = info

                await update.message.reply_text(f"✈️ 已存频道：{fname}")
                return
            except Exception as e:
                logger.error(f"Forward error: {e}")
                await update.message.reply_text(
                    f"❌ 转发失败 (请检查 Bot 是否是频道管理员)\n{e}"
                )
                # 转发失败则降级，用 file_id 保存

        # 没配置频道或转发失败：使用 file_id 直连（旧模式）
        info = {"file_id": file_id, "file_name": fname, "mime_type": mime}
        album["attachments"].append(info)
        if not album["zip"] and fname.lower().endswith((".zip", ".rar", ".7z")):
            album["zip"] = info
        await update.message.reply_text(f"📄 已添加 (本地模式): {fname}")

# --- 管理功能 ---
async def allow_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID:
        return
    try:
        ALLOWED_USERS.add(int(update.message.text.split()[1]))
        await update.message.reply_text("✅ Added")
    except Exception:
        pass

async def list_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID:
        return
    await update.message.reply_text(f"Users: {ALLOWED_USERS}")

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
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
    app.add_handler(
        MessageHandler(filters.PHOTO | filters.Document.ALL | filters.VIDEO, handle_media)
    )

    logger.info("Bot running...")
    app.run_polling()

if __name__ == "__main__":
    main()
