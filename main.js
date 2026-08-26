'use strict';

const { app, BrowserWindow, shell, ipcMain, protocol } = require('electron');
const { execFileSync, spawn } = require('child_process');
const { Readable } = require('stream');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const path = require('path');
const cfg = require('./config.js');
const { isPathInside, parseRange, portableRelative } = require('./lib/path-utils.js');

const HOST = cfg.HOST;
const PORT = cfg.PORT;
const APP_URL = `http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`;
const NODE = cfg.NODE;
const BIN = cfg.DSH_BIN;
const WALLPAPER_DIRS = (cfg.WALLPAPER_DIRS || (cfg.WALLPAPER_DIR ? [cfg.WALLPAPER_DIR] : [])).filter(Boolean);
const WORKSPACE = cfg.WORKSPACE;
const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'wallpaper.json');
const DSH_STATE_FILE = path.join(USER_DATA, 'dsh-server.json');
const DSH_LOG_FILE = path.join(USER_DATA, 'dsh-web.log');
const PROTOCOL_LOG_FILE = path.join(USER_DATA, 'protocol.log');
const INJECT_LOG_FILE = path.join(USER_DATA, 'inject.log');
const WALLPAPER_CACHE_DIR = path.join(USER_DATA, 'wallpaper-cache');
const CACHE_PREFIX = '__dsh_cache__';
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_SCENE_PKG_BYTES = 512 * 1024 * 1024;
const MAX_WALLPAPER_FILES = 5000;

let dshChild = null;
let dshOwnedPid = null;
let dshStopping = null;
let quitting = false;
let mainWindow = null;
let loadPromise = null;
let catalogCache = null;
let catalogCacheAt = 0;
let catalogPromise = null;
let lastServerError = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'wallpaper', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function fileExists(file) {
  try { return fs.existsSync(file); } catch (e) { return false; }
}

function isDirectory(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
}

function ensureDirectory(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return true; } catch (e) { return false; }
}

function rotateLog(file) {
  try {
    if (!fileExists(file) || fs.statSync(file).size <= MAX_LOG_BYTES) return;
    const rotated = file + '.1';
    if (fileExists(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(file, rotated);
  } catch (e) {}
}

function appendLog(file, message) {
  try {
    rotateLog(file);
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { encoding: 'utf8' });
  } catch (e) {}
}

function atomicWriteJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch (e) {
    try { if (fileExists(temp)) fs.unlinkSync(temp); } catch (ignored) {}
    return false;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ---- wallpaper catalog and cache ----

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4'
};

function cacheDirForId(id) {
  const key = crypto.createHash('sha256').update(id).digest('hex');
  return path.join(WALLPAPER_CACHE_DIR, key);
}

function atomicWriteBuffer(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    ensureDirectory(path.dirname(file));
    fs.writeFileSync(temp, data, { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch (e) {
    try { if (fileExists(temp)) fs.unlinkSync(temp); } catch (ignored) {}
    return false;
  }
}

function findFtyp(buf) {
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x66 && buf[i + 1] === 0x74 && buf[i + 2] === 0x79 && buf[i + 3] === 0x70) return i;
  }
  return -1;
}

function extractBestImage(buf) {
  const images = [];
  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const iendSig = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
  let pos = 0;
  while (true) {
    const i = buf.indexOf(pngSig, pos);
    if (i < 0) break;
    const end = buf.indexOf(iendSig, i + 8);
    if (end > i) {
      const data = buf.slice(i, end + 8);
      if (data.length > 20 * 1024 && data.length >= 26) {
        const width = data.readUInt32BE(16), height = data.readUInt32BE(20), colorType = data[25];
        if (width >= 200 && height >= 200 && width <= 16384 && height <= 16384) {
          images.push({ type: 'png', data, width, height, opaque: colorType === 2 || colorType === 0 });
        }
      }
      pos = end + 8;
    } else pos = i + 8;
  }

  const jpgSig = Buffer.from([0xFF, 0xD8, 0xFF]);
  const jpgEnd = Buffer.from([0xFF, 0xD9]);
  pos = 0;
  while (true) {
    const i = buf.indexOf(jpgSig, pos);
    if (i < 0) break;
    const end = buf.indexOf(jpgEnd, i + 3);
    if (end > i) {
      const data = buf.slice(i, end + 2);
      if (data.length > 20 * 1024) {
        let width = 0, height = 0;
        for (let k = 2; k < data.length - 9; k++) {
          if (data[k] === 0xFF && (data[k + 1] === 0xC0 || data[k + 1] === 0xC1 || data[k + 1] === 0xC2)) {
            height = data.readUInt16BE(k + 5); width = data.readUInt16BE(k + 7); break;
          }
        }
        if (width >= 200 && height >= 200 && width <= 16384 && height <= 16384 && data.length / (width * height) >= 0.05) {
          images.push({ type: 'jpg', data, width, height, opaque: true });
        }
      }
      pos = end + 2;
    } else pos = i + 3;
  }
  if (images.length === 0) return null;
  return images.filter((image) => image.opaque).sort((a, b) => b.width * b.height - a.width * a.height)[0]
    || images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

async function extractFromPkg(pkgPath, id) {
  try {
    const linkStat = await fsp.lstat(pkgPath);
    if (linkStat.isSymbolicLink()) return null;
    const stat = await fsp.stat(pkgPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SCENE_PKG_BYTES) return null;
    const cacheDir = cacheDirForId(id);
    const metaPath = path.join(cacheDir, 'meta.json');
    const cached = readJson(metaPath);
    if (cached && cached.sourceSize === stat.size && cached.sourceMtimeMs === stat.mtimeMs) {
      if (!cached.name) return null;
      const cachedFile = path.join(cacheDir, cached.name);
      if (fileExists(cachedFile)) return { name: cached.name, type: cached.type };
    }
    const buf = await fsp.readFile(pkgPath);
    const ftyp = findFtyp(buf);
    if (ftyp >= 4) {
      const mp4 = buf.slice(ftyp - 4);
      if (mp4.length > 100 * 1024) {
        const name = 'hi-res-video.mp4';
        if (atomicWriteBuffer(path.join(cacheDir, name), mp4)) {
          atomicWriteJson(metaPath, { sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, name, type: 'video' });
          return { name, type: 'video' };
        }
      }
    }
    const best = extractBestImage(buf);
    if (best) {
      const name = `hi-res.${best.type}`;
      if (atomicWriteBuffer(path.join(cacheDir, name), best.data)) {
        atomicWriteJson(metaPath, { sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, name, type: 'image' });
        return { name, type: 'image' };
      }
    }
  } catch (e) {
    appendLog(PROTOCOL_LOG_FILE, `wallpaper extraction failed: ${String(e.message || e).slice(0, 300)}`);
  }
  return null;
}

async function walkFiles(dir, relativeDir = '', result = []) {
  if (result.length >= MAX_WALLPAPER_FILES) return result;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return result; }
  for (const entry of entries) {
    if (result.length >= MAX_WALLPAPER_FILES || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) await walkFiles(full, relative, result);
    else if (entry.isFile()) {
      try { result.push({ full, relative: portableRelative(relative), stat: await fsp.stat(full) }); } catch (e) {}
    }
  }
  return result;
}

function parseWallpaperId(id) {
  if (typeof id !== 'string' || !id) return null;
  const separator = id.indexOf(':');
  if (separator < 0) return { rootIndex: 0, externalId: id, canonicalId: `0:${id}` };
  const rootIndex = Number.parseInt(id.slice(0, separator), 10);
  const externalId = id.slice(separator + 1);
  if (!Number.isInteger(rootIndex) || rootIndex < 0 || !externalId || /[\\/]/.test(externalId)) return null;
  return { rootIndex, externalId, canonicalId: `${rootIndex}:${externalId}` };
}

async function buildWallpaper(rootIndex, root, externalId) {
  const dir = path.join(root, externalId);
  if (!isDirectory(dir)) return null;
  const id = `${rootIndex}:${externalId}`;
  let title = externalId, type = '';
  try {
    const project = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8'));
    if (typeof project.title === 'string' && project.title.trim()) title = project.title.trim().slice(0, 240);
    if (typeof project.type === 'string') type = project.type;
  } catch (e) {}

  const files = await walkFiles(dir);
  const videos = files.filter((item) => ['.mp4', '.webm', '.m4v'].includes(path.extname(item.relative).toLowerCase()) && item.stat.size > 1024 * 1024)
    .sort((a, b) => b.stat.size - a.stat.size);
  const preview = files.find((item) => ['preview.jpg', 'preview.png', 'preview.gif'].includes(path.basename(item.relative).toLowerCase()));
  const hiRes = files.find((item) => ['hi-res.png', 'hi-res.jpg'].includes(path.basename(item.relative).toLowerCase()) && item.stat.size > 500 * 1024);
  let media = videos[0] ? videos[0].relative : null;
  let previewFile = hiRes ? hiRes.relative : (preview ? preview.relative : null);

  const pkgPath = path.join(dir, 'scene.pkg');
  if (!media && (type.toLowerCase() === 'scene' || !previewFile) && fileExists(pkgPath)) {
    const extracted = await extractFromPkg(pkgPath, id);
    if (extracted) {
      const cacheFile = `${CACHE_PREFIX}/${extracted.name}`;
      if (extracted.type === 'video') media = cacheFile;
      else previewFile = cacheFile;
    }
  }
  if (!media && !previewFile) return null;
  return { id, title, type, isVideo: Boolean(media), media: media || null, preview: previewFile || null };
}

async function readWallpapers(force = false) {
  const now = Date.now();
  if (!force && catalogCache && now - catalogCacheAt < 30_000) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const groups = await Promise.all(WALLPAPER_DIRS.map(async (root, rootIndex) => {
      let entries;
      try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return []; }
      const items = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const item = await buildWallpaper(rootIndex, root, entry.name);
        if (item) items.push(item);
      }
      return items;
    }));
    catalogCache = groups.flat().sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    catalogCacheAt = Date.now();
    return catalogCache;
  })().finally(() => { catalogPromise = null; });
  return catalogPromise;
}

function readSetting() { return readJson(SETTINGS_FILE); }
function writeSetting(value) {
  if (!atomicWriteJson(SETTINGS_FILE, value)) throw new Error('无法保存壁纸设置');
}

// ---- DSH server lifecycle ----

function isServerUp() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };
    const request = http.get({ host: HOST, port: PORT, path: '/', timeout: 1500, headers: { accept: 'text/html' } }, (response) => {
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      response.resume();
      response.once('end', () => finish(response.statusCode >= 200 && response.statusCode < 400 && (contentType.includes('text/html') || contentType.includes('application/xhtml'))));
    });
    request.once('timeout', () => { request.destroy(); finish(false); });
    request.once('error', () => finish(false));
  });
}

function readDshState() {
  const state = readJson(DSH_STATE_FILE);
  if (!state || !Number.isInteger(state.pid) || state.pid <= 0) return null;
  return state;
}

function processMetadata(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== 'win32') {
    try { return { commandLine: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') }; } catch (e) { return null; }
  }
  try {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\") | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
    return output ? JSON.parse(output) : null;
  } catch (e) { return null; }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function isOwnedProcess(state) {
  if (!state || !isProcessAlive(state.pid) || state.pid === process.pid) return false;
  const meta = processMetadata(state.pid);
  if (!meta || typeof meta.CommandLine !== 'string') return false;
  const command = meta.CommandLine.toLowerCase().replace(/\\/g, '/');
  const bin = path.resolve(state.bin || BIN || '').toLowerCase().replace(/\\/g, '/');
  const sameBin = Boolean(bin) && (command.includes(bin) || command.includes(path.basename(bin)));
  const isWeb = /(?:^|\s|["'])web(?:\s|$|["'])/i.test(meta.CommandLine);
  if (!sameBin || !isWeb) return false;
  if (state.processCreatedAt && meta.CreationDate && state.processCreatedAt !== meta.CreationDate) return false;
  return true;
}

function writeDshState(pid) {
  const meta = processMetadata(pid);
  atomicWriteJson(DSH_STATE_FILE, {
    pid, host: HOST, port: PORT, workspace: WORKSPACE, node: NODE, bin: BIN, command: 'web',
    processCreatedAt: meta && meta.CreationDate ? meta.CreationDate : null,
    startedAt: new Date().toISOString()
  });
}

function clearDshState(pid) {
  try {
    const state = readDshState();
    if (state && state.pid !== pid) return;
    if (fileExists(DSH_STATE_FILE)) fs.unlinkSync(DSH_STATE_FILE);
  } catch (e) {}
}

function adoptOwnedServer() {
  const state = readDshState();
  if (!state) return null;
  if (!isOwnedProcess(state)) {
    appendLog(DSH_LOG_FILE, `ignored stale or mismatched state pid=${state.pid}`);
    clearDshState(state.pid);
    return null;
  }
  dshOwnedPid = state.pid;
  appendLog(DSH_LOG_FILE, `adopted existing pid=${state.pid}`);
  return state.pid;
}

function startServer() {
  if (!BIN || !NODE) return null;
  if (!ensureDirectory(WORKSPACE)) { lastServerError = '工作目录不可用'; return null; }
  if (dshChild && !dshChild.killed && isProcessAlive(dshChild.pid)) return dshChild;

  rotateLog(DSH_LOG_FILE);
  const log = fs.createWriteStream(DSH_LOG_FILE, { flags: 'a' });
  let child;
  try {
    child = spawn(NODE, [BIN, 'web', '--host', HOST, '--port', String(PORT)], {
      cwd: WORKSPACE, detached: false, stdio: ['ignore', log, log], windowsHide: true
    });
  } catch (error) {
    lastServerError = `启动进程失败: ${error.message}`;
    appendLog(DSH_LOG_FILE, lastServerError);
    log.end();
    return null;
  }

  dshChild = child;
  dshOwnedPid = child.pid || null;
  if (dshOwnedPid) writeDshState(dshOwnedPid);
  appendLog(DSH_LOG_FILE, `started pid=${dshOwnedPid || 'unknown'} workspace=${WORKSPACE}`);
  child.once('error', (error) => { lastServerError = `DSH 进程错误: ${error.message}`; appendLog(DSH_LOG_FILE, lastServerError); });
  child.once('exit', (code, signal) => {
    appendLog(DSH_LOG_FILE, `exited pid=${child.pid || 'unknown'} code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    clearDshState(child.pid);
    if (dshChild === child) dshChild = null;
    if (dshOwnedPid === child.pid) dshOwnedPid = null;
    log.end();
  });
  return child;
}

function killServerProcess(pid, forceOwned = false) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  const state = readDshState();
  if (!forceOwned && !isOwnedProcess(state)) {
    appendLog(DSH_LOG_FILE, `refused to stop unverified pid=${pid}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearDshState(pid);
      if (dshChild && dshChild.pid === pid) dshChild = null;
      if (dshOwnedPid === pid) dshOwnedPid = null;
      resolve();
    };
    if (!isProcessAlive(pid)) return finish();
    try { process.kill(pid); } catch (e) {}
    setTimeout(() => {
      if (!isProcessAlive(pid)) return finish();
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('close', finish); killer.once('error', finish);
      } else {
        try { process.kill(pid, 'SIGKILL'); } catch (e) {}
        finish();
      }
    }, 1500);
  });
}

function stopServer() {
  if (dshStopping) return dshStopping;
  const pid = dshChild?.pid || dshOwnedPid || readDshState()?.pid;
  const forceOwned = Boolean(dshChild && dshChild.pid === pid);
  dshStopping = killServerProcess(pid, forceOwned).finally(() => { dshStopping = null; });
  return dshStopping;
}

async function ensureServer() {
  lastServerError = '';
  if (await isServerUp()) {
    if (adoptOwnedServer() === null) appendLog(DSH_LOG_FILE, 'using an existing unowned server on the configured port');
    return true;
  }
  if (!BIN || !NODE) { lastServerError = '没有找到 Node.js 或 DSH 安装'; return false; }
  const child = startServer();
  if (!child) return false;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await isServerUp()) return true;
    if (child.exitCode !== null) break;
  }
  lastServerError = lastServerError || 'DSH 服务在 40 秒内没有响应';
  await stopServer();
  return false;
}

// ---- wallpaper protocol ----

function resolveWallpaperFile(id, file) {
  const parsed = parseWallpaperId(id);
  if (!parsed || parsed.rootIndex >= WALLPAPER_DIRS.length || !file || file.includes('\0')) return null;
  const sourceItemRoot = path.resolve(WALLPAPER_DIRS[parsed.rootIndex], parsed.externalId);
  let baseRoot = sourceItemRoot;
  let full;
  const cachePath = `${CACHE_PREFIX}/`;
  if (file === CACHE_PREFIX || file.startsWith(cachePath)) {
    baseRoot = cacheDirForId(parsed.canonicalId);
    full = path.resolve(baseRoot, file.slice(cachePath.length));
  } else full = path.resolve(sourceItemRoot, file);

  try {
    const realBase = fs.realpathSync(baseRoot);
    const realFull = fs.realpathSync(full);
    if (!isPathInside(realBase, realFull) || !fs.statSync(realFull).isFile()) return null;
    const ext = path.extname(realFull).toLowerCase();
    if (!MIME[ext]) return null;
    return { full: realFull, mime: MIME[ext], stat: fs.statSync(realFull) };
  } catch (e) { return null; }
}

function streamFile(full, start, end) {
  const stream = fs.createReadStream(full, { start, end });
  return typeof Readable.toWeb === 'function' ? Readable.toWeb(stream) : new ReadableStream({
    start(controller) { stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk))); stream.on('end', () => controller.close()); stream.on('error', (error) => controller.error(error)); },
    cancel() { stream.destroy(); }
  });
}

function registerWallpaperProtocol() {
  protocol.handle('wallpaper', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'local') return new Response('Not found', { status: 404 });
      const parts = url.pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts.shift() || '');
      const file = decodeURIComponent(parts.join('/'));
      const resolved = resolveWallpaperFile(id, file);
      if (!resolved) {
        appendLog(PROTOCOL_LOG_FILE, `404 ${request.url}`);
        return new Response('Not found', { status: 404 });
      }
      const total = resolved.stat.size;
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const range = parseRange(rangeHeader, total);
        if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
        return new Response(streamFile(resolved.full, range.start, range.end), {
          status: 206,
          headers: {
            'content-type': resolved.mime, 'content-length': String(range.length),
            'content-range': `bytes ${range.start}-${range.end}/${total}`,
            'accept-ranges': 'bytes', 'cache-control': 'no-cache'
          }
        });
      }
      return new Response(total ? streamFile(resolved.full, 0, total - 1) : null, {
        status: 200,
        headers: { 'content-type': resolved.mime, 'content-length': String(total), 'accept-ranges': 'bytes', 'cache-control': 'no-cache' }
      });
    } catch (error) {
      appendLog(PROTOCOL_LOG_FILE, `ERR ${request.url} ${(error && error.message) || error}`);
      return new Response('Error', { status: 500 });
    }
  });
}

// ---- IPC and window ----

function isAppUrl(raw) {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'http:' && hostname === HOST && Number(url.port || 80) === PORT;
  } catch (e) { return false; }
}

function isTrustedIpc(event) {
  const url = event && event.senderFrame ? event.senderFrame.url : '';
  return isAppUrl(url) || url.startsWith('file://');
}

function openExternalSafe(raw) {
  try {
    const url = new URL(raw);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) shell.openExternal(url.toString());
  } catch (e) {}
}

function registerIpc() {
  ipcMain.handle('wallpaper:list', (event, options) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    return readWallpapers(Boolean(options && options.force));
  });
  ipcMain.handle('wallpaper:get', async (event) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    const setting = readSetting();
    if (setting && typeof setting.id === 'string' && !setting.id.includes(':')) {
      const match = (await readWallpapers()).find((item) => item.id.endsWith(`:${setting.id}`));
      if (match) return { id: match.id };
    }
    return setting;
  });
  ipcMain.handle('wallpaper:set', async (event, id) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    if (id !== null && typeof id !== 'string') throw new Error('Invalid wallpaper id');
    if (id && !(await readWallpapers()).some((item) => item.id === id)) throw new Error('Unknown wallpaper id');
    writeSetting(id ? { id } : null);
    return readSetting();
  });
  ipcMain.handle('wallpaper:status', (event) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    return { configured: WALLPAPER_DIRS.length > 0, roots: WALLPAPER_DIRS.length };
  });
  ipcMain.handle('wallpaper:ping', (event) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    appendLog(INJECT_LOG_FILE, 'injected'); return 'pong';
  });
  ipcMain.handle('app:retry', async (event) => {
    if (!isTrustedIpc(event)) throw new Error('Untrusted IPC sender');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await loadApp(win);
    return true;
  });
}

async function showError(win) {
  await win.loadFile(path.join(__dirname, 'error.html'));
  const message = JSON.stringify(lastServerError || '无法连接到 DeepSeek Harness 服务');
  try { await win.webContents.executeJavaScript(`window.setStartupError && window.setStartupError(${message})`); } catch (e) {}
}

async function loadApp(win) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await win.loadFile(path.join(__dirname, 'loading.html'));
    if (await ensureServer()) await win.loadURL(APP_URL);
    else await showError(win);
  })().catch(async (error) => {
    lastServerError = error.message || String(error);
    try { await showError(win); } catch (ignored) {}
  }).finally(() => { loadPromise = null; });
  return loadPromise;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 800, minHeight: 600,
    title: 'DeepSeek Harness Desktop', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow = win;
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) { event.preventDefault(); openExternalSafe(url); } });

  function injectWallpaperUI() {
    if (!isAppUrl(win.webContents.getURL())) return;
    fs.readFile(path.join(__dirname, 'wallpaper-ui.js'), 'utf8', (error, code) => {
      if (!error) win.webContents.executeJavaScript(code).catch(() => {});
    });
  }
  win.webContents.on('did-finish-load', injectWallpaperUI);
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  await loadApp(win);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    registerWallpaperProtocol(); registerIpc(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((error) => { appendLog(DSH_LOG_FILE, `Electron startup error: ${error.message || error}`); app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    stopServer().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
