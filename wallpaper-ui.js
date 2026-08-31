(function () {
  if (window.__dshWallpaperInjected) return 'already';
  const API = window.wallpaper;
  if (!API) return 'no-api';
  window.__dshWallpaperInjected = true;

  const STORAGE_KEY = 'dsh-wallpaper-ui-state-v1';
  const pageStyle = document.createElement('style');
  pageStyle.textContent = 'html, body, #root { background: transparent !important; }';
  document.head.appendChild(pageStyle);

  const host = document.createElement('div');
  host.id = 'dsh-wallpaper-ui';
  host.dataset.theme = document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  const backgroundHost = document.createElement('div');
  backgroundHost.id = 'dsh-wallpaper-background';
  backgroundHost.dataset.theme = host.dataset.theme;
  backgroundHost.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const backgroundShadow = backgroundHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; color: #222; font-family: system-ui, "Microsoft YaHei", sans-serif; }
    :host([data-theme="dark"]) { color: #eee; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    #controls { position: fixed; right: 16px; bottom: 16px; z-index: 2; pointer-events: auto; }
    button, input, select { font: inherit; }
    button { border: 0; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .65; }
    #toggle { width: 42px; height: 42px; border-radius: 50%; background: rgba(22,24,30,.88); color: #fff; font-size: 18px; border: 1px solid rgba(255,255,255,.16); box-shadow: 0 4px 14px rgba(0,0,0,.45); backdrop-filter: blur(8px); }
    #panel { position: absolute; right: 0; bottom: 52px; width: min(430px, calc(100vw - 24px)); max-height: min(78vh, 720px); overflow: auto; padding: 14px; border-radius: 14px; background: rgba(248,249,250,.97); color: #222; border: 1px solid rgba(0,0,0,.12); box-shadow: 0 12px 40px rgba(0,0,0,.35); }
    :host([data-theme="dark"]) #panel { background: rgba(22,24,30,.97); color: #eee; border-color: rgba(255,255,255,.14); }
    #header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    #title { font-size: 14px; font-weight: 700; }
    #close { padding: 3px 6px; border-radius: 6px; background: transparent; color: inherit; font-size: 16px; }
    #close:hover, .action:hover, .favorite:hover { background: rgba(127,127,127,.15); }
    #actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .action { padding: 6px 8px; border-radius: 7px; background: rgba(127,127,127,.12); color: inherit; font-size: 12px; }
    #filters { display: flex; gap: 6px; margin-bottom: 8px; }
    #search { min-width: 0; flex: 1; padding: 7px 9px; border: 1px solid rgba(127,127,127,.3); border-radius: 7px; background: rgba(255,255,255,.72); color: inherit; outline: none; }
    :host([data-theme="dark"]) #search { background: rgba(0,0,0,.25); border-color: rgba(255,255,255,.18); }
    #search:focus { border-color: #4d6bfe; box-shadow: 0 0 0 2px rgba(77,107,254,.18); }
    #mode { width: 94px; padding: 7px 5px; border: 1px solid rgba(127,127,127,.3); border-radius: 7px; background: transparent; color: inherit; }
    #status { min-height: 18px; color: #777; font-size: 12px; line-height: 1.4; margin: 4px 2px 8px; }
    :host([data-theme="dark"]) #status { color: #aaa; }
    #roots { margin: 0 0 9px; }
    .root-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; background: rgba(127,127,127,.08); font-size: 11px; }
    .root-row + .root-row { margin-top: 4px; }
    .root-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .remove-root { padding: 2px 5px; border-radius: 5px; color: #b44; background: transparent; }
    #list { display: grid; gap: 5px; }
    .item-row { display: flex; align-items: center; gap: 3px; width: 100%; border-radius: 8px; }
    .item-row:hover, .item-row.current { background: rgba(77,107,254,.13); }
    .item { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; padding: 7px; text-align: left; border-radius: 8px; background: transparent; color: inherit; }
    .thumb { width: 72px; height: 44px; flex: 0 0 72px; object-fit: cover; border-radius: 6px; background: rgba(127,127,127,.18); display: grid; place-items: center; font-size: 17px; }
    .item-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .item-meta { color: #888; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host([data-theme="dark"]) .item-meta { color: #aaa; }
    .favorite { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 6px; background: transparent; color: #d99b24; font-size: 18px; }
    .empty { padding: 12px 8px; color: #888; font-size: 12px; line-height: 1.5; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
  `;
  shadow.appendChild(style);
  const backgroundStyle = document.createElement('style');
  backgroundStyle.textContent = `
    :host { all: initial; }
    #background { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: #0d0f12; }
    #background video, #background img { width: 100%; height: 100%; object-fit: cover; display: none; }
  `;
  backgroundShadow.appendChild(backgroundStyle);

  const background = document.createElement('div');
  background.id = 'background';
  const video = document.createElement('video');
  video.autoplay = true; video.loop = true; video.muted = true; video.playsInline = true;
  const image = document.createElement('img');
  image.alt = '';
  background.append(video, image);
  backgroundShadow.appendChild(background);

  const controls = document.createElement('div');
  controls.id = 'controls';
  const toggle = document.createElement('button');
  toggle.id = 'toggle'; toggle.type = 'button'; toggle.textContent = '🎨'; toggle.title = '更换壁纸'; toggle.setAttribute('aria-label', '更换壁纸'); toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section');
  panel.id = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', '壁纸选择器');
  controls.append(toggle, panel);
  shadow.appendChild(controls);
  document.body.insertBefore(backgroundHost, document.body.firstChild);
  document.body.appendChild(host);

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function readState() {
    const fallback = { query: '', mode: 'all', favorites: [], recent: [] };
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        query: typeof value.query === 'string' ? value.query.slice(0, 120) : fallback.query,
        mode: ['all', 'video', 'static', 'favorite', 'recent'].includes(value.mode) ? value.mode : fallback.mode,
        favorites: Array.isArray(value.favorites) ? value.favorites.filter((id) => typeof id === 'string').slice(0, 100) : [],
        recent: Array.isArray(value.recent) ? value.recent.filter((id) => typeof id === 'string').slice(0, 20) : []
      };
    } catch (error) { return fallback; }
  }

  const state = readState();
  let itemsCache = [];
  let currentSelectionId = null;
  let renderToken = 0;

  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {} }
  function isFavorite(id) { return state.favorites.includes(id); }
  function toggleFavorite(id) { state.favorites = isFavorite(id) ? state.favorites.filter((value) => value !== id) : [id, ...state.favorites].slice(0, 100); saveState(); }
  function remember(id) { state.recent = [id, ...state.recent.filter((value) => value !== id)].slice(0, 20); saveState(); }
  function mediaUrl(id, file) { return file ? `wallpaper://local/${encodeURIComponent(id)}/${encodeURIComponent(file)}` : ''; }

  function clearVideo() { video.pause(); video.removeAttribute('src'); video.load(); video.style.display = 'none'; }
  function clearImage() { image.removeAttribute('src'); image.style.display = 'none'; }
  function apply(item) {
    if (!item || !item.url) { clearVideo(); clearImage(); return; }
    if (item.isVideo) { clearImage(); video.preload = 'metadata'; video.src = item.url; video.style.display = 'block'; video.play().catch(function () {}); }
    else { clearVideo(); image.src = item.url; image.style.display = 'block'; }
  }
  function buildSelection(item) { if (!item) return null; const file = item.isVideo ? item.media : item.preview; return file ? { id: item.id, isVideo: Boolean(item.isVideo), url: mediaUrl(item.id, file) } : null; }
  function closePanel() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  function setStatus(text) { const status = shadow.getElementById('status'); if (status) status.textContent = text || ''; }
  function exactPathMatch(left, right) { return typeof left === 'string' && typeof right === 'string' && (left === right || left.toLowerCase() === right.toLowerCase()); }

  function filterItems(items, query, mode) {
    const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
    const filtered = items.filter(function (item) {
      if (mode === 'video' && !item.isVideo) return false;
      if (mode === 'static' && item.isVideo) return false;
      if (mode === 'favorite' && !isFavorite(item.id)) return false;
      if (mode === 'recent' && !state.recent.includes(item.id)) return false;
      if (!needle) return true;
      return [item.title, item.type, item.externalId, item.id].some(function (value) { return String(value || '').toLocaleLowerCase('zh-CN').includes(needle); });
    });
    if (mode === 'recent') return filtered.sort(function (left, right) { return state.recent.indexOf(left.id) - state.recent.indexOf(right.id); });
    return filtered.sort(function (left, right) { return String(left.title || left.id).localeCompare(String(right.title || right.id), 'zh-CN'); });
  }

  function renderItems(list, items, query, mode) {
    list.replaceChildren();
    const visible = filterItems(items, query, mode);
    const none = node('button', '✕  无背景');
    none.className = 'item'; none.type = 'button'; none.addEventListener('click', async function () {
      none.disabled = true;
      try { await API.set(null); currentSelectionId = null; apply(null); closePanel(); }
      catch (error) { setStatus('保存失败，请重试。'); none.disabled = false; }
    });
    list.appendChild(none);
    if (!visible.length) {
      const emptyText = mode === 'favorite' ? '还没有收藏壁纸。' : (mode === 'recent' ? '还没有最近使用记录。' : '没有匹配的壁纸。');
      const empty = node('div', emptyText); empty.className = 'empty'; list.appendChild(empty); return 0;
    }
    visible.forEach(function (wallpaper) {
      const row = node('div'); row.className = `item-row${wallpaper.id === currentSelectionId ? ' current' : ''}`;
      const select = node('button'); select.className = 'item'; select.type = 'button';
      const thumb = wallpaper.preview ? node('img') : node('div'); thumb.className = 'thumb';
      if (wallpaper.preview) { thumb.src = mediaUrl(wallpaper.id, wallpaper.preview); thumb.loading = 'lazy'; thumb.alt = wallpaper.title || '壁纸预览'; }
      else thumb.textContent = wallpaper.canPrepare ? '⏳' : '🖼️';
      const info = node('span'); info.className = 'item-info';
      const label = node('span', (wallpaper.title || wallpaper.id) + (wallpaper.id === currentSelectionId ? '  · 当前' : '')); label.className = 'item-label';
      const meta = node('span', wallpaper.isVideo ? '视频壁纸' : (wallpaper.canPrepare ? '场景包 · 点击后提取预览' : '静态壁纸')); meta.className = 'item-meta';
      info.append(label, meta); select.append(thumb, info); row.appendChild(select);
      const favorite = node('button', isFavorite(wallpaper.id) ? '★' : '☆'); favorite.className = 'favorite'; favorite.type = 'button'; favorite.title = isFavorite(wallpaper.id) ? '取消收藏' : '收藏'; favorite.setAttribute('aria-label', favorite.title);
      favorite.addEventListener('click', function () { toggleFavorite(wallpaper.id); renderItems(list, itemsCache, query, mode); });
      row.appendChild(favorite); list.appendChild(row);
      select.addEventListener('click', async function () {
        select.disabled = true; favorite.disabled = true; meta.textContent = wallpaper.canPrepare ? '正在提取预览…' : '正在应用…';
        try {
          let prepared = wallpaper;
          if (wallpaper.canPrepare && API.prepare) prepared = await API.prepare(wallpaper.id);
          if (!prepared) throw new Error('wallpaper unavailable');
          await API.set(prepared.id); currentSelectionId = prepared.id; remember(prepared.id); apply(buildSelection(prepared)); closePanel();
        } catch (error) { meta.textContent = '加载失败，请重新扫描'; select.disabled = false; favorite.disabled = false; }
      });
    });
    return visible.length;
  }

  async function render() {
    const token = ++renderToken;
    panel.replaceChildren();
    const header = node('div'); header.id = 'header';
    const heading = node('div', '选择壁纸'); heading.id = 'title';
    const close = node('button', '×'); close.id = 'close'; close.type = 'button'; close.title = '关闭'; close.addEventListener('click', closePanel);
    header.append(heading, close); panel.appendChild(header);
    const actions = node('div'); actions.id = 'actions';
    const rescan = node('button', '重新扫描'); rescan.className = 'action'; rescan.type = 'button';
    const addRoot = node('button', '添加目录'); addRoot.className = 'action'; addRoot.type = 'button';
    const clearCache = node('button', '清理缓存'); clearCache.className = 'action'; clearCache.type = 'button';
    actions.append(rescan, addRoot, clearCache); panel.appendChild(actions);
    const filters = node('div'); filters.id = 'filters';
    const search = node('input'); search.id = 'search'; search.type = 'search'; search.placeholder = '搜索壁纸'; search.setAttribute('aria-label', '搜索壁纸'); search.value = state.query;
    const mode = node('select'); mode.id = 'mode'; mode.setAttribute('aria-label', '壁纸筛选');
    [['all', '全部'], ['video', '视频'], ['static', '静态'], ['favorite', '收藏'], ['recent', '最近']].forEach(function (option) { const item = node('option', option[1]); item.value = option[0]; mode.appendChild(item); });
    mode.value = state.mode; filters.append(search, mode); panel.appendChild(filters);
    const status = node('div'); status.id = 'status'; panel.appendChild(status);
    const roots = node('div'); roots.id = 'roots'; panel.appendChild(roots);
    const list = node('div'); list.id = 'list'; panel.appendChild(list);
    function updateList() { state.query = search.value.slice(0, 120); state.mode = mode.value; saveState(); const count = renderItems(list, itemsCache, state.query, state.mode); setStatus(`${count} 个匹配壁纸`); }
    search.addEventListener('input', updateList); mode.addEventListener('change', updateList); setStatus('正在读取壁纸…');
    rescan.addEventListener('click', async function () { rescan.disabled = true; setStatus('正在重新扫描…'); try { if (API.rescan) await API.rescan(); else await API.list({ force: true }); await render(); } catch (error) { setStatus('扫描失败，请检查目录权限。'); rescan.disabled = false; } });
    addRoot.addEventListener('click', async function () { addRoot.disabled = true; try { if (API.chooseRoot) await API.chooseRoot(); await render(); } catch (error) { setStatus('添加目录失败，请重试。'); addRoot.disabled = false; } });
    clearCache.addEventListener('click', async function () { clearCache.disabled = true; try { if (API.clearCache) await API.clearCache(); setStatus('壁纸缓存已清理。'); } catch (error) { setStatus('清理缓存失败。'); } clearCache.disabled = false; });

    try {
      const [items, rootInfo, runtimeInfo, selection] = await Promise.all([
        API.list(), API.roots ? API.roots() : Promise.resolve({ roots: [], manual: [] }),
        API.status ? API.status() : Promise.resolve(null), API.get ? API.get() : Promise.resolve(null)
      ]);
      if (token !== renderToken) return;
      itemsCache = Array.isArray(items) ? items : [];
      currentSelectionId = selection && selection.id ? selection.id : currentSelectionId;
      const rootList = Array.isArray(rootInfo?.roots) ? rootInfo.roots : [];
      const manualList = Array.isArray(rootInfo?.manual) ? rootInfo.manual : [];
      rootList.forEach(function (root) {
        const row = node('div'); row.className = 'root-row'; const pathLabel = node('span', root); pathLabel.className = 'root-path'; row.appendChild(pathLabel);
        if (manualList.some(function (item) { return exactPathMatch(item, root); })) { const remove = node('button', '移除'); remove.className = 'remove-root'; remove.type = 'button'; remove.addEventListener('click', async function () { remove.disabled = true; try { if (API.removeRoot) await API.removeRoot(root); await render(); } catch (error) { remove.disabled = false; setStatus('移除目录失败。'); } }); row.appendChild(remove); }
        roots.appendChild(row);
      });
      if (!rootList.length) { const emptyRoots = node('div', '未检测到壁纸目录，可点击“添加目录”。'); emptyRoots.className = 'empty'; roots.appendChild(emptyRoots); }
      updateList();
      const version = runtimeInfo && runtimeInfo.dshVersion ? `DSH ${runtimeInfo.dshVersion}` : 'DSH 未检测到';
      const wrapper = runtimeInfo && runtimeInfo.wrapperVersion ? `桌面 ${runtimeInfo.wrapperVersion} · ` : '';
      const compatibility = runtimeInfo && runtimeInfo.dshCompatible === false ? ' · DSH 版本过低' : '';
      setStatus(`${filterItems(itemsCache, state.query, state.mode).length} 个匹配壁纸 · ${wrapper}${version}${compatibility}`);
    } catch (error) {
      if (token !== renderToken) return;
      setStatus('读取壁纸失败，请检查目录权限。'); const empty = node('div', '请点击“重新扫描”重试。'); empty.className = 'empty'; list.appendChild(empty);
    }
  }

  toggle.addEventListener('click', function () { if (panel.hidden) { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); void render(); } else closePanel(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !panel.hidden) closePanel(); });
  video.addEventListener('error', function () { setStatus('壁纸视频加载失败，请重新扫描或选择其他壁纸。'); });
  image.addEventListener('error', function () { setStatus('壁纸图片加载失败，请重新扫描或选择其他壁纸。'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) video.pause(); else if (video.src && video.style.display !== 'none') video.play().catch(function () {}); });
  const themeObserver = new MutationObserver(function () { const theme = document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'; host.dataset.theme = theme; backgroundHost.dataset.theme = theme; });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });

  API.get().then(async function (selection) {
    if (!selection || !selection.id) return;
    currentSelectionId = selection.id;
    try { const items = await API.list(); let selected = items.find(function (item) { return item.id === selection.id; }); if (selected && selected.canPrepare && API.prepare) selected = await API.prepare(selected.id); if (selected) { currentSelectionId = selected.id; apply(buildSelection(selected)); } }
    catch (error) {}
  }).catch(function () {});
  if (API.ping) API.ping().catch(function () {});
  return 'ok';
})();
