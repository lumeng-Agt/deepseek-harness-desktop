(function () {
  if (window.__dshWallpaperInjected) return 'already';
  const API = window.wallpaper;
  if (!API) return 'no-api';
  window.__dshWallpaperInjected = true;

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
    #background { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: #0d0f12; }
    #background video, #background img { width: 100%; height: 100%; object-fit: cover; display: none; }
    #controls { position: fixed; right: 16px; bottom: 16px; z-index: 2; pointer-events: auto; }
    button { font: inherit; border: 0; cursor: pointer; }
    #toggle { width: 42px; height: 42px; border-radius: 50%; background: rgba(22,24,30,.88); color: #fff; font-size: 18px; border: 1px solid rgba(255,255,255,.16); box-shadow: 0 4px 14px rgba(0,0,0,.45); backdrop-filter: blur(8px); }
    #panel { position: absolute; right: 0; bottom: 52px; width: min(390px, calc(100vw - 24px)); max-height: min(72vh, 680px); overflow: auto; padding: 14px; border-radius: 14px; background: rgba(248,249,250,.97); color: #222; border: 1px solid rgba(0,0,0,.12); box-shadow: 0 12px 40px rgba(0,0,0,.35); }
    :host([data-theme="dark"]) #panel { background: rgba(22,24,30,.97); color: #eee; border-color: rgba(255,255,255,.14); }
    #header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    #title { font-size: 14px; font-weight: 700; }
    #close { padding: 3px 6px; border-radius: 6px; background: transparent; color: inherit; font-size: 16px; }
    #close:hover, .action:hover { background: rgba(127,127,127,.15); }
    #actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .action { padding: 6px 8px; border-radius: 7px; background: rgba(127,127,127,.12); color: inherit; font-size: 12px; }
    #status { min-height: 18px; color: #777; font-size: 12px; line-height: 1.4; margin: 4px 2px 8px; }
    :host([data-theme="dark"]) #status { color: #aaa; }
    #roots { margin: 0 0 9px; }
    .root-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; background: rgba(127,127,127,.08); font-size: 11px; }
    .root-row + .root-row { margin-top: 4px; }
    .root-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .remove-root { padding: 2px 5px; border-radius: 5px; color: #b44; background: transparent; }
    #list { display: grid; gap: 5px; }
    .item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px; text-align: left; border-radius: 8px; background: transparent; color: inherit; }
    .item:hover { background: rgba(127,127,127,.13); }
    .item:disabled { cursor: wait; opacity: .65; }
    .thumb { width: 72px; height: 44px; flex: 0 0 72px; object-fit: cover; border-radius: 6px; background: rgba(127,127,127,.18); }
    .item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .empty { padding: 12px 8px; color: #888; font-size: 12px; line-height: 1.5; }
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

  function mediaUrl(id, file) {
    return file ? `wallpaper://local/${encodeURIComponent(id)}/${encodeURIComponent(file)}` : '';
  }

  function clearVideo() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.style.display = 'none';
  }

  function clearImage() {
    image.removeAttribute('src');
    image.style.display = 'none';
  }

  function apply(item) {
    if (!item || !item.url) { clearVideo(); clearImage(); return; }
    if (item.isVideo) {
      clearImage();
      video.preload = 'metadata';
      video.src = item.url;
      video.style.display = 'block';
      video.play().catch(function () {});
    } else {
      clearVideo();
      image.src = item.url;
      image.style.display = 'block';
    }
  }

  function buildSelection(item) {
    if (!item) return null;
    const file = item.isVideo ? item.media : item.preview;
    return file ? { id: item.id, isVideo: Boolean(item.isVideo), url: mediaUrl(item.id, file) } : null;
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  function setStatus(text) {
    const status = shadow.getElementById('status');
    if (status) status.textContent = text || '';
  }

  function exactPathMatch(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    return left === right || left.toLowerCase() === right.toLowerCase();
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    panel.replaceChildren();
    const header = node('div'); header.id = 'header';
    const heading = node('div', '选择壁纸'); heading.id = 'title';
    header.appendChild(heading);
    const close = node('button', '×'); close.id = 'close'; close.type = 'button'; close.title = '关闭'; close.addEventListener('click', closePanel);
    header.appendChild(close);
    panel.appendChild(header);

    const actions = node('div'); actions.id = 'actions';
    const rescan = node('button', '重新扫描'); rescan.className = 'action'; rescan.type = 'button';
    const addRoot = node('button', '添加目录'); addRoot.className = 'action'; addRoot.type = 'button';
    const clearCache = node('button', '清理缓存'); clearCache.className = 'action'; clearCache.type = 'button';
    actions.append(rescan, addRoot, clearCache); panel.appendChild(actions);
    const status = node('div'); status.id = 'status'; panel.appendChild(status);
    const roots = node('div'); roots.id = 'roots'; panel.appendChild(roots);
    const list = node('div'); list.id = 'list'; panel.appendChild(list);
    setStatus('正在读取壁纸…');

    rescan.addEventListener('click', async function () {
      rescan.disabled = true;
      setStatus('正在重新扫描…');
      try {
        if (API.rescan) await API.rescan();
        else await API.list({ force: true });
        await render();
      } catch (error) {
        setStatus('扫描失败，请检查目录权限。');
        rescan.disabled = false;
      }
    });
    addRoot.addEventListener('click', async function () {
      addRoot.disabled = true;
      try { if (API.chooseRoot) await API.chooseRoot(); await render(); }
      catch (error) { setStatus('添加目录失败，请重试。'); addRoot.disabled = false; }
    });
    clearCache.addEventListener('click', async function () {
      clearCache.disabled = true;
      try { if (API.clearCache) await API.clearCache(); setStatus('壁纸缓存已清理。'); }
      catch (error) { setStatus('清理缓存失败。'); }
      clearCache.disabled = false;
    });

    try {
      const [items, rootInfo, runtimeInfo] = await Promise.all([
        API.list(),
        API.roots ? API.roots() : Promise.resolve({ roots: [], manual: [] }),
        API.status ? API.status() : Promise.resolve(null)
      ]);
      if (token !== renderToken) return;
      const rootList = Array.isArray(rootInfo?.roots) ? rootInfo.roots : [];
      const manualList = Array.isArray(rootInfo?.manual) ? rootInfo.manual : [];
      rootList.forEach(function (root) {
        const row = node('div'); row.className = 'root-row';
        const pathLabel = node('span', root); pathLabel.className = 'root-path'; row.appendChild(pathLabel);
        if (manualList.some(function (item) { return exactPathMatch(item, root); })) {
          const remove = node('button', '移除'); remove.className = 'remove-root'; remove.type = 'button';
          remove.addEventListener('click', async function () {
            remove.disabled = true;
            try { if (API.removeRoot) await API.removeRoot(root); await render(); }
            catch (error) { remove.disabled = false; setStatus('移除目录失败。'); }
          });
          row.appendChild(remove);
        }
        roots.appendChild(row);
      });
      if (!rootList.length) {
        const emptyRoots = node('div', '未检测到壁纸目录，可点击“添加目录”。');
        emptyRoots.className = 'empty'; roots.appendChild(emptyRoots);
      }

      const none = node('button', '✕  无背景'); none.className = 'item'; none.type = 'button';
      none.addEventListener('click', async function () {
        none.disabled = true;
        try { await API.set(null); apply(null); closePanel(); }
        catch (error) { setStatus('保存失败，请重试。'); none.disabled = false; }
      });
      list.appendChild(none);
      if (!Array.isArray(items) || !items.length) {
        const empty = node('div', '没有找到可用壁纸；可检查 Steam 壁纸库路径。'); empty.className = 'empty'; list.appendChild(empty);
      } else {
        items.forEach(function (wallpaper) {
          const item = node('button'); item.className = 'item'; item.type = 'button';
          const thumb = wallpaper.preview ? node('img') : node('div'); thumb.className = 'thumb';
          if (wallpaper.preview) { thumb.src = mediaUrl(wallpaper.id, wallpaper.preview); thumb.loading = 'lazy'; thumb.alt = wallpaper.title || '壁纸预览'; }
          const suffix = wallpaper.isVideo ? '  🎬' : (wallpaper.canPrepare ? '  ⏳' : '');
          const label = node('span', (wallpaper.title || wallpaper.id) + suffix); label.className = 'item-label';
          item.append(thumb, label); list.appendChild(item);
          item.addEventListener('click', async function () {
            item.disabled = true; label.textContent = '准备壁纸中…';
            try {
              let prepared = wallpaper;
              if (wallpaper.canPrepare && API.prepare) prepared = await API.prepare(wallpaper.id);
              if (!prepared) throw new Error('wallpaper unavailable');
              await API.set(wallpaper.id);
              apply(buildSelection(prepared));
              closePanel();
            } catch (error) {
              label.textContent = '加载失败，请重新扫描';
              item.disabled = false;
            }
          });
        });
      }
      const versionText = runtimeInfo && runtimeInfo.dshVersion ? ` · DSH ${runtimeInfo.dshVersion}` : '';
      setStatus(`${Array.isArray(items) ? items.length : 0} 个壁纸项目${versionText}`);
    } catch (error) {
      if (token !== renderToken) return;
      setStatus('读取壁纸失败，请检查目录权限。');
      const empty = node('div', '请点击“重新扫描”重试。'); empty.className = 'empty'; list.appendChild(empty);
    }
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); void render(); }
    else closePanel();
  });

  video.addEventListener('error', function () { setStatus('壁纸视频加载失败，请重新扫描或选择其他壁纸。'); });
  image.addEventListener('error', function () { setStatus('壁纸图片加载失败，请重新扫描或选择其他壁纸。'); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) video.pause();
    else if (video.src && video.style.display !== 'none') video.play().catch(function () {});
  });

  const themeObserver = new MutationObserver(function () {
    const theme = document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
    host.dataset.theme = theme;
    backgroundHost.dataset.theme = theme;
  });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });

  API.get().then(async function (selection) {
    if (!selection || !selection.id) return;
    try {
      const items = await API.list();
      let selected = items.find(function (item) { return item.id === selection.id; });
      if (selected && selected.canPrepare && API.prepare) selected = await API.prepare(selected.id);
      if (selected) apply(buildSelection(selected));
    } catch (error) {}
  }).catch(function () {});
  if (API.ping) API.ping().catch(function () {});
  return 'ok';
})();
