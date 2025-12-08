// ===========================
// MTCweb Gallery Ultimate (Old Style + Video + Search)
// ===========================

const SITE_TITLE = "MTCweb";
// 你可以在这里填入你的 LOGO URL，如果留空则显示文字
const SITE_LOGO = "https://link.tyrlink.dpdns.org/mtc.png"; 
const COUNTER_KEY = "__counter";
const DEFAULT_CATS = "热门 Cosplay,视频专区,软件资源,个人写真";
const PAGE_SIZE = 20;

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
    
    // 首页列表 & 搜索 & 分类
    if (path === "/list" || path.startsWith("/category/")) {
      return renderListHandler(request, env, url, categories, path);
    }
    
    // 文件代理 (用于图片预览/视频播放)
    if (path.startsWith("/file/")) {
        const range = request.headers.get("Range");
        return proxyTelegramFile(env, decodeURIComponent(path.replace("/file/", "")), url, range);
    }
    
    // 详情页
    const match = path.match(/^\/([a-zA-Z]\d+)$/);
    if (match) return renderAlbum(env, match[1], url, categories);
    
    return new Response("404 Not Found", { status: 404 });
  },
};

// ===========================
// Logic Handlers
// ===========================

async function renderListHandler(request, env, url, categories, path) {
    const params = url.searchParams;
    const page = parseInt(params.get("page")) || 1;
    const query = (params.get("q") || "").toLowerCase();
    
    let targetCat = null;
    if (path.startsWith("/category/")) {
      const catSlug = decodeURIComponent(path.replace("/category/", ""));
      targetCat = categories.find(c => c.replace(/\s+/g, '-') === catSlug) || catSlug;
    }

    let albums = await getAllAlbums(env);
    
    // 1. 筛选分类
    if (targetCat) {
        albums = albums.filter(a => a.category === targetCat);
    }
    // 2. 搜索过滤
    if (query) {
        albums = albums.filter(a => a.title.toLowerCase().includes(query) || a.code.toLowerCase().includes(query));
    }

    const total = albums.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = albums.slice(start, start + PAGE_SIZE);

    return renderListPage(env, { 
        albums: pageItems, 
        allAlbums: albums, 
        categories, 
        currentCat: targetCat, 
        currentPage: page, 
        totalPages, 
        query, 
        url 
    });
}

async function renderAlbum(env, code, url, categories) {
  const data = await env.ALBUMS.get(code, { type: "json" });
  if (!data) return new Response("<h1>404 Not Found</h1>", { status: 404, headers: {"Content-Type": "text/html"} });
  
  const list = await env.ALBUMS.list();
  const names = list.keys.map(k => k.name).filter(n => n !== COUNTER_KEY).sort((a,b)=>b.localeCompare(a,"en",{numeric:true}));
  const idx = names.indexOf(code);
  const nextCode = idx > 0 ? names[idx - 1] : null; 
  const prevCode = idx < names.length - 1 ? names[idx + 1] : null;

  let prevTitle = prevCode, nextTitle = nextCode;
  
  const title = escapeHtml(data.title || code);
  const pw = data.password ? `<script>const k="pw_${code}";if(localStorage.getItem(k)!=="${data.password}"){const u=prompt("Pass:");if(u!=="${data.password}"){location.href="/list";}else{localStorage.setItem(k,u);}}</script>` : "";

  // 渲染图片
  const imgs = (data.files||[]).map(fid => 
    `<div class="img-box"><img src="${url.origin}/file/${encodeURIComponent(fid)}" onclick="openLightbox(this.src)" loading="lazy"></div>`
  ).join("");

  // 渲染附件 & 视频
  let atts = "";
  if (data.attachments && data.attachments.length > 0) {
      atts = data.attachments.map(att => {
          const fname = att.file_name || "";
          const isVideo = fname.toLowerCase().match(/\.(mp4|mov|webm|mkv)$/);
          const fileUrl = att.tg_link || `${url.origin}/file/${att.file_id}?download=${encodeURIComponent(fname)}`;
          
          if (isVideo && !att.tg_link) {
             const src = `${url.origin}/file/${att.file_id}`;
             return `
             <div class="video-card">
                <div class="video-title">🎬 ${escapeHtml(fname)}</div>
                <video controls preload="metadata" width="100%" poster="">
                    <source src="${src}" type="video/mp4">
                    Your browser does not support video.
                </video>
                <div style="margin-top:8px;font-size:12px;"><a href="${fileUrl}" style="color:#e11d48;">⬇️ Download Video</a></div>
             </div>`;
          } else {
             const icon = att.tg_link ? '✈️' : '📄';
             const text = att.tg_link ? `Open in Telegram: ${escapeHtml(fname)}` : escapeHtml(fname);
             return `<li><a href="${fileUrl}" target="${att.tg_link?'_blank':''}" class="att-link"><span class="att-icon">${icon}</span>${text}</a></li>`;
          }
      }).join("");
  }

  // ZIP 按钮
  let zipHtml = "";
  if (data.zip) {
      const link = data.zip.tg_link || `${url.origin}/file/${data.zip.file_id}?download=${encodeURIComponent(data.zip.file_name)}`;
      zipHtml = `<a class="zip-btn" href="${link}" ${data.zip.tg_link?'target="_blank"':''}>📦 Download ZIP</a>`;
  }

  const navHtml = `
  <div class="bottom-nav">
     ${prevCode ? `<a href="/${prevCode}" class="nav-btn prev"><span class="nav-label">« OLDER</span><span class="nav-name">${prevTitle}</span></a>` : `<div></div>`}
     ${nextCode ? `<a href="/${nextCode}" class="nav-btn next"><span class="nav-label">NEWER »</span><span class="nav-name">${nextTitle}</span></a>` : `<div></div>`}
  </div>`;
  
  const html = `
    ${getHeadStyle(title)}
    <body>${pw}
    <header class="topbar">
        <div class="logo">MTCweb</div>
        <a href="/list" style="font-weight:bold;color:#f8fafc;">Back</a>
    </header>
    <main class="main">
        <h1 style="margin-bottom:10px;">${title}</h1>
        <div style="margin-bottom:20px;font-size:14px;color:#94a3b8;">
             <a href="/category/${escapeHtml((data.category||"").replace(/\s+/g, '-'))}"># ${escapeHtml(data.category||"Uncategorized")}</a>
        </div>
        ${zipHtml}
        ${atts ? `<div class="res-box">${atts}</div>` : ""}
        ${imgs}
        ${navHtml}
    </main>
    <div class="lightbox" id="lb" onclick="this.style.display='none'"><img id="lbImg"></div>
    <script>function openLightbox(s){document.getElementById('lbImg').src=s;document.getElementById('lb').style.display='flex'}</script>
    </body></html>`;
    
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ===========================
// Data & Proxy Logic
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
      };
    })
  );
  return albums.filter(Boolean).sort((a, b) => b.code.localeCompare(a.code, "en", { numeric: true }));
}

async function proxyTelegramFile(env, fileId, url, rangeHeader) {
  const token = env.BOT_TOKEN;
  try {
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const meta = await metaRes.json();
    if (!meta.ok || !meta.result?.file_path) return new Response("Invalid file metadata", { status: 502 });
    
    const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
    
    const headers = new Headers();
    if (rangeHeader) headers.set("Range", rangeHeader);
    
    const fileRes = await fetch(fileUrl, { headers });
    
    const resHeaders = new Headers(fileRes.headers);
    resHeaders.set("cache-control", "public, max-age=31536000");
    resHeaders.set("Access-Control-Allow-Origin", "*");
    
    const downloadName = url.searchParams.get("download");
    if (downloadName) resHeaders.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    
    return new Response(fileRes.body, { status: fileRes.status, headers: resHeaders });
  } catch (e) { return new Response("Proxy error", { status: 500 }); }
}

// ===========================
// Render Helpers
// ===========================

function renderListPage(env, { albums, allAlbums, categories, currentCat, currentPage, totalPages, query, url }) {
  const gridCards = albums.map(album => generateCardHtml(url, album)).join("");

  // 生成横向滚动推荐栏
  let sectionHtml = "";
  if (!query && !currentCat && currentPage === 1) {
      sectionHtml = categories.map((cat) => {
        const slice = allAlbums.filter(a => a.category === cat);
        if (slice.length === 0) return "";
        const displaySlice = slice.slice(0, 10);
        const rowCards = displaySlice.map(album => generateRowCardHtml(url, album)).join("");
        const catSlug = escapeHtml(cat.replace(/\s+/g, '-'));
        return `<section class="section"><a href="/category/${catSlug}" class="section-header-link"><h2 class="section-title"><span class="section-icon">▶</span> ${escapeHtml(cat.toUpperCase())}</h2><span class="section-more">View All ➡</span></a><div class="row-scroll-wrapper"><div class="row-scroll auto-scroll">${rowCards}</div></div></section>`;
      }).join("");
  }

  const paginationHtml = renderPagination(currentPage, totalPages, currentCat ? `/category/${currentCat.replace(/\s+/g, '-')}` : "/list", query);

  const html = `
    ${getHeadStyle(currentCat || SITE_TITLE)}
    ${getDrawer(categories)}
    <header class="header">
      <div class="header-left">
        <button class="menu-btn" id="menuBtn">☰</button>
        <div class="logo">
           ${SITE_LOGO ? `<img src="${SITE_LOGO}" style="height:24px;vertical-align:middle;margin-right:8px;">` : `<span>M</span>TCweb`}
        </div>
      </div>
      <form action="/list" method="GET" class="search-box-form">
        <span class="search-icon">🔍</span>
        <input type="text" name="q" class="search-input" placeholder="Search..." value="${escapeHtml(query)}">
      </form>
    </header>
    <main>
      ${query ? `<h2 class="page-title">Search: "${escapeHtml(query)}"</h2>` : (currentCat ? `<h1 class="page-title">${escapeHtml(currentCat)}</h1>` : "")}
      
      <!-- 1. 主列表 -->
      <div class="main-grid" id="mainGrid">${gridCards}</div>
      
      <!-- 2. 分页器 -->
      ${paginationHtml}

      <!-- 3. 横向推荐栏 (现在移动到了最底部) -->
      ${sectionHtml}
    </main>
    ${getScripts()}
  `;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function getHeadStyle(title) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${title}</title>
<style>
:root { --bg-color: #020617; --header-bg: #0f172a; --card-bg: #1e293b; --text-primary: #f8fafc; --text-secondary: #94a3b8; --accent: #e11d48; --border: #334155; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg-color); color: var(--text-primary); font-family: -apple-system, sans-serif; padding-bottom: 60px; }
a { text-decoration: none; color: inherit; -webkit-tap-highlight-color: transparent; }
ul { list-style: none; padding: 0; margin: 0; }
.header { position: sticky; top: 0; z-index: 50; background: var(--header-bg); border-bottom: 1px solid var(--border); padding: 0 16px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 16px; }
.menu-btn { font-size: 24px; cursor: pointer; color: var(--text-primary); background: none; border: none; padding: 0; }
.logo { font-weight: 800; font-size: 20px; display:flex; align-items:center; } .logo span { color: var(--accent); }
.search-box-form { position: relative; display: flex; align-items: center; background: #1e293b; border-radius: 99px; padding: 4px 12px; border: 1px solid #334155; }
.search-input { background: transparent; border: none; color: white; font-size: 14px; width: 100px; outline: none; transition: width 0.3s; }
.search-input:focus { width: 160px; }
.search-icon { font-size: 12px; margin-right: 6px; opacity: 0.6; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 250px; background: var(--header-bg); z-index: 100; transform: translateX(-100%); transition: transform 0.3s; padding: 20px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.drawer-open .drawer { transform: translateX(0); } .drawer-open .overlay { opacity: 1; pointer-events: auto; }
.drawer-title { font-size: 18px; font-weight: bold; margin-bottom: 24px; color: var(--accent); }
.drawer-item { padding: 12px 0; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 15px; cursor: pointer; }

.main-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 16px; }
@media (min-width: 768px) { .main-grid { grid-template-columns: repeat(4, 1fr); gap: 20px; } }
.card { background: var(--card-bg); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.card-thumb { aspect-ratio: 3/4; background: #334155; overflow: hidden; position: relative; }
.card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.card-title { padding: 10px; font-size: 13px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.section { padding: 16px 0 24px 0; border-top: 1px solid #1e293b; }
.section-title { display: flex; align-items: center; gap: 8px; padding: 0 16px; margin: 0 0 16px 0; font-size: 15px; font-weight: 700; color: #64748b; text-transform: uppercase; }
.section-header-link { display: flex; justify-content: space-between; align-items: center; text-decoration: none; color: inherit; }
.section-more { font-size: 12px; color: var(--accent); margin-right: 16px; }
.row-scroll-wrapper { width: 100%; overflow: hidden; position: relative; }
.row-scroll { display: flex; overflow-x: auto; padding: 0 16px; gap: 12px; scrollbar-width: none; -ms-overflow-style: none; cursor: grab; }
.row-scroll::-webkit-scrollbar { display: none; }
.row-card { flex: 0 0 180px; height: 110px; border-radius: 12px; overflow: hidden; position: relative; background: #334155; user-select: none; }
.row-card img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.title-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.7); color: white; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; font-size: 12px; font-weight: bold; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.row-card:hover .title-overlay { opacity: 1; }

.page-title { padding: 20px 16px 0; font-size: 24px; font-weight: bold; color: var(--text-primary); }
.topbar{position:sticky;top:0;padding:12px;background:#0f172a;display:flex;justify-content:space-between;border-bottom:1px solid #1e293b;z-index:50}
.main{max-width:900px;margin:auto;padding:16px}
.img-box{margin-bottom:12px;border-radius:12px;overflow:hidden;cursor:zoom-in;}.img-box img{width:100%}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;justify-content:center;align-items:center;z-index:999}.lightbox img{max-width:100%;max-height:100%;}
.res-box { margin-top:30px;padding:16px;border:1px solid #334155;border-radius:12px;background:#0f172a; }
.att-link{display:flex;align-items:center;padding:12px 16px;background:#334155;margin-bottom:8px;border-radius:8px;color:#f8fafc;font-weight:500;transition:background 0.2s}
.att-link:hover{background:#475569}
.zip-btn{display:inline-flex;align-items:center;padding:10px 20px;background:#e11d48;color:white;border-radius:99px;margin:10px 0;font-weight:bold;transition:opacity 0.2s}
.zip-btn:hover{opacity:0.9}
.video-card { background:#020617; border:1px solid #334155; border-radius:12px; padding:12px; margin-bottom:12px; }
.video-title { margin-bottom:8px; font-size:14px; color:#94a3b8; font-weight:bold; }

.bottom-nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; }
.nav-btn { flex: 1; display: flex; flex-direction: column; padding: 12px; background: #1e293b; border-radius: 8px; text-decoration: none; color: var(--text-secondary); transition: background 0.2s; min-width: 0; }
.nav-btn:hover { background: #334155; }
.nav-btn.next { text-align: right; align-items: flex-end; }
.nav-btn.prev { text-align: left; align-items: flex-start; }
.nav-label { font-size: 12px; font-weight: bold; color: var(--accent); margin-bottom: 4px; text-transform: uppercase; }
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

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getCoverHtml(url, album) {
  if (album.files && album.files.length > 0) {
    const src = `${url.origin}/file/${encodeURIComponent(album.files[0])}`;
    return `<img src="${src}" alt="${escapeHtml(album.title)}" loading="lazy">`;
  }
  let icon = "📁";
  if (album.attachments && album.attachments.length > 0) {
    const fname = (album.attachments[0].file_name || "").toLowerCase();
    if (fname.endsWith(".apk")) icon = "🤖";
    else if (fname.endsWith(".exe")) icon = "🪟";
    else if (fname.endsWith(".mp4") || fname.endsWith(".mov")) icon = "🎬";
    else if (fname.endsWith(".zip") || fname.endsWith(".rar")) icon = "📦";
  }
  return `<div style="width:100%;height:100%;background:#334155;display:flex;justify-content:center;align-items:center;font-size:48px;">${icon}</div>`;
}

function generateCardHtml(url, album) {
  const safeTitle = escapeHtml(album.title);
  return `
    <a class="card" href="/${album.code}">
      <div class="card-thumb">${getCoverHtml(url, album)}</div>
      <div class="card-title">${safeTitle}</div>
    </a>`;
}

function generateRowCardHtml(url, album) {
  const safeTitle = escapeHtml(album.title);
  return `
    <a class="row-card" href="/${album.code}">
      ${getCoverHtml(url, album)}
      <div class="title-overlay">${safeTitle}</div>
    </a>`;
}

function renderPagination(current, totalPages, basePath, query) {
  if (totalPages <= 1) return "";
  let parts = [];
  const buildUrl = (p) => {
      const char = basePath.includes("?") ? "&" : "?";
      return query ? `/list?q=${encodeURIComponent(query)}&page=${p}` : `${basePath}${char}page=${p}`;
  };

  const pageLink = (p, label = null, disabled = false, active = false) => {
    const text = label || p;
    if (disabled) parts.push(`<span style="min-width:32px;height:32px;border-radius:999px;border:1px solid #374151;display:flex;align-items:center;justify-content:center;font-size:13px;color:#4b5563;margin:0 3px;">${text}</span>`);
    else {
      const activeStyle = active ? "background:#334155;color:#f9fafb;border-color:#4b5563;" : "";
      parts.push(`<a href="${buildUrl(p)}" style="min-width:32px;height:32px;border-radius:999px;border:1px solid #4b5563;display:flex;align-items:center;justify-content:center;font-size:13px;color:#9ca3af;margin:0 3px;text-decoration:none;${activeStyle}">${text}</a>`);
    }
  };

  pageLink(Math.max(1, current - 1), "‹", current === 1, false);
  if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pageLink(i, null, false, i === current); }
  else {
    pageLink(1, null, false, current === 1);
    if (current > 3) parts.push(`<span style="color:#6b7280;margin:0 4px;">...</span>`);
    const start = Math.max(2, current - 1), end = Math.min(totalPages - 1, current + 1);
    for (let i = start; i <= end; i++) pageLink(i, null, false, i === current);
    if (current < totalPages - 2) parts.push(`<span style="color:#6b7280;margin:0 4px;">...</span>`);
    pageLink(totalPages, null, false, current === totalPages);
  }
  pageLink(Math.min(totalPages, current + 1), "›", current === totalPages, false);

  return `<div style="display:flex;justify-content:center;margin:24px 0 32px;">${parts.join("")}</div>`;
}
