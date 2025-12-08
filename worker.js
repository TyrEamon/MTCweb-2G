// ===========================
// MTCweb Gallery Pro (Video + Pagination + Search)
// ===========================
const SITE_TITLE = "MTCweb";

// 👇 【修改1】新增 Logo 常量 (您可以在这里替换成您的图片链接)
const SITE_LOGO = `<img src="https://link.tyrlink.dpdns.org/mtc.png" alt="MTCweb" style="width:28px;height:28px;border-radius:6px;display:block;">`;

const COUNTER_KEY = "__counter";
const DEFAULT_CATS = "热门 Cosplay,视频专区,软件资源,个人写真";
const PAGE_SIZE = 24; // 每页显示数量


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

    // 列表页 (首页/分类/搜索)
    if (path === "/list" || path.startsWith("/category/")) {
        return renderListHandler(request, env, url, categories, path);
    }

    // 文件代理 (视频播放/图片预览)
    if (path.startsWith("/file/")) {
      const param = decodeURIComponent(path.replace("/file/", ""));
      const rangeHeader = request.headers.get("Range");
      return proxyTelegramFile(env, param, url, rangeHeader);
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


    // 获取所有数据
    let albums = await getAllAlbums(env);


    // 1. 筛选分类
    if (targetCat) {
        albums = albums.filter(a => a.category === targetCat);
    }


    // 2. 搜索过滤
    if (query) {
        albums = albums.filter(a => a.title.toLowerCase().includes(query) || a.code.toLowerCase().includes(query));
    }


    // 3. 分页逻辑
    const totalItems = albums.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const start = (page - 1) * PAGE_SIZE;
    const currentList = albums.slice(start, start + PAGE_SIZE);


    // 渲染
    return renderListPage(env, {
        albums: currentList,
        categories,
        currentCat: targetCat,
        currentPage: page,
        totalPages,
        query,
        url
    });
}


async function renderAlbum(env, code, url, categories) {
    return new Promise(async (resolve) => {
        // 获取所有专辑用于计算 Pre/Next (为了性能，这里最好优化，但KV读取很快，暂且全量读)
        const allAlbums = await getAllAlbums(env);
        const currentIndex = allAlbums.findIndex(a => a.code === code);

        if (currentIndex === -1) return resolve(new Response("Album not found", { status: 404 }));


        const data = allAlbums[currentIndex]; // 直接用列表数据，包含基本信息
        // 为了获取附件详情，需要单独读一次详情KV (如果列表里没有存完整附件信息)
        // 假设 list keys metadata 不够，重新 get 一次 json
        const detail = await env.ALBUMS.get(code, { type: "json" });
        if (!detail) return resolve(new Response("Data corrupted", { status: 500 }));


        // 计算上一篇/下一篇
        // 数组是按时间倒序的 (新->旧)。
        // Index - 1 是更新的 (Next/Pre 语义看你怎么定，这里按 Next = Newer, Prev = Older)
        const nextAlbum = currentIndex > 0 ? allAlbums[currentIndex - 1] : null;
        const prevAlbum = currentIndex < allAlbums.length - 1 ? allAlbums[currentIndex + 1] : null;


        const title = escapeHtml(detail.title);
        const category = escapeHtml(detail.category);

        // 图片列表
        const imagesHtml = (detail.files || []).map(fileId => {
            const src = `${url.origin}/file/${encodeURIComponent(fileId)}`;
            return `<img src="${src}" loading="lazy" alt="Image">`;
        }).join("");


        // 附件/视频列表
        let attachmentsHtml = "";
        if (detail.attachments && detail.attachments.length > 0) {
            attachmentsHtml = `<div class="attachments"><h3>Resources & Downloads</h3>`;
            detail.attachments.forEach(file => {
                const fname = escapeHtml(file.file_name);
                const fileUrl = `${url.origin}/file/${encodeURIComponent(file.direct_url)}?download=${encodeURIComponent(file.file_name)}`;
                const isVideo = fname.toLowerCase().match(/\.(mp4|mov|webm|mkv)$/);


                if (isVideo) {
                    attachmentsHtml += `
                    <div class="video-card">
                        <div class="video-header">🎬 ${fname}</div>
                        <video controls preload="metadata" width="100%" poster="">
                            <source src="${fileUrl}" type="video/mp4">
                            Your browser does not support the video tag.
                        </video>
                        <p class="video-tip">⚠️ 无法播放？<a href="${fileUrl}" target="_blank">点击下载</a></p>
                    </div>`;
                } else {
                    attachmentsHtml += `
                    <a href="${fileUrl}" class="attachment-item">
                        <span class="icon">⚡</span>
                        <span class="name">${fname}</span>
                    </a>`;
                }
            });
            attachmentsHtml += `</div>`;
        }


        // 底部导航 HTML
        const navHtml = `
            <div class="post-nav">
                ${prevAlbum ? `<a href="/${prevAlbum.code}" class="nav-btn prev">« ${escapeHtml(prevAlbum.title.substring(0,20))}...</a>` : `<span></span>`}
                ${nextAlbum ? `<a href="/${nextAlbum.code}" class="nav-btn next">${escapeHtml(nextAlbum.title.substring(0,20))}... »</a>` : `<span></span>`}
            </div>
        `;


        // 密码逻辑 (保留)
        const passwordLogic = detail.password ? `
          <div id="pwd-overlay" class="overlay"><div class="box">
              <h3>🔒 Encrypted</h3><input type="text" id="pwd-input" placeholder="Password">
              <button onclick="checkPwd('${detail.password}')">Unlock</button>
          </div></div><script>
            function checkPwd(r){if(document.getElementById('pwd-input').value===r){
            document.getElementById('pwd-overlay').style.display='none';localStorage.setItem('pwd_${code}',r);}else{alert('Error');}}
            if(localStorage.getItem('pwd_${code}')==='${detail.password}')document.getElementById('pwd-overlay').style.display='none';
          </script>` : "";


        const html = `
          <div class="album-header">
             <h1>${title}</h1>
             <p># ${category} <span style="margin-left:10px; opacity:0.5">${detail.code}</span></p>
          </div>
          ${passwordLogic}
          <div class="content-body">
            ${attachmentsHtml}
            <div class="gallery">${imagesHtml}</div>
            <div class="actions">
               ${detail.zip ? `<a href="${url.origin}/file/${encodeURIComponent(detail.zip.direct_url)}?download=${encodeURIComponent(detail.zip.file_name)}" class="btn primary">📦 Download ZIP</a>` : ""}
            </div>
            ${navHtml}
          </div>
        `;
        resolve(renderPage(env, html, categories, ""));
    });
}


// ===========================
// Core Logic & Renderers
// ===========================


async function getAllAlbums(env) {
  const list = await env.ALBUMS.list();
  const names = list.keys.map(k => k.name).filter(n => n !== COUNTER_KEY);
  // 为了列表页性能，这里只取 list 中的 metadata (如果有)，如果没有则需要 get
  // 优化：假设 list 无法获取 metadata，必须 Promise.all get
  const albums = await Promise.all(
    names.map(async code => {
      const data = await env.ALBUMS.get(code, { type: "json" });
      if (!data) return null;
      return { 
        code, 
        title: data.title || code, 
        category: data.category || "", 
        files: data.files || [], 
        // 列表页不需要 attachments 详情，省点流量
      };
    })
  );
  return albums.filter(Boolean).sort((a, b) => b.code.localeCompare(a.code, "en", { numeric: true }));
}


async function proxyTelegramFile(env, fileIdOrUrl, url, rangeHeader) {
  if (fileIdOrUrl.startsWith("http")) {
      try {
          const newReqHeaders = new Headers();
          if (rangeHeader) newReqHeaders.set("Range", rangeHeader);
          const response = await fetch(fileIdOrUrl, {
              method: "GET", headers: newReqHeaders,
              cf: { cacheTtl: 14400, cacheEverything: true }
          });
          const newHeaders = new Headers(response.headers);
          newHeaders.set("Cache-Control", "public, max-age=14400");
          newHeaders.set("Access-Control-Allow-Origin", "*");
          const downloadName = url.searchParams.get("download");
          if (downloadName) newHeaders.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
      } catch (e) { return new Response("Proxy Error", { status: 502 }); }
  }
  // Telegram File ID Logic... (Shortened for brevity, assumes standard implementation)
  const token = env.BOT_TOKEN;
  try {
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileIdOrUrl}`);
    const meta = await metaRes.json();
    const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    return new Response(fileRes.body, { headers: { "cache-control": "public, max-age=31536000" }});
  } catch (e) { return new Response("Error", { status: 500 }); }
}


function renderListPage(env, { albums, categories, currentCat, currentPage, totalPages, query, url }) {
    // 生成列表 HTML
    const listHtml = albums.length > 0 ? albums.map(a => `
      <a href="/${a.code}" class="card">
        <div class="card-cover">${getCoverHtml(url, a)}</div>
        <div class="card-info">
          <h3>${escapeHtml(a.title)}</h3>
          <p class="meta"># ${escapeHtml(a.category)}</p>
        </div>
      </a>
    `).join("") : `<div class="empty-state">No Result Found</div>`;


    // 生成分页 HTML
    let paginationHtml = "";
    if (totalPages > 1) {
        const buildUrl = (p) => {
            const u = new URL(url);
            u.searchParams.set("page", p);
            return u.pathname + u.search;
        };
        paginationHtml = `<div class="pagination">`;
        if (currentPage > 1) paginationHtml += `<a href="${buildUrl(currentPage - 1)}">&lt;</a>`;
        // 简易页码：只显示当前及前后
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                 paginationHtml += `<a href="${buildUrl(i)}" class="${i === currentPage ? 'active' : ''}">${i}</a>`;
            } else if (i === currentPage - 2 || i === currentPage + 2) {
                 paginationHtml += `<span>...</span>`;
            }
        }
        if (currentPage < totalPages) paginationHtml += `<a href="${buildUrl(currentPage + 1)}">&gt;</a>`;
        paginationHtml += `</div>`;
    }


    const html = `
      <div class="toolbar">
        <h2>${currentCat ? `# ${currentCat}` : (query ? `🔍 ${query}` : "All Albums")}</h2>
      </div>
      <div class="grid">${listHtml}</div>
      ${paginationHtml}
    `;
    return renderPage(env, html, categories, currentCat, query);
}


function renderPage(env, content, categories, activeCat, query = "") {
  const catLinks = categories.map(c => {
      const slug = c.replace(/\s+/g, '-');
      const isActive = c === activeCat ? "active" : "";
      return `<a href="/category/${slug}" class="${isActive}">${c}</a>`;
  }).join("");


  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${SITE_TITLE}</title>
      <style>
        :root { --bg: #0f0f13; --card: #1e1e2e; --text: #e0e0e0; --primary: #e63946; --accent: #457b9d; }
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; }
        body { background: var(--bg); color: var(--text); font-family: sans-serif; min-height: 100vh; }
        a { text-decoration: none; color: inherit; }


        /* Header & Nav */
        header { background: rgba(30,30,46,0.9); backdrop-filter: blur(10px); padding: 15px 20px; position: sticky; top: 0; z-index: 100; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; }

        /* 👇 【修改2】品牌Logo区域样式微调 */
        .brand { font-size: 1.2rem; font-weight: bold; color: #fff; display: flex; align-items: center; gap: 10px; }
        .logo-link { display: inline-flex; align-items: center; color: inherit; text-decoration: none; }
        .menu-btn { font-size: 1.5rem; cursor: pointer; display: block; margin-right: 10px; }

        .search-box { position: relative; }
        .search-box input { background: #000; border: 1px solid #333; color: #fff; padding: 8px 15px 8px 35px; border-radius: 20px; width: 150px; transition: width 0.3s; }
        .search-box input:focus { width: 220px; border-color: var(--primary); }
        .search-box::before { content: "🔍"; position: absolute; left: 10px; top: 8px; font-size: 0.8rem; opacity: 0.6; }


        /* Sidebar (Drawer) */
        /* 👇 【修改3】UI Fix：增加 z-index 防止侧边栏被视频遮挡 */
        .drawer { 
            position: fixed; top: 0; left: -250px; width: 250px; height: 100%; 
            background: var(--card); z-index: 999; /* 提高层级 */
            transition: 0.3s; padding-top: 60px; box-shadow: 2px 0 10px rgba(0,0,0,0.5); 
        }
        .drawer.open { left: 0; }
        .drawer a { display: block; padding: 12px 20px; border-bottom: 1px solid #333; transition: 0.2s; }
        .drawer a:hover, .drawer a.active { background: var(--primary); color: #fff; }
        .overlay-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 150; display: none; }
        .overlay-bg.open { display: block; }


        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }


        /* Grid & Card */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px; margin-top: 20px; }
        .card { background: var(--card); border-radius: 10px; overflow: hidden; transition: transform 0.2s; border: 1px solid #2a2a35; }
        .card:hover { transform: translateY(-5px); border-color: var(--primary); }
        .card-cover { aspect-ratio: 2/3; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .card-cover img { width: 100%; height: 100%; object-fit: cover; }
        .card-info { padding: 12px; }
        .card-info h3 { font-size: 0.9rem; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .meta { font-size: 0.75rem; color: #777; }


        /* Pagination */
        .pagination { display: flex; justify-content: center; gap: 5px; margin-top: 40px; }
        .pagination a { padding: 8px 12px; background: var(--card); border-radius: 4px; min-width: 32px; text-align: center; }
        .pagination a.active { background: var(--primary); color: #fff; }
        .pagination span { padding: 8px; color: #555; }


        /* Detail Page */
        .album-header { text-align: center; margin-bottom: 30px; border-bottom: 1px solid #333; padding-bottom: 20px; }

        /* 👇 【修改4】UI Fix：压低视频层级 */
        .video-card { 
            background: #15151e; padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #333; 
            position: relative; z-index: 1; /* 压低层级 */
        }

        .video-header { margin-bottom: 10px; color: #aaa; font-size: 0.9rem; }
        video { background: #000; border-radius: 6px; display: block; }
        .video-tip { font-size: 0.8rem; color: #555; margin-top: 8px; text-align: center; }

        .attachment-item { display: flex; background: var(--card); padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #333; }
        .attachment-item .icon { font-size: 1.2rem; margin-right: 15px; }


        .gallery { display: grid; gap: 10px; margin-top: 20px; }
        .gallery img { width: 100%; border-radius: 8px; }


        /* Pre/Next Nav */
        .post-nav { display: flex; justify-content: space-between; margin-top: 50px; border-top: 1px solid #333; padding-top: 20px; }
        .nav-btn { color: var(--accent); font-size: 0.9rem; max-width: 45%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nav-btn:hover { color: #fff; text-decoration: underline; }


        /* Icons */
        .icon-font { font-style: normal; }


        /* Password */
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 999; display: flex; align-items: center; justify-content: center; }
        .box { background: var(--card); padding: 30px; border-radius: 10px; text-align: center; }
        .box input { padding: 10px; border-radius: 4px; border: 1px solid #444; background: #000; color: #fff; margin: 15px 0; display: block; width: 100%; }
        .box button { padding: 8px 20px; background: var(--primary); border: none; color: #fff; border-radius: 4px; cursor: pointer; }


      </style>
    </head>
    <body>
      <div class="overlay-bg" id="bg" onclick="toggleMenu()"></div>
      <div class="drawer" id="drawer">
        <a href="/list">🏠 Home</a>
        ${catLinks}
      </div>


      <header>
        <div class="brand">
            <span class="menu-btn" onclick="toggleMenu()">☰</span>
            <!-- 👇 【修改5】使用 Logo 替换纯文本 -->
            <a href="/list" class="logo-link">
                ${SITE_LOGO}
                <span style="margin-left:8px;">${SITE_TITLE}</span>
            </a>
        </div>
        <form action="/list" method="GET" class="search-box">
            <input type="text" name="q" placeholder="Search..." value="${escapeHtml(query)}">
        </form>
      </header>


      <div class="container">
        ${content}
      </div>


      <script>
        function toggleMenu() {
            document.getElementById('drawer').classList.toggle('open');
            document.getElementById('bg').classList.toggle('open');
        }
      </script>
    </body>
    </html>
  `, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}


function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


function getCoverHtml(url, album) {
    if (album.files && album.files.length > 0) {
        const src = `${url.origin}/file/${encodeURIComponent(album.files[0])}`;
        return `<img src="${src}" loading="lazy" alt="Cover">`;
    }
    let icon = "📁";
    if (album.attachments && album.attachments.length > 0) {
        const f = album.attachments[0].file_name.toLowerCase();
        if (f.endsWith(".mp4")) icon = "🎬";
        else if (f.endsWith(".zip")) icon = "📦";
        else if (f.endsWith(".apk")) icon = "🤖";
    }
    return `<div style="display:flex;flex-direction:column;align-items:center;color:#666"><span style="font-size:3rem">${icon}</span></div>`;
}
