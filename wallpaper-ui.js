(function () {
  if (window.__dshWallpaperInjected) { return 'already'; }
  window.__dshWallpaperInjected = true;
  const API = window.wallpaper;
  if (!API) { return 'no-api'; }

  // 浅色主题：只有大背景半透明（透出壁纸），其余界面全部纯白
  const style = document.createElement('style');
  style.textContent = [
    'html, body, #root { background: transparent !important; }',
    // 浅色主题：大背景半透明，其余表面纯白
    'body:not([data-ds-dark-theme]) {',
    '  --dsw-alias-bg-base: rgba(255,255,255,0.5) !important;',
    '  --dsw-alias-bg-layer-1: #ffffff !important;',
    '  --dsw-alias-bg-layer-2: #ffffff !important;',
    '  --dsw-alias-bg-layer-3: #ffffff !important;',
    '  --dsw-alias-bg-overlay: #ffffff !important;',
    '  --dsw-alias-bg-module-platform: #ffffff !important;',
    '  --dsw-alias-bg-multi-select: #ffffff !important;',
    '  --dsw-specific-menu: #ffffff !important;',
    '  --dsw-specific-input-major: #ffffff !important;',
    '  --dsw-specific-sidebar-fill: #ffffff !important;',
    '  --dsw-specific-selector: #ffffff !important;',
    '  --dsw-specific-tip: #ffffff !important;',
    '  --dsw-alias-bg-primary: #ffffff !important;',
    '  --dsw-specific-bubble: #ffffff !important;',
    '  --dsw-specific-bubble-highlight: #ffffff !important;',
    '}',
    // 深色主题兜底（保持半透明深色）
    'body[data-ds-dark-theme] {',
    '  --dsw-alias-bg-base: rgba(21,21,23,0.5) !important;',
    '  --dsw-alias-bg-layer-1: rgba(35,35,36,0.45) !important;',
    '  --dsw-alias-bg-layer-2: rgba(44,44,46,0.4) !important;',
    '  --dsw-alias-bg-layer-3: rgba(53,54,56,0.35) !important;',
    '  --dsw-specific-sidebar-fill: rgba(15,17,21,0.45) !important;',
    '  --dsw-specific-input-major: rgba(35,35,36,0.55) !important;',
    '}',
    // 输入框纯白
    '.uV2eYG_card { background: #ffffff !important; border-color: rgba(0,0,0,0.1) !important; }',
    '.uV2eYG_card textarea, .uV2eYG_card [contenteditable], .uV2eYG_backdrop { color: #1a1a1a !important; caret-color: #1a1a1a !important; }',
    '.uV2eYG_hint { color: #9a9a9a !important; }',
    // 设置面板纯白
    '.VOzbGW_panel { background: #ffffff !important; }',
    '.VOzbGW_nav { background: #f5f6f7 !important; }',
    '.VOzbGW_navTitle, .VOzbGW_navLabel, .VOzbGW_header, .VOzbGW_close { color: #1a1a1a !important; }',
    '.VOzbGW_navCell { color: #1a1a1a !important; }',
    '.VOzbGW_navCell:hover { background: rgba(0,0,0,0.05) !important; }',
    '.VOzbGW_navCell.VOzbGW_active { background: rgba(0,0,0,0.08) !important; }',
    '.VOzbGW_content, .VOzbGW_options { color: #1a1a1a !important; }'
  ].join('\n');
  document.head.appendChild(style);

  function mediaUrl(id, file) {
    return 'wallpaper://local/' + encodeURIComponent(id) + '/' + encodeURIComponent(file);
  }

  // background layer (fixed, behind app content)
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:#0d0f12;';
  const video = document.createElement('video');
  video.autoplay = true; video.loop = true; video.muted = true; video.playsInline = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;';
  const img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;';
  layer.appendChild(video); layer.appendChild(img);
  document.body.insertBefore(layer, document.body.firstChild);

  function apply(sel) {
    if (!sel || !sel.url) { video.pause(); video.removeAttribute('src'); video.style.display='none'; img.removeAttribute('src'); img.style.display='none'; return; }
    if (sel.isVideo) {
      img.style.display = 'none';
      video.preload = 'metadata';
      video.src = sel.url; video.style.display = 'block';
      video.play().catch(function(){});
    } else {
      video.pause(); video.style.display = 'none';
      img.src = sel.url; img.style.display = 'block';
    }
  }

  function buildSel(w) {
    return { id: w.id, isVideo: w.isVideo, url: mediaUrl(w.id, w.isVideo ? w.media : w.preview) };
  }

  // floating button
  const btn = document.createElement('button');
  btn.textContent = '🎨';
  btn.title = '更换壁纸';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(22,24,30,.85);color:#fff;font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);backdrop-filter:blur(8px);';
  document.body.appendChild(btn);

  // panel
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:68px;z-index:2147483001;width:340px;max-height:72vh;overflow:auto;background:rgba(22,24,30,.97);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);padding:14px;display:none;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e8e8e8;';
  document.body.appendChild(panel);

  function toggle() {
    if (panel.style.display === 'none' || panel.style.display === '') { panel.style.display = 'block'; render(); }
    else { panel.style.display = 'none'; }
  }
  btn.addEventListener('click', toggle);

  function render() {
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = '选择壁纸';
    head.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:10px;';
    panel.appendChild(head);

    const none = document.createElement('div');
    none.textContent = '✕  无背景';
    none.style.cssText = 'padding:10px 8px;border-radius:8px;cursor:pointer;font-size:13px;';
    none.addEventListener('mouseenter', function(){ none.style.background='rgba(255,255,255,.06)'; });
    none.addEventListener('mouseleave', function(){ none.style.background='transparent'; });
    none.addEventListener('click', function(){ API.set(null); apply(null); toggle(); });
    panel.appendChild(none);

    API.list().then(function(list){
      if (!list.length) {
        var empty = document.createElement('div');
        empty.textContent = '没有找到可用壁纸；可检查 Steam 壁纸库路径。';
        empty.style.cssText = 'padding:10px 8px;color:#aaa;font-size:12px;line-height:1.5;';
        panel.appendChild(empty);
      }
      list.forEach(function(w){
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;';
        item.addEventListener('mouseenter', function(){ item.style.background='rgba(255,255,255,.06)'; });
        item.addEventListener('mouseleave', function(){ item.style.background='transparent'; });
        const thumb = document.createElement('img');
        thumb.src = w.preview ? mediaUrl(w.id, w.preview) : '';
        thumb.loading = 'lazy';
        thumb.alt = w.title || '壁纸预览';
        thumb.style.cssText = 'width:72px;height:44px;object-fit:cover;border-radius:6px;background:#333;flex:0 0 72px;';
        const label = document.createElement('div');
        label.style.cssText = 'font-size:13px;line-height:1.3;';
        label.textContent = w.title + (w.isVideo ? '  🎬' : '');
        item.appendChild(thumb); item.appendChild(label);
        item.addEventListener('click', function(){ API.set(w.id).then(function(){ apply(buildSel(w)); toggle(); }).catch(function(){ label.textContent = '保存失败，请重试'; }); });
        panel.appendChild(item);
      });
    }).catch(function(){
      var error = document.createElement('div');
      error.textContent = '读取壁纸失败，请稍后重试。';
      error.style.cssText = 'padding:10px 8px;color:#f99;font-size:12px;';
      panel.appendChild(error);
    });
  }

  // restore current selection on load
  API.get().then(function(sel){
    if (sel && sel.id) {
      API.list().then(function(list){
        var w = null;
        for (var i=0;i<list.length;i++){ if(list[i].id === sel.id){ w = list[i]; break; } }
        if (w) apply(buildSel(w));
      });
    }
  }).catch(function(){});
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) video.pause();
    else if (video.src && video.style.display !== 'none') video.play().catch(function(){});
  });
  if (API.ping) { API.ping().catch(function(){}); }
  return 'ok';
})();
