// ===========================
// MTCweb Gallery & File Depot (Channel Link Version)
// ===========================

const SITE_TITLE = "MTCweb";
const COUNTER_KEY = "__counter";
const DEFAULT_CATS = "热门 Cosplay,视频专区,软件资源,个人写真";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    const rawCats = env.CATEGORIES || DEFAULT_CATS;
    const categories = rawCats.split(",").map(c => c.trim()).filter(Boolean);

    // 标准化路径
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
    
    // 路由分发
    if (path === "/") return Response.redirect(url.origin + "/list", 302);
    
    // 首页列表
    if (path === "/list") return renderList(env, url, categories);
    
    // 分类页
    if (path.startsWith("/category/")) {
      const catSlug = decodeURIComponent(path.replace("/category/", ""));
      const targetCat = categories.find(c => c.replace(/\s+/g, '-') === catSlug) || catSlug;
      return renderCategoryPage(env, url, categories, targetCat);
    }
    
    // 文件代理 (用于图片预览)
    if (path.startsWith("/file/")) return proxyTelegramFile(env, decodeURIComponent(path.replace("/file/", "")), url);
    
    // 详情页
    const match = path.match(/^\/([a-zA-Z]\d+)$/);
    if (match) return renderAlbum(env, match[1], url);
    
    return new Response("404 Not Found", { status: 404 });
  },
};

// ===========================
// Data Logic
// ===========================
async function getAllAlbums(env) {
  const list = await env.ALBUMS.list();
  const names = list.keys.map(k => k.name).filter(n => n !== COUNTER_KEY);
  const albums = await Promise.all(
    names.map(async code => {
      const data = await env.ALBUMS.get(code, { type: "json" });
      if (!data) return null;
      return {
        code,
        title: data.title || code,
        category: data.category || "", 
        files: data.files || [], 
        attachments: data.attachments || [],
        zip: data.zip || null,
        password: data.password || null
      };
    })
  );
  // 按 Code 倒序（新发布的在前）
  return albums.filter(Boolean).sort((a, b) => b.code.localeCompare(a.code, "en", { numeric: true }));
}

async function proxyTelegramFile(env, fileId, url) {
  const token = env.BOT_TOKEN;
  if (!token) return new Response("Missing BOT_TOKEN", { status: 500 });
  try {
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const meta = await metaRes.json();
    if (!meta.ok || !meta.result?.file_path) return new Response("Invalid file metadata", { status: 502 });
    
    const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    
    const headers = new Headers(fileRes.headers);
    headers.set("cache-control", "public, max-age=31536000");
    
    const downloadName = url.searchParams.get("download");
    if (downloadName) headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    
    return new Response(fileRes.body, { status: 200, headers });
  } catch (e) { return new Response("Proxy error", { status: 500 }); }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getCoverHtml(url, album) {
  // 1. 优先使用第一张图片作为封面
  if (album.files && album.files.length > 0) {
    const src = `${url.origin}/file/${encodeURIComponent(album.files[0])}`;
    return `<img src="${src}" alt="${escapeHtml(album.title)}" loading="lazy">`;
  }
  
  // 2. 如果没有图片，根据附件类型生成图标封面
  let icon = "📁"; // 默认文件夹图标
  let typeText = "FILE";
  
  if (album.attachments && album.attachments.length > 0) {
    const firstFile = album.attachments[0];
    const fname = (firstFile.file_name || "").toLowerCase();
    
    if (fname.endsWith(".apk")) { icon = "🤖"; typeText = "APK"; }
    else if (fname.endsWith(".exe")) { icon = "🪟"; typeText = "EXE"; }
    else if (fname.endsWith(".txt")) { icon = "📄"; typeText = "TXT"; }
    else if (fname.endsWith(".mp4") || fname.endsWith(".mov")) { icon = "🎬"; typeText = "VIDEO"; }
    else if (fname.endsWith(".zip") || fname.endsWith(".rar") || fname.endsWith(".7z")) { icon = "📦"; typeText = "ZIP"; }
    else if (fname.endsWith(".pdf")) { icon = "📕"; typeText = "PDF"; }
  }

  return `
    <div style="width:100%;height:100%;background:#334155;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#94a3b8;">
      <div style="font-size:48px;margin-bottom:10px;">${icon}</div>
      <div style="font-size:14px;font-weight:bold;opacity:0.7;">${typeText}</div>
    </div>
  `;
}

// ===========================
// Templates (HTML/CSS)
// ===========================
function getHeadStyle(title) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${title}</title>
<link rel="icon" href="https://link.tyrlink.dpdns.org/mtc.png" type="image/png">
<style>
:root { --bg-color: #020617; --header-bg: #0f172a; --card-bg: #1e293b; --text-primary: #f8fafc; --text-secondary: #94a3b8; --accent: #e11d48; --border: #334155; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg-color); color: var(--text-primary); font-family: -apple-system, sans-serif; padding-bottom: 60px; }
a { text-decoration: none; color: inherit; -webkit-tap-highlight-color: transparent; }
ul { list-style: none; padding: 0; margin: 0; }
.header { position: sticky; top: 0; z-index: 50; background: var(--header-bg); border-bottom: 1px solid var(--border); padding: 0 16px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 16px; }
.menu-btn { font-size: 24px; cursor: pointer; color: var(--text-primary); background: none; border: none; padding: 0; }
.logo { font-weight: 800; font-size: 20px; } .logo span { color: var(--accent); }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 250px; background: var(--header-bg); z-index: 100; transform: translateX(-100%); transition: transform 0.3s; padding: 20px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.drawer-open .drawer { transform: translateX(0); } .drawer-open .overlay { opacity: 1; pointer-events: auto; }
.drawer-title { font-size: 18px; font-weight: bold; margin-bottom: 24px; color: var(--accent); }
.drawer-item { padding: 12px 0; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 15px; cursor: pointer; }
.drawer-item a { display: block; width: 100%; height: 100%; }
.main-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 16px; }
@media (min-width: 768px) { .main-grid { grid-template-columns: repeat(4, 1fr); gap: 20px; } }
.card { background: var(--card-bg); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.card-thumb { aspect-ratio: 3/4; background: #334155; overflow: hidden; position: relative; }
.card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.card-title { padding: 10px; font-size: 13px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hidden { display: none !important; }
.section { padding: 16px 0 24px 0; border-top: 1px solid #1e293b; }
.section-title { display: flex; align-items: center; gap: 8px; padding: 0 16px; margin: 0 0 16px 0; font-size: 15px; font-weight: 700; color: #64748b; text-transform: uppercase; }
.section-header-link { display: flex; justify-content: space-between; align-items: center; text-decoration: none; color: inherit; }
.section-more { font-size: 12px; color: var(--accent); margin-right: 16px; }
.row-scroll-wrapper { width: 100%; overflow: hidden; position: relative; }
.row-scroll { display: flex; overflow-x: auto; padding: 0 16px; gap: 12px; scrollbar-width: none; -ms-overflow-style: none; cursor: grab; }
.row-scroll::-webkit-scrollbar { display: none; }
.row-card { flex: 0 0 180px; height: 110px; border-radius: 12px; overflow: hidden; position: relative; background: #334155; user-select: none; -webkit-user-drag: none; }
.row-card img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.title-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.7); color: white; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; font-size: 12px; font-weight: bold; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.row-card:active .title-overlay, .row-card:hover .title-overlay { opacity: 1; }
.page-title { padding: 20px 16px 0; font-size: 24px; font-weight: bold; color: var(--text-primary); }
.topbar{position:sticky;top:0;padding:12px;background:#0f172a;display:flex;justify-content:space-between;border-bottom:1px solid #1e293b;z-index:50}
.main{max-width:900px;margin:auto;padding:16px}
.img-box{margin-bottom:12px;border-radius:12px;overflow:hidden}.img-box img{width:100%}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;justify-content:center;align-items:center;z-index:999}.lightbox img{max-width:100%}
.att-link{display:flex;align-items:center;padding:12px 16px;background:#334155;margin-bottom:8px;border-radius:8px;color:#f8fafc;font-weight:500;transition:background 0.2s}
.att-link:hover{background:#475569}
.att-icon{margin-right:10px;font-size:18px}
.zip-btn{display:inline-flex;align-items:center;padding:10px 20px;background:#e11d48;color:white;border-radius:99px;margin:10px 0;font-weight:bold;transition:opacity 0.2s}
.zip-btn:hover{opacity:0.9}

/* --- 新增：底部导航栏样式 --- */
.bottom-nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; }
.nav-btn { flex: 1; display: flex; flex-direction: column; padding: 12px; background: #1e293b; border-radius: 8px; text-decoration: none; color: var(--text-secondary); transition: background 0.2s; min-width: 0; }
.nav-btn:hover { background: #334155; }
.nav-btn.next { text-align: right; align-items: flex-end; }
.nav-btn.prev { text-align: left; align-items: flex-start; }
.nav-label { font-size: 12px; font-weight: bold; color: var(--accent); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.nav-name { font-size: 14px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
</style>
</head>
<body>
`;
}


function getDrawer(categories) {
  const navItemsHtml = categories.map(item => 
    `<li class="drawer-item"><a href="/category/${escapeHtml(item.replace(/\s+/g, '-'))}">${escapeHtml(item)}</a></li>`
  ).join("");
  return `
    <div class="overlay" id="overlay"></div>
    <aside class="drawer" id="drawer">
      <div class="drawer-title">MTCweb</div>
      <ul>
        <li class="drawer-item"><a href="/list" style="color: #e11d48; font-weight:bold;">🏠 首页</a></li>
        ${navItemsHtml}
      </ul>
    </aside>
  `;
}

function getScripts() {
  return `
<script>
const menuBtn = document.getElementById("menuBtn"), drawer = document.getElementById("drawer"), overlay = document.getElementById("overlay"), body = document.body;
function toggleDrawer() { body.classList.toggle("drawer-open"); }
if(menuBtn) { menuBtn.onclick = toggleDrawer; overlay.onclick = toggleDrawer; }

const searchInput = document.getElementById("searchInput");
if(searchInput) {
    const cards = document.querySelectorAll(".card");
    searchInput.addEventListener("input", (e) => { 
        const term = e.target.value.toLowerCase(); 
        cards.forEach(card => card.classList.toggle("hidden", !card.getAttribute("data-title").includes(term))); 
    });
}

(function() {
  function initInfiniteScroll(row) {
    const speed = 0.5; let isPaused = false; let pauseTimer = null; let animationId = null;
    const children = [...row.children]; children.forEach(node => row.appendChild(node.cloneNode(true)));
    function loop() {
      if (!isPaused) { row.scrollLeft += speed; if (row.scrollLeft >= row.scrollWidth / 2) row.scrollLeft = 0; }
      animationId = requestAnimationFrame(loop);
    }
    function pause() { isPaused = true; if (pauseTimer) clearTimeout(pauseTimer); }
    function resume() { pauseTimer = setTimeout(() => { isPaused = false; }, 1000); }
    row.addEventListener("touchstart", pause, { passive: true }); row.addEventListener("mousedown", pause);
    row.addEventListener("touchend", resume); row.addEventListener("mouseup", resume); row.addEventListener("mouseleave", resume);
    let lastScrollLeft = row.scrollLeft;
    row.addEventListener("scroll", () => { if (Math.abs(row.scrollLeft - lastScrollLeft) > 2) { pause(); resume(); } lastScrollLeft = row.scrollLeft; }, { passive: true });
    animationId = requestAnimationFrame(loop);
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".auto-scroll").forEach(row => { if (row.scrollWidth > row.clientWidth) initInfiniteScroll(row); });
  });
})();
</script></body></html>`;
}

function generateCardHtml(url, album) {
  const safeTitle = escapeHtml(album.title);
  const coverHtml = getCoverHtml(url, album);
  return `
    <a class="card" href="/${album.code}" data-title="${safeTitle.toLowerCase()}">
      <div class="card-thumb">${coverHtml}</div>
      <div class="card-title">${safeTitle}</div>
    </a>`;
}

function generateRowCardHtml(url, album) {
  const safeTitle = escapeHtml(album.title);
  const coverHtml = getCoverHtml(url, album);
  return `
    <a class="row-card" href="/${album.code}">
      ${coverHtml}
      <div class="title-overlay">${safeTitle}</div>
    </a>`;
}

// ===========================
// Render Pages
// ===========================

// 每页 20 条
const PAGE_SIZE = 20;

// 通用分页组件：生成 < 1 2 3 ... 54 >
function renderPagination(current, totalPages, basePath) {
  if (totalPages <= 1) return "";
  let parts = [];

  const pageLink = (p, label = null, disabled = false, active = false) => {
    const text = label || p;
    if (disabled) {
      parts.push(`<span style="min-width:32px;height:32px;border-radius:999px;border:1px solid #374151;display:flex;align-items:center;justify-content:center;font-size:13px;color:#4b5563;margin:0 3px;">${text}</span>`);
    } else {
      const activeStyle = active ? "background:#334155;color:#f9fafb;border-color:#4b5563;" : "";
      parts.push(
        `<a href="${basePath}?page=${p}" style="min-width:32px;height:32px;border-radius:999px;border:1px solid #4b5563;display:flex;align-items:center;justify-content:center;font-size:13px;color:#9ca3af;margin:0 3px;text-decoration:none;${activeStyle}">${text}</a>`
      );
    }
  };

  // 上一页
  pageLink(Math.max(1, current - 1), "‹", current === 1, false);

  // 页码主体
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pageLink(i, null, false, i === current);
    }
  } else {
    pageLink(1, null, false, current === 1);

    if (current > 3) {
      parts.push(`<span style="color:#6b7280;margin:0 4px;">...</span>`);
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(totalPages - 1, current + 1);
    for (let i = start; i <= end; i++) {
      pageLink(i, null, false, i === current);
    }

    if (current < totalPages - 2) {
      parts.push(`<span style="color:#6b7280;margin:0 4px;">...</span>`);
    }

    pageLink(totalPages, null, false, current === totalPages);
  }

  // 下一页
  pageLink(Math.min(totalPages, current + 1), "›", current === totalPages, false);

  return `
    <div style="display:flex;justify-content:center;margin:24px 0 32px;">
      ${parts.join("")}
    </div>
  `;
}

// ===========================
// /list 首页带分页
// ===========================
async function renderList(env, url, categories) {
  const albums = await getAllAlbums(env);          // 所有图包，按 code 已经倒序
  const total = albums.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const currentPage = Math.min(
    totalPages,
    Math.max(1, parseInt(url.searchParams.get("page") || "1", 10))
  );

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = albums.slice(startIndex, startIndex + PAGE_SIZE);

  const gridCards = pageItems.map(album => generateCardHtml(url, album)).join("");

  // 顶部分类横排区域依然保留（用滑动缩略图），可按需保留或删除
  const sectionHtml = categories.map((cat) => {
    const slice = albums.filter(a => a.category === cat);
    if (slice.length === 0) return "";
    const displaySlice = slice.slice(0, 10);
    const rowCards = displaySlice.map(album => generateRowCardHtml(url, album)).join("");
    const catSlug = escapeHtml(cat.replace(/\s+/g, '-'));
    return `<section class="section"><a href="/category/${catSlug}" class="section-header-link"><h2 class="section-title"><span class="section-icon">▶</span> ${escapeHtml(cat.toUpperCase())}</h2><span class="section-more">View All ➡</span></a><div class="row-scroll-wrapper"><div class="row-scroll auto-scroll">${rowCards}</div></div></section>`;
  }).join("");

  const paginationHtml = renderPagination(currentPage, totalPages, "/list");

  const html = `
    ${getHeadStyle(SITE_TITLE)}
    ${getDrawer(categories)}
    <header class="header">
      <div class="header-left">
        <button class="menu-btn" id="menuBtn">☰</button>
        <div class="logo"><span>M</span>TCweb</div>
      </div>
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" id="searchInput" placeholder="Search...">
      </div>
    </header>
    <main>
      <div class="main-grid" id="mainGrid">${gridCards}</div>
      ${paginationHtml}
      ${sectionHtml}
    </main>
    ${getScripts()}
  `;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}


// ===========================
// 分类页带分页：/category/xxx?page=2
// ===========================
async function renderCategoryPage(env, url, categories, currentCat) {
  const albums = await getAllAlbums(env);
  const filtered = albums.filter(a => a.category === currentCat);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const currentPage = Math.min(
    totalPages,
    Math.max(1, parseInt(url.searchParams.get("page") || "1", 10))
  );

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  const gridCards = pageItems.length > 0
    ? pageItems.map(album => generateCardHtml(url, album)).join("")
    : `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#888;">No albums found.</div>`;

  const paginationHtml = renderPagination(
    currentPage,
    totalPages,
    `/category/${encodeURIComponent(currentCat.replace(/\s+/g, '-'))}`
  );

  const html = `
    ${getHeadStyle(`${currentCat} - ${SITE_TITLE}`)}
    ${getDrawer(categories)}
    <header class="header">
      <div class="header-left">
        <button class="menu-btn" id="menuBtn">☰</button>
        <div class="logo"><span>M</span>TCweb</div>
      </div>
    </header>
    <main>
      <h1 class="page-title">${escapeHtml(currentCat)}</h1>
      <div class="main-grid" id="mainGrid">${gridCards}</div>
      ${paginationHtml}
    </main>
    ${getScripts()}
  `;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}


async function renderAlbum(env, code, url) {
  const data = await env.ALBUMS.get(code, { type: "json" });
  if (!data) return new Response("<h1>404 Not Found</h1>", { status: 404 });
  
  // 1. 获取所有图包列表
  const list = await env.ALBUMS.list();
  const names = list.keys.map(k => k.name).filter(n => n !== COUNTER_KEY).sort((a,b)=>a.localeCompare(b,"en",{numeric:true}));
  const idx = names.indexOf(code);
  const prevCode = idx > 0 ? names[idx - 1] : null;
  const nextCode = idx < names.length - 1 ? names[idx + 1] : null;

  // 2. 额外读取上一篇和下一篇的【标题】
  let prevTitle = "", nextTitle = "";
  if (prevCode) {
      const p = await env.ALBUMS.get(prevCode, { type: "json" });
      prevTitle = p ? (p.title || prevCode) : prevCode;
  }
  if (nextCode) {
      const n = await env.ALBUMS.get(nextCode, { type: "json" });
      nextTitle = n ? (n.title || nextCode) : nextCode;
  }

  const title = escapeHtml(data.title || code);
  const pw = data.password ? `<script>const k="pw_${code}";if(localStorage.getItem(k)!=="${data.password}"){const u=prompt("Pass:");if(u!=="${data.password}"){location.href="/list";}else{localStorage.setItem(k,u);}}</script>` : "";

  // 渲染图片
  const imgs = data.files.map(fid => 
    `<div class="img-box"><img src="${url.origin}/file/${encodeURIComponent(fid)}" onclick="openLightbox(this.src)" loading="lazy"></div>`
  ).join("");

  // 渲染附件
  const atts = data.attachments.map(att => {
      const link = att.tg_link || `${url.origin}/file/${att.file_id}?download=${encodeURIComponent(att.file_name)}`;
      const target = att.tg_link ? 'target="_blank"' : '';
      const icon = att.tg_link ? '✈️' : '📄';
      const text = att.tg_link ? `Open in Telegram: ${escapeHtml(att.file_name)}` : escapeHtml(att.file_name);
      return `<li><a href="${link}" ${target} class="att-link"><span class="att-icon">${icon}</span>${text}</a></li>`;
  }).join("");

  // ZIP 按钮
  let zipHtml = "";
  if (data.zip) {
      const link = data.zip.tg_link || `${url.origin}/file/${data.zip.file_id}?download=${encodeURIComponent(data.zip.file_name)}`;
      const target = data.zip.tg_link ? 'target="_blank"' : '';
      const text = data.zip.tg_link ? '📦 Get Zip in Telegram' : '📦 Download Zip';
      zipHtml = `<a class="zip-btn" href="${link}" ${target}>${text}</a>`;
  }

  // --- 生成底部导航栏 HTML ---
  const navHtml = `
  <div class="bottom-nav">
     ${prevCode ? `
     <a href="/${prevCode}" class="nav-btn prev">
        <span class="nav-label">« PREV</span>
        <span class="nav-name">${escapeHtml(prevTitle)}</span>
     </a>` : `<div></div>`}
     
     ${nextCode ? `
     <a href="/${nextCode}" class="nav-btn next">
        <span class="nav-label">NEXT »</span>
        <span class="nav-name">${escapeHtml(nextTitle)}</span>
     </a>` : `<div></div>`}
  </div>`;
  
  const html = `
    ${getHeadStyle(title)}
    <body>${pw}
    <header class="topbar"><div>MTCweb</div><a href="/list" style="font-weight:bold;">Back</a></header>
    <main class="main">
        <h1 style="margin-bottom:10px;">${title}</h1>
        <!-- 顶部只保留简易导航 -->
        <div style="margin-bottom:20px;font-size:14px;color:#94a3b8;">
             <a href="/category/${escapeHtml((data.category||"").replace(/\s+/g, '-'))}"># ${escapeHtml(data.category||"Uncategorized")}</a>
        </div>
        
        ${zipHtml}
        
        ${imgs}
        
        ${atts ? `<div style="margin-top:30px;padding:16px;border:1px solid #334155;border-radius:12px;background:#0f172a;">
            <h3 style="margin-top:0;color:#e11d48;">Resources & Downloads</h3>
            <ul style="padding:0;margin:0;">${atts}</ul>
        </div>` : ""}

        <!-- 这里插入底部导航 -->
        ${navHtml}

    </main>
    
    <div class="lightbox" id="lb" onclick="this.style.display='none'">
        <img id="lbImg">
    </div>
    <script>function openLightbox(s){document.getElementById('lbImg').src=s;document.getElementById('lb').style.display='flex'}</script>
    </body></html>`;
    
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
