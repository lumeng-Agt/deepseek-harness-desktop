'use strict';

const { app, BrowserWindow, dialog, shell, ipcMain, protocol } = require('electron');
const { execFileSync, spawn } = require('child_process');
const { Readable } = require('stream');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const cfg = require('./config.js');
const { atomicWriteFile } = require('./lib/atomic-file.js');
const { appendLog, createRedactingLogStream, redactDiagnostic, rotateLog } = require('./lib/diagnostics.js');
const { isPathInside, parseRange, portableRelative } = require('./lib/path-utils.js');
const { isOwnedProcess, isProcessAlive, processMetadata } = require('./lib/process-utils.js');
const { RecoveryGate } = require('./lib/recovery.js');
const { hasDshBootSignature, isDshRpcResponse } = require('./lib/dsh-probe.js');
const { checkMinimumVersion } = require('./lib/version-utils.js');
const { makeWallpaperId, parseWallpaperId, rootKey } = require('./lib/wallpaper-ids.js');
const { findWallpaperDirs, resetSteamRootsCache } = require('./path-discovery.js');

const HOST = cfg.HOST;
const PORT = cfg.PORT;
const APP_URL = `http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`;
const NODE = cfg.NODE;
const BIN = cfg.DSH_BIN;
const INITIAL_WALLPAPER_DIRS = (cfg.WALLPAPER_DIRS || (cfg.WALLPAPER_DIR ? [cfg.WALLPAPER_DIR] : [])).filter(Boolean);
const WORKSPACE = cfg.WORKSPACE;
const WRAPPER_VERSION = require('./package.json').version;
const MIN_DSH_VERSION = cfg.MIN_DSH_VERSION || '0.1.0-rc.6';
const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'wallpaper.json');
const WALLPAPER_PATHS_FILE = path.join(USER_DATA, 'wallpaper-paths.json');
const DSH_STATE_FILE = path.join(USER_DATA, 'dsh-server.json');
const DSH_LOG_FILE = path.join(USER_DATA, 'dsh-web.log');
const PROTOCOL_LOG_FILE = path.join(USER_DATA, 'protocol.log');
const INJECT_LOG_FILE = path.join(USER_DATA, 'inject.log');
const WALLPAPER_CACHE_DIR = path.join(USER_DATA, 'wallpaper-cache');
const CACHE_PREFIX = '__dsh_cache__';
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_SCENE_PKG_BYTES = 512 * 1024 * 1024;
const MAX_WALLPAPER_FILES = 5000;
const MAX_SERVER_PROBE_BYTES = 512 * 1024;
const SERVER_PROBE_TIMEOUT_MS = 1500;
const WALLPAPER_SCAN_CONCURRENCY = 2;
const MAX_WALLPAPER_CACHE_BYTES = 1024 * 1024 * 1024;
const MAX_WALLPAPER_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SERVER_WATCHDOG_INTERVAL_MS = 15 * 1000;
const RECOVERY_DELAYS_MS = [0, 1000, 3000, 8000];

let dshChild = null;
let dshOwnedPid = null;
let dshStopping = null;
let quitting = false;
let mainWindow = null;
let loadPromise = null;
let catalogCache = null;
let catalogCacheAt = 0;
let catalogPromise = null;
let wallpaperScanCache = new Map();
let packageExtractionTail = Promise.resolve();
let lastServerError = '';
let wallpaperDirs = [];
let manualWallpaperDirs = [];
let serverWatchdog = null;
let serverRecovery = null;
let rendererRecoveryTimer = null;
let dshVersion = undefined;
const recoveryGate = new RecoveryGate(60_000);

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

function atomicWriteJson(file, value) {
  return atomicWriteFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function uniqueDirectories(paths) {
  const result = [];
  const seen = new Set();
  for (const value of paths || []) {
    if (!value || !isDirectory(value)) continue;
    const resolved = path.resolve(value);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) { seen.add(key); result.push(resolved); }
  }
  return result;
}

function loadManualWallpaperDirs() {
  const saved = readJson(WALLPAPER_PATHS_FILE);
  return Array.isArray(saved?.roots) ? uniqueDirectories(saved.roots) : [];
}

function initializeWallpaperDirs() {
  manualWallpaperDirs = loadManualWallpaperDirs();
  return uniqueDirectories([...INITIAL_WALLPAPER_DIRS, ...manualWallpaperDirs]);
}

function persistManualWallpaperDirs() {
  if (!atomicWriteJson(WALLPAPER_PATHS_FILE, { roots: manualWallpaperDirs })) {
    throw new Error('无法保存壁纸目录设置');
  }
}

function invalidateWallpaperCatalog() {
  catalogCache = null;
  catalogCacheAt = 0;
  wallpaperScanCache = new Map();
}

function refreshWallpaperDirs() {
  resetSteamRootsCache();
  wallpaperDirs = uniqueDirectories([...findWallpaperDirs(), ...manualWallpaperDirs]);
  invalidateWallpaperCatalog();
  return wallpaperDirs;
}

function addWallpaperDir(directory) {
  const resolved = path.resolve(directory);
  if (!isDirectory(resolved)) throw new Error('壁纸目录不存在');
  manualWallpaperDirs = uniqueDirectories([...manualWallpaperDirs, resolved]);
  persistManualWallpaperDirs();
  refreshWallpaperDirs();
  return resolved;
}

function removeWallpaperDir(directory) {
  const resolved = path.resolve(directory);
  manualWallpaperDirs = manualWallpaperDirs.filter((item) => {
    const left = process.platform === 'win32' ? item.toLowerCase() : item;
    const right = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    return left !== right;
  });
  persistManualWallpaperDirs();
  refreshWallpaperDirs();
  return wallpaperDirs;
}

wallpaperDirs = initializeWallpaperDirs();

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

async function directorySize(directory) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch (error) { return 0; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    try {
      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) total += await directorySize(full);
      else if (stat.isFile()) total += stat.size;
    } catch (error) {}
  }
  return total;
}

let cachePrunePromise = null;

async function pruneWallpaperCache() {
  if (cachePrunePromise) return cachePrunePromise;
  cachePrunePromise = (async () => {
    if (!ensureDirectory(WALLPAPER_CACHE_DIR)) return;
    let entries;
    try { entries = await fsp.readdir(WALLPAPER_CACHE_DIR, { withFileTypes: true }); } catch (error) { return; }
    const now = Date.now();
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(WALLPAPER_CACHE_DIR, entry.name);
      try {
        const stat = await fsp.lstat(full);
        if (stat.isSymbolicLink()) continue;
        const size = await directorySize(full);
        if (now - stat.mtimeMs > MAX_WALLPAPER_CACHE_AGE_MS) {
          await fsp.rm(full, { recursive: true, force: true });
        } else {
          items.push({ full, size, mtimeMs: stat.mtimeMs });
        }
      } catch (error) {}
    }
    let total = items.reduce((sum, item) => sum + item.size, 0);
    if (total <= MAX_WALLPAPER_CACHE_BYTES) return;
    items.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of items) {
      if (total <= MAX_WALLPAPER_CACHE_BYTES) break;
      try { await fsp.rm(item.full, { recursive: true, force: true }); total -= item.size; } catch (error) {}
    }
  })().finally(() => { cachePrunePromise = null; });
  return cachePrunePromise;
}

async function clearWallpaperCache() {
  await fsp.rm(WALLPAPER_CACHE_DIR, { recursive: true, force: true });
  invalidateWallpaperCatalog();
  return true;
}

function atomicWriteBuffer(file, data) {
  return atomicWriteFile(file, data, { mode: 0o600 });
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

async function extractFromPkgInternal(pkgPath, id) {
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

// Scene packages can be hundreds of megabytes. Keep extraction out of the
// scan's parallel work so several large buffers cannot accumulate in the
// Electron main process at once.
async function extractFromPkg(pkgPath, id) {
  const previous = packageExtractionTail;
  let release;
  packageExtractionTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await extractFromPkgInternal(pkgPath, id); }
  finally { release(); }
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

async function buildWallpaper(rootIndex, root, externalId, allowExtraction = false) {
  const dir = path.join(root, externalId);
  if (!isDirectory(dir)) return null;
  const id = makeWallpaperId(root, externalId);
  if (!id) return null;
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
  const hasScenePackage = fileExists(pkgPath);
  if (allowExtraction && !media && (type.toLowerCase() === 'scene' || !previewFile) && hasScenePackage) {
    const extracted = await extractFromPkg(pkgPath, id);
    if (extracted) {
      const cacheFile = `${CACHE_PREFIX}/${extracted.name}`;
      if (extracted.type === 'video') media = cacheFile;
      else previewFile = cacheFile;
    }
  }
  if (!media && !previewFile && !hasScenePackage) return null;
  return {
    id, title, type, externalId, rootKey: rootKey(root), isVideo: Boolean(media), media: media || null, preview: previewFile || null,
    canPrepare: Boolean(hasScenePackage && !media && !previewFile)
  };
}

async function mapLimit(items, limit, mapper) {
  const values = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { values[index] = await mapper(items[index], index); }
      catch (error) {
        values[index] = null;
        appendLog(PROTOCOL_LOG_FILE, `wallpaper scan failed: ${error.message || error}`);
      }
    }
  };
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return values;
}

async function readWallpapers(force = false) {
  const now = Date.now();
  if (!force && catalogCache && now - catalogCacheAt < 30_000) return catalogCache;
  if (force) invalidateWallpaperCatalog();
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const jobs = [];
    await Promise.all(wallpaperDirs.map(async (root, rootIndex) => {
      let entries;
      try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          const directory = path.join(root, entry.name);
          try {
            const stat = await fsp.stat(directory);
            jobs.push({ rootIndex, root, id: entry.name, stableId: makeWallpaperId(root, entry.name), fingerprint: `${stat.mtimeMs}:${stat.size}` });
          } catch (e) {}
        }
      }
    }));
    const seen = new Set(jobs.map((job) => job.stableId).filter(Boolean));
    for (const key of wallpaperScanCache.keys()) if (!seen.has(key)) wallpaperScanCache.delete(key);
    const items = await mapLimit(jobs, WALLPAPER_SCAN_CONCURRENCY, async (job) => {
      const cached = wallpaperScanCache.get(job.stableId);
      if (cached && cached.fingerprint === job.fingerprint) return cached.item;
      const item = await buildWallpaper(job.rootIndex, job.root, job.id, false);
      wallpaperScanCache.set(job.stableId, { fingerprint: job.fingerprint, item });
      return item;
    });
    catalogCache = items.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    catalogCacheAt = Date.now();
    return catalogCache;
  })().finally(() => { catalogPromise = null; });
  return catalogPromise;
}

function resolveWallpaperTarget(id) {
  const parsed = parseWallpaperId(id);
  if (!parsed) return null;
  let rootIndex = -1;
  if (parsed.kind === 'stable') {
    rootIndex = wallpaperDirs.findIndex((root) => rootKey(root) === parsed.rootKey);
  } else if (Number.isInteger(parsed.rootIndex)) {
    rootIndex = parsed.rootIndex;
  }
  if (rootIndex < 0 || rootIndex >= wallpaperDirs.length) return null;
  const root = wallpaperDirs[rootIndex];
  const canonicalId = makeWallpaperId(root, parsed.externalId);
  if (!canonicalId) return null;
  return { rootIndex, root, externalId: parsed.externalId, canonicalId };
}

function findWallpaperItem(id, items) {
  if (!Array.isArray(items)) return null;
  const exact = items.find((item) => item.id === id);
  if (exact) return exact;
  const parsed = parseWallpaperId(id);
  const target = resolveWallpaperTarget(id);
  const migrated = target ? items.find((item) => item.id === target.canonicalId) : null;
  if (migrated) return migrated;
  // Old releases encoded the root array index. If the root order changed,
  // recover an unambiguous match by the Wallpaper Engine external ID.
  if (parsed && (parsed.kind === 'legacy-index' || parsed.kind === 'legacy-bare')) {
    const candidates = items.filter((item) => item.externalId === parsed.externalId);
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

async function prepareWallpaper(id) {
  const target = resolveWallpaperTarget(id);
  if (!target) return null;
  const item = await buildWallpaper(target.rootIndex, target.root, target.externalId, true);
  if (!item) return null;
  if (catalogCache) {
    const index = catalogCache.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) catalogCache[index] = item;
    else catalogCache.push(item);
    catalogCache.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }
  wallpaperScanCache.delete(item.id);
  await pruneWallpaperCache();
  return item;
}

function readSetting() { return readJson(SETTINGS_FILE); }
function writeSetting(value) {
  if (!atomicWriteJson(SETTINGS_FILE, value)) throw new Error('无法保存壁纸设置');
}

// ---- DSH server lifecycle ----

function requestServer(method, requestPath, body, accept) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const payload = body === undefined || body === null ? null : Buffer.from(String(body));
    const headers = { accept: accept || '*/*' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
    const request = http.request({ host: HOST, port: PORT, method, path: requestPath, timeout: SERVER_PROBE_TIMEOUT_MS, headers }, (response) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      response.on('data', (chunk) => {
        if (size >= MAX_SERVER_PROBE_BYTES) { truncated = true; return; }
        const remaining = MAX_SERVER_PROBE_BYTES - size;
        const part = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        chunks.push(part); size += part.length;
        if (part.length < chunk.length) truncated = true;
      });
      response.once('aborted', () => finish({ reachable: true, statusCode: response.statusCode || 0, contentType: String(response.headers['content-type'] || ''), body: '', truncated: true }));
      response.once('error', () => finish({ reachable: true, statusCode: response.statusCode || 0, contentType: String(response.headers['content-type'] || ''), body: '', truncated: true }));
      response.once('end', () => finish({
        reachable: true,
        statusCode: response.statusCode || 0,
        contentType: String(response.headers['content-type'] || ''),
        body: Buffer.concat(chunks).toString('utf8'),
        truncated
      }));
    });
    request.once('timeout', () => { request.destroy(); finish({ reachable: false, error: 'timeout' }); });
    request.once('error', (error) => finish({ reachable: false, error: error.message || String(error) }));
    request.end(payload || undefined);
  });
}

async function probeDshServer() {
  const page = await requestServer('GET', '/', null, 'text/html,application/xhtml+xml');
  if (!page.reachable) return { reachable: false, isDsh: false, reason: page.error || '服务不可达' };
  const htmlOk = page.statusCode >= 200 && page.statusCode < 400 && /html|xhtml/i.test(page.contentType);
  if (!htmlOk || !hasDshBootSignature(page.body)) return { reachable: true, isDsh: false, reason: '端口服务不是可识别的 DSH' };

  // The boot page identifies the product; this harmless RPC confirms that
  // the HTTP API behind it is also DSH before the wrapper uses the port.
  const probeBody = JSON.stringify({ type: 'client-request', rpcId: `dshgui-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`, method: 'session.list', payload: {} });
  const api = await requestServer('POST', '/api/session.list', probeBody, 'application/json');
  const apiOk = api.reachable && api.statusCode >= 200 && api.statusCode < 300 && isDshRpcResponse(api.body);
  return { reachable: true, isDsh: apiOk, reason: apiOk ? '' : 'DSH Web 页面存在，但 API 未通过身份校验' };
}

async function isServerUp() {
  return (await probeDshServer()).isDsh;
}

function readDshState() {
  const state = readJson(DSH_STATE_FILE);
  if (!state || !Number.isInteger(state.pid) || state.pid <= 0) return null;
  return state;
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
  if (!isOwnedProcess(state, BIN)) {
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

  rotateLog(DSH_LOG_FILE, MAX_LOG_BYTES);
  const stdoutLog = createRedactingLogStream(DSH_LOG_FILE, MAX_LOG_BYTES);
  const stderrLog = createRedactingLogStream(DSH_LOG_FILE, MAX_LOG_BYTES);
  let child;
  try {
    child = spawn(NODE, [BIN, 'web', '--host', HOST, '--port', String(PORT)], {
      cwd: WORKSPACE, detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
  } catch (error) {
    lastServerError = `启动进程失败: ${error.message}`;
    appendLog(DSH_LOG_FILE, lastServerError);
    stdoutLog.end();
    stderrLog.end();
    return null;
  }

  if (child.stdout) child.stdout.pipe(stdoutLog);
  if (child.stderr) child.stderr.pipe(stderrLog);

  dshChild = child;
  dshOwnedPid = child.pid || null;
  if (dshOwnedPid) writeDshState(dshOwnedPid);
  appendLog(DSH_LOG_FILE, `started pid=${dshOwnedPid || 'unknown'} version=${getDshVersion() || 'unknown'} workspace=${WORKSPACE}`);
  child.once('error', (error) => { lastServerError = `DSH 进程错误: ${error.message}`; appendLog(DSH_LOG_FILE, lastServerError); });
  child.once('exit', (code, signal) => {
    appendLog(DSH_LOG_FILE, `exited pid=${child.pid || 'unknown'} code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    clearDshState(child.pid);
    if (dshChild === child) dshChild = null;
    if (dshOwnedPid === child.pid) dshOwnedPid = null;
    stdoutLog.end();
    stderrLog.end();
    if (!quitting && mainWindow) void recoverWindow(mainWindow, 'dsh-exit');
  });
  return child;
}

function killServerProcess(pid, forceOwned = false) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  const state = readDshState();
  if (!forceOwned && !isOwnedProcess(state, BIN)) {
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
  const existing = await probeDshServer();
  if (existing.isDsh) {
    if (!ensureDshVersionCompatible()) {
      appendLog(DSH_LOG_FILE, lastServerError);
      return false;
    }
    if (adoptOwnedServer() === null) appendLog(DSH_LOG_FILE, 'using an existing unowned server on the configured port');
    return true;
  }
  if (existing.reachable) {
    lastServerError = existing.reason || '配置端口已有服务，但不是 DSH';
    appendLog(DSH_LOG_FILE, `refusing configured port: ${lastServerError}`);
    return false;
  }
  if (!BIN || !NODE) { lastServerError = '没有找到 Node.js 或 DSH 安装'; return false; }
  const child = startServer();
  if (!child) return false;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await isServerUp()) {
      if (!ensureDshVersionCompatible()) {
        appendLog(DSH_LOG_FILE, lastServerError);
        await stopServer();
        return false;
      }
      return true;
    }
    if (child.exitCode !== null) break;
  }
  lastServerError = lastServerError || 'DSH 服务在 40 秒内没有响应';
  await stopServer();
  return false;
}

function getDshVersion() {
  if (dshVersion !== undefined) return dshVersion;
  dshVersion = null;
  if (!BIN || !NODE) return dshVersion;
  try {
    const output = execFileSync(NODE, [BIN, '--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    if (output) dshVersion = output.split(/\r?\n/)[0].slice(0, 120);
  } catch (error) {}
  return dshVersion;
}

function getRuntimeStatus(server) {
  const dshVersionValue = getDshVersion();
  const compatibility = checkMinimumVersion(dshVersionValue, MIN_DSH_VERSION);
  return {
    wrapperVersion: WRAPPER_VERSION,
    dshVersion: dshVersionValue,
    minDshVersion: MIN_DSH_VERSION,
    dshCompatible: compatibility.compatible,
    dshCompatibilityReason: compatibility.reason,
    server: server?.isDsh ? 'ready' : (server?.reachable ? 'conflict' : 'offline'),
    serverReason: redactDiagnostic(server?.reason || ''),
    wallpaperRoots: wallpaperDirs.length,
    port: PORT
  };
}

function ensureDshVersionCompatible() {
  const compatibility = checkMinimumVersion(getDshVersion(), MIN_DSH_VERSION);
  if (compatibility.compatible === false) {
    lastServerError = `DSH 版本过低：当前 ${getDshVersion() || '未知'}，需要 ${MIN_DSH_VERSION} 或更高版本`;
    return false;
  }
  return true;
}

async function recoverWindow(win, reason) {
  if (quitting || !win || win.isDestroyed()) return;
  if (serverRecovery) return serverRecovery;
  if (!recoveryGate.tryStart()) return false;
  let succeeded = false;
  serverRecovery = (async () => {
    appendLog(DSH_LOG_FILE, `recovery started reason=${reason || 'unknown'}`);
    for (const delay of RECOVERY_DELAYS_MS) {
      if (quitting || win.isDestroyed()) return;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      await loadApp(win);
      let appReady = false;
      try { appReady = isAppUrl(win.webContents.getURL()); } catch (error) {}
      if (appReady && (await probeDshServer()).isDsh && ensureDshVersionCompatible()) {
        appendLog(DSH_LOG_FILE, 'recovery succeeded');
        succeeded = true;
        return true;
      }
    }
    appendLog(DSH_LOG_FILE, 'recovery exhausted');
    return false;
  })().catch((error) => {
    appendLog(DSH_LOG_FILE, `recovery failed: ${error.message || error}`);
    return false;
  }).finally(() => {
    recoveryGate.finish(succeeded);
    serverRecovery = null;
  });
  return serverRecovery;
}

function stopServerWatchdog() {
  if (serverWatchdog) {
    clearInterval(serverWatchdog);
    serverWatchdog = null;
  }
  if (rendererRecoveryTimer) {
    clearTimeout(rendererRecoveryTimer);
    rendererRecoveryTimer = null;
  }
}

function startServerWatchdog(win) {
  if (serverWatchdog) clearInterval(serverWatchdog);
  const check = async () => {
    if (quitting || !win || win.isDestroyed() || serverRecovery) return;
    if (!recoveryGate.canStart()) return;
    try {
      const status = await probeDshServer();
      if (!status.isDsh) {
        appendLog(DSH_LOG_FILE, `watchdog detected server problem: ${status.reason || status.error || 'unknown'}`);
        void recoverWindow(win, 'watchdog');
      }
    } catch (error) {
      appendLog(DSH_LOG_FILE, `watchdog failed: ${error.message || error}`);
    }
  };
  serverWatchdog = setInterval(check, SERVER_WATCHDOG_INTERVAL_MS);
}

// ---- wallpaper protocol ----

function resolveWallpaperFile(id, file) {
  const target = resolveWallpaperTarget(id);
  if (!target || !file || file.includes('\0')) return null;
  const sourceItemRoot = path.resolve(target.root, target.externalId);
  let baseRoot = sourceItemRoot;
  let full;
  const cachePath = `${CACHE_PREFIX}/`;
  if (file === CACHE_PREFIX || file.startsWith(cachePath)) {
    baseRoot = cacheDirForId(target.canonicalId);
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
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      const url = new URL(request.url);
      if (url.hostname !== 'local') return new Response('Not found', { status: 404 });
      const parts = url.pathname.split('/').filter(Boolean);
      let id;
      let file;
      try {
        id = decodeURIComponent(parts.shift() || '');
        file = decodeURIComponent(parts.join('/'));
      } catch (error) {
        appendLog(PROTOCOL_LOG_FILE, '400 malformed wallpaper URI');
        return new Response('Bad request', { status: 400 });
      }
      const resolved = resolveWallpaperFile(id, file);
      if (!resolved) {
        appendLog(PROTOCOL_LOG_FILE, `404 wallpaper resource method=${request.method}`);
        return new Response('Not found', { status: 404 });
      }
      const total = resolved.stat.size;
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const range = parseRange(rangeHeader, total);
        if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
        return new Response(request.method === 'HEAD' ? null : streamFile(resolved.full, range.start, range.end), {
          status: 206,
          headers: {
            'content-type': resolved.mime, 'content-length': String(range.length),
            'content-range': `bytes ${range.start}-${range.end}/${total}`,
            'accept-ranges': 'bytes', 'cache-control': 'no-cache'
          }
        });
      }
      return new Response(request.method === 'HEAD' || !total ? null : streamFile(resolved.full, 0, total - 1), {
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

const TRUSTED_RETRY_PAGES = new Set([
  pathToFileURL(path.join(__dirname, 'loading.html')).href,
  pathToFileURL(path.join(__dirname, 'error.html')).href
]);

function senderUrl(event) {
  return event && event.senderFrame ? event.senderFrame.url : '';
}

function isTrustedAppIpc(event) {
  return isAppUrl(senderUrl(event));
}

function isTrustedRetryIpc(event) {
  const url = senderUrl(event);
  if (isAppUrl(url)) return true;
  try { return TRUSTED_RETRY_PAGES.has(new URL(url).href); } catch (e) { return false; }
}

function openExternalSafe(raw) {
  try {
    const url = new URL(raw);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) shell.openExternal(url.toString());
  } catch (e) {}
}

function registerIpc() {
  ipcMain.handle('wallpaper:list', (event, options) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    return readWallpapers(Boolean(options && options.force));
  });
  ipcMain.handle('wallpaper:get', async (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    const setting = readSetting();
    if (!setting || typeof setting.id !== 'string') return null;
    const match = findWallpaperItem(setting.id, await readWallpapers());
    if (!match) return null;
    if (match.id !== setting.id) writeSetting({ id: match.id });
    return { id: match.id };
  });
  ipcMain.handle('wallpaper:prepare', async (event, id) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    const match = typeof id === 'string' ? findWallpaperItem(id, await readWallpapers()) : null;
    if (!match) throw new Error('Unknown wallpaper id');
    return prepareWallpaper(match.id);
  });
  ipcMain.handle('wallpaper:set', async (event, id) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    if (id !== null && typeof id !== 'string') throw new Error('Invalid wallpaper id');
    const match = id ? findWallpaperItem(id, await readWallpapers()) : null;
    if (id && !match) throw new Error('Unknown wallpaper id');
    writeSetting(match ? { id: match.id } : null);
    return readSetting();
  });
  ipcMain.handle('wallpaper:roots', (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    return { roots: [...wallpaperDirs], manual: [...manualWallpaperDirs] };
  });
  ipcMain.handle('wallpaper:choose-root', async (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, roots: [...wallpaperDirs] };
    addWallpaperDir(result.filePaths[0]);
    return { canceled: false, selected: result.filePaths[0], roots: [...wallpaperDirs] };
  });
  ipcMain.handle('wallpaper:remove-root', (event, directory) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('Invalid wallpaper directory');
    return removeWallpaperDir(directory.trim());
  });
  ipcMain.handle('wallpaper:rescan', async (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    refreshWallpaperDirs();
    return readWallpapers(true);
  });
  ipcMain.handle('wallpaper:clear-cache', async (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    return clearWallpaperCache();
  });
  ipcMain.handle('wallpaper:status', (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    const compatibility = checkMinimumVersion(getDshVersion(), MIN_DSH_VERSION);
    return {
      configured: wallpaperDirs.length > 0, roots: wallpaperDirs.length,
      wrapperVersion: WRAPPER_VERSION, dshVersion: getDshVersion(), minDshVersion: MIN_DSH_VERSION,
      dshCompatible: compatibility.compatible
    };
  });
  ipcMain.handle('wallpaper:ping', (event) => {
    if (!isTrustedAppIpc(event)) throw new Error('Untrusted IPC sender');
    appendLog(INJECT_LOG_FILE, 'injected'); return 'pong';
  });
  ipcMain.handle('app:retry', async (event) => {
    if (!isTrustedRetryIpc(event)) throw new Error('Untrusted IPC sender');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await loadApp(win);
    return true;
  });
  ipcMain.handle('app:status', async (event) => {
    if (!isTrustedRetryIpc(event)) throw new Error('Untrusted IPC sender');
    const server = await probeDshServer();
    return getRuntimeStatus(server);
  });
  ipcMain.handle('app:diagnostics', async (event) => {
    if (!isTrustedRetryIpc(event)) throw new Error('Untrusted IPC sender');
    const server = await probeDshServer();
    const status = getRuntimeStatus(server);
    return [
      `DeepSeek Harness Desktop ${status.wrapperVersion}`,
      `DSH Runtime ${status.dshVersion || '未检测到'}`,
      `最低 DSH 版本 ${status.minDshVersion}`,
      `服务状态 ${status.server}`,
      `兼容状态 ${status.dshCompatible === true ? '正常' : (status.dshCompatible === false ? '版本过低' : '无法确认')}`,
      `错误 ${redactDiagnostic(lastServerError || status.serverReason || '无')}`,
      `壁纸目录 ${status.wallpaperRoots}`,
      `端口 ${status.port}`
    ].join('\n');
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
  const blockExternalNavigation = (event, url) => {
    if (!isAppUrl(url)) { event.preventDefault(); openExternalSafe(url); }
  };
  win.webContents.on('will-navigate', blockExternalNavigation);
  win.webContents.on('will-redirect', blockExternalNavigation);
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) appendLog(DSH_LOG_FILE, `web load failed code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    appendLog(DSH_LOG_FILE, `renderer exited reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'null'}`);
    if (!quitting && mainWindow === win) {
      if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
      rendererRecoveryTimer = setTimeout(() => {
        rendererRecoveryTimer = null;
        void recoverWindow(win, 'renderer-exit');
      }, 1000);
    }
  });

  function injectWallpaperUI() {
    if (!isAppUrl(win.webContents.getURL())) return;
    fs.readFile(path.join(__dirname, 'wallpaper-ui.js'), 'utf8', (error, code) => {
      if (error) { appendLog(INJECT_LOG_FILE, `read failed: ${error.message || error}`); return; }
      win.webContents.executeJavaScript(code).catch((injectionError) => {
        appendLog(INJECT_LOG_FILE, `execute failed: ${injectionError.message || injectionError}`);
      });
    });
  }
  win.webContents.on('did-finish-load', injectWallpaperUI);
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      stopServerWatchdog();
    }
  });
  await loadApp(win);
  startServerWatchdog(win);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    void pruneWallpaperCache();
    registerWallpaperProtocol(); registerIpc(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((error) => { appendLog(DSH_LOG_FILE, `Electron startup error: ${error.message || error}`); app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true; stopServerWatchdog();
    stopServer().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
