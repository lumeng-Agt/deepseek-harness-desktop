'use strict';
const { app, BrowserWindow, shell, ipcMain, protocol } = require('electron');
const { spawn } = require('child_process');
const netMod = require('net');
const path = require('path');
const fs = require('fs');
const cfg = require('./config.js');

const HOST = cfg.HOST;
const PORT = cfg.PORT;
const APP_URL = 'http://' + HOST + ':' + PORT;
const NODE = cfg.NODE;
const BIN = cfg.DSH_BIN;
const WALLPAPER_DIR = cfg.WALLPAPER_DIR;
const WORKSPACE = cfg.WORKSPACE;
const SETTINGS_FILE = path.join(app.getPath('userData'), 'wallpaper.json');

// Must run before app is ready, so media elements can load wallpaper:// URLs
protocol.registerSchemesAsPrivileged([
  { scheme: 'wallpaper', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

// ---- wallpaper catalog ----
function hasHiRes(dir) {
  return ['hi-res-video.mp4', 'hi-res.png', 'hi-res.jpg'].some((f) => fs.existsSync(path.join(dir, f)));
}

function isPathInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

function findFtyp(buf) {
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x66 && buf[i+1] === 0x74 && buf[i+2] === 0x79 && buf[i+3] === 0x70) return i;
  }
  return -1;
}

function extractBestImage(buf) {
  const images = [];
  const pngSig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const iendSig = Buffer.from([0x49,0x45,0x4E,0x44,0x0D,0x0A,0x1A,0x0A]);
  let pos = 0;
  while (true) {
    const i = buf.indexOf(pngSig, pos);
    if (i < 0) break;
    const end = buf.indexOf(iendSig, i + 8);
    if (end > i) {
      const data = buf.slice(i, end + 8);
      if (data.length > 20 * 1024) {
        const w = data.readUInt32BE(16), h = data.readUInt32BE(20), ct = data[25];
        if (w >= 200 && h >= 200 && w <= 16384 && h <= 16384) {
          images.push({ type: 'png', data, w, h, opaque: (ct === 2 || ct === 0) });
        }
      }
      pos = end + 8;
    } else { pos = i + 8; }
  }
  const jpgSig = Buffer.from([0xFF,0xD8,0xFF]);
  const jpgEnd = Buffer.from([0xFF,0xD9]);
  pos = 0;
  while (true) {
    const i = buf.indexOf(jpgSig, pos);
    if (i < 0) break;
    const end = buf.indexOf(jpgEnd, i + 3);
    if (end > i) {
      const data = buf.slice(i, end + 2);
      if (data.length > 20 * 1024) {
        let w = 0, h = 0;
        for (let k = 2; k < data.length - 9; k++) {
          if (data[k] === 0xFF && (data[k+1] === 0xC0 || data[k+1] === 0xC1 || data[k+1] === 0xC2)) { h = data.readUInt16BE(k+5); w = data.readUInt16BE(k+7); break; }
        }
        if (w >= 200 && h >= 200 && w <= 16384 && h <= 16384) {
          if (data.length / (w * h) >= 0.05) {
            images.push({ type: 'jpg', data, w, h, opaque: true });
          }
        }
      }
      pos = end + 2;
    } else { pos = i + 3; }
  }
  if (images.length === 0) return null;
  let best = null;
  for (const img of images) { if (img.opaque && (!best || img.w * img.h > best.w * best.h)) best = img; }
  if (!best) for (const img of images) { if (!best || img.w * img.h > best.w * best.h) best = img; }
  return best;
}

function extractFromPkg(id) {
  const dir = path.join(WALLPAPER_DIR, id);
  const pkgPath = path.join(dir, 'scene.pkg');
  if (!fs.existsSync(pkgPath)) return null;
  if (hasHiRes(dir)) return null;
  let buf;
  try { buf = fs.readFileSync(pkgPath); } catch (e) { return null; }
  const ftyp = findFtyp(buf);
  if (ftyp >= 4) {
    const mp4 = buf.slice(ftyp - 4);
    if (mp4.length > 100 * 1024) {
      try { fs.writeFileSync(path.join(dir, 'hi-res-video.mp4'), mp4); return 'video'; } catch (e) {}
    }
  }
  const best = extractBestImage(buf);
  if (best) {
    try { fs.writeFileSync(path.join(dir, 'hi-res.' + best.type), best.data); return 'image'; } catch (e) {}
  }
  return null;
}

function readWallpapers() {
  const list = [];
  if (!WALLPAPER_DIR) return list;
  let entries = [];
  try { entries = fs.readdirSync(WALLPAPER_DIR); } catch (e) { return list; }
  for (const id of entries) {
    const dir = path.join(WALLPAPER_DIR, id);
    let st; try { st = fs.statSync(dir); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    let title = id, type = '';
    const pj = path.join(dir, 'project.json');
    if (fs.existsSync(pj)) {
      try { const j = JSON.parse(fs.readFileSync(pj, 'utf8')); if (j.title) title = j.title; if (j.type) type = j.type; } catch (e) {}
    }
    if ((type === 'scene' || type === 'Scene') && !hasHiRes(dir)) {
      try { extractFromPkg(id); } catch (e) {}
    }
    let media = null, preview = null, hiRes = null;
    const walk = (d, relativeDir) => {
      let names = [];
      try { names = fs.readdirSync(d); } catch (e) { return; }
      for (const n of names) {
        const p = path.join(d, n);
        const relativeName = relativeDir ? path.join(relativeDir, n) : n;
        let s; try { s = fs.statSync(p); } catch (e) { continue; }
        if (s.isDirectory()) { walk(p, relativeName); continue; }
        const ext = path.extname(n).toLowerCase();
        if (!media && (ext === '.mp4' || ext === '.webm') && s.size > 1024 * 1024) media = relativeName;
        if (!media && n === 'hi-res-video.mp4' && s.size > 100 * 1024) media = relativeName;
        if (!preview && (n === 'preview.jpg' || n === 'preview.png' || n === 'preview.gif')) preview = relativeName;
        if (!hiRes && (n === 'hi-res.png' || n === 'hi-res.jpg') && s.size > 500 * 1024) hiRes = relativeName;
      }
    };
    walk(dir, '');
    if (media) {
      list.push({ id, title, type, isVideo: true, media, preview });
    } else if (hiRes || preview) {
      list.push({ id, title, type, isVideo: false, media: null, preview: hiRes || preview });
    }
  }
  return list;
}

function readSetting() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { return null; }
}
function writeSetting(v) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(v)); } catch (e) {}
}

// ---- server helpers ----
function isServerUp() {
  return new Promise((resolve) => {
    const socket = new netMod.Socket();
    let settled = false;
    const done = (ok) => { if (settled) return; settled = true; try { socket.destroy(); } catch (e) {} resolve(ok); };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(PORT, HOST);
  });
}
function startServer() {
  if (!BIN || !NODE) return;
  const child = spawn(NODE, [BIN, 'web'], { cwd: WORKSPACE, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
async function ensureServer() {
  if (await isServerUp()) return true;
  if (!BIN || !NODE) return false;
  startServer();
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await isServerUp()) return true; }
  return false;
}

// ---- wallpaper protocol ----
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4'
};

function streamFile(full, start, end) {
  const nodeStream = fs.createReadStream(full, { start, end });
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); }
  });
}

function registerWallpaperProtocol() {
  protocol.handle('wallpaper', (request) => {
    try {
      const u = new globalThis.URL(request.url);
      const parts = u.pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts[0] || '');
      const file = decodeURIComponent(parts.slice(1).join('/'));
      const wallpaperRoot = WALLPAPER_DIR ? path.resolve(WALLPAPER_DIR) : null;
      const wallpaperItemRoot = wallpaperRoot ? path.resolve(wallpaperRoot, id) : null;
      const full = wallpaperItemRoot ? path.resolve(wallpaperItemRoot, file) : '';
      const validId = Boolean(id) && id !== '.' && id !== '..' && !/[\\/]/.test(id);
      if (!wallpaperRoot || !validId || !wallpaperItemRoot || !isPathInside(wallpaperRoot, wallpaperItemRoot) || !isPathInside(wallpaperItemRoot, full) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const stat = fs.statSync(full);
      const ext = path.extname(full).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const total = stat.size;
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (m) {
          let start = m[1] ? parseInt(m[1], 10) : 0;
          let end = m[2] ? parseInt(m[2], 10) : total - 1;
          if (isNaN(start)) start = 0;
          if (isNaN(end) || end >= total) end = total - 1;
          if (start > end || start >= total) {
            return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + total } });
          }
          const length = end - start + 1;
          return new Response(streamFile(full, start, end), {
            status: 206,
            headers: {
              'content-type': mime,
              'content-length': String(length),
              'content-range': 'bytes ' + start + '-' + end + '/' + total,
              'accept-ranges': 'bytes'
            }
          });
        }
      }
      return new Response(streamFile(full, 0, total - 1), {
        status: 200,
        headers: { 'content-type': mime, 'content-length': String(total), 'accept-ranges': 'bytes' }
      });
    } catch (e) {
      return new Response('Error', { status: 500 });
    }
  });
}

// ---- IPC ----
function registerIpc() {
  ipcMain.handle('wallpaper:list', () => readWallpapers());
  ipcMain.handle('wallpaper:get', () => readSetting());
  ipcMain.handle('wallpaper:set', (e, id) => { writeSetting(id ? { id } : null); return readSetting(); });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 800, minHeight: 600,
    title: 'DeepSeek Harness',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  function injectWallpaperUI() {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl.startsWith(APP_URL)) return;
    const uiPath = path.join(__dirname, 'wallpaper-ui.js');
    fs.readFile(uiPath, 'utf8', (err, code) => {
      if (err) return;
      win.webContents.executeJavaScript(code).catch(() => {});
    });
  }

  win.webContents.on('did-finish-load', injectWallpaperUI);

  win.loadFile(path.join(__dirname, 'loading.html'));

  const up = await ensureServer();
  if (up) {
    await win.loadURL(APP_URL);
    injectWallpaperUI();
  } else {
    await win.loadFile(path.join(__dirname, 'error.html'));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) { if (wins[0].isMinimized()) wins[0].restore(); wins[0].focus(); }
  });

  app.whenReady().then(() => {
    registerWallpaperProtocol();
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { app.quit(); });
}
