'use strict';
/**
 * 路径自动检测与配置。
 * 所有路径都从环境/常见位置自动探测，不再硬编码用户机器特有的绝对路径。
 * 用户可通过环境变量覆盖（见 README）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { findWallpaperDirs } = require('./path-discovery.js');

function exists(p) { try { return p && fs.existsSync(p); } catch (e) { return false; } }

function findOnPath(command) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const r = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
    }
  } catch (e) {}
  return null;
}

// ---- Node.js 可执行文件 ----
function findNode() {
  if (process.env.DSHGUI_NODE && exists(process.env.DSHGUI_NODE)) return process.env.DSHGUI_NODE;
  const onPath = findOnPath('node');
  if (onPath && exists(onPath)) return onPath;
  // 常见安装位置
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe')
  ];
  for (const c of candidates) if (exists(c)) return c;
  // 回退到 PATH 里的 node
  return 'node';
}

// ---- dsh 的 bin.js（全局 npm 安装） ----
function findDshBin() {
  if (process.env.DSHGUI_DSH_BIN && exists(process.env.DSHGUI_DSH_BIN)) return process.env.DSHGUI_DSH_BIN;
  const candidates = [];
  const addRoot = (root) => {
    if (!root) return;
    candidates.push(path.join(root.trim(), '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  };
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  addRoot(path.join(appData, 'npm', 'node_modules'));

  // Prefer package-manager-reported global roots, which also covers custom drives.
  for (const manager of ['npm', 'pnpm']) {
    const executable = process.platform === 'win32' ? manager + '.cmd' : manager;
    try {
      const r = spawnSync(executable, ['root', '-g'], { encoding: 'utf8', windowsHide: true });
      if (r.status === 0 && r.stdout) addRoot(r.stdout);
    } catch (e) {}
  }

  // Yarn classic keeps global packages outside npm's global root.
  try {
    const yarnDir = spawnSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['global', 'dir'], { encoding: 'utf8', windowsHide: true });
    if (yarnDir.status === 0 && yarnDir.stdout) addRoot(path.join(yarnDir.stdout.trim(), 'node_modules'));
  } catch (e) {}

  // Also derive the package root from a dsh shim on PATH (npm, pnpm, or yarn).
  const dshShim = findOnPath('dsh');
  if (dshShim) addRoot(path.join(path.dirname(dshShim), 'node_modules'));

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  // Keep the common pnpm layout as a fallback for older pnpm versions.
  candidates.push(path.join(localAppData, 'pnpm', 'global', '5', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

// ---- 工作目录（dsh 服务启动时的工作目录） ----
function findWorkspace() {
  if (process.env.DSHGUI_WORKSPACE && String(process.env.DSHGUI_WORKSPACE).trim()) return path.resolve(process.env.DSHGUI_WORKSPACE.trim());
  // Do not grant the model the whole user profile by default.
  return path.join(os.homedir(), 'dsh-workspace');
}

function findPort() {
  const value = Number.parseInt(process.env.DSHGUI_PORT || '3080', 10);
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : 3080;
}

const wallpaperDirs = findWallpaperDirs();

module.exports = {
  HOST: ['127.0.0.1', 'localhost', '::1'].includes(process.env.DSHGUI_HOST) ? process.env.DSHGUI_HOST : '127.0.0.1',
  PORT: findPort(),
  NODE: findNode(),
  DSH_BIN: findDshBin(),
  WALLPAPER_DIRS: wallpaperDirs,
  WALLPAPER_DIR: wallpaperDirs[0] || null,
  WORKSPACE: findWorkspace()
};
