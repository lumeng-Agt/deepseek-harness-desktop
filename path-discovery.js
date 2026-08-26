'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function exists(p) {
  try { return Boolean(p) && fs.existsSync(p); } catch (e) { return false; }
}

function isDirectory(p) {
  try { return Boolean(p) && fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function unique(paths) {
  const result = [];
  const seen = new Set();
  for (const value of paths) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) { seen.add(key); result.push(resolved); }
  }
  return result;
}

function commandOutput(command, args) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  } catch (e) {}
  return '';
}

function registryValue(key, valueName) {
  if (process.platform !== 'win32') return '';
  const output = commandOutput('reg.exe', ['query', key, '/v', valueName]);
  const line = output.split(/\r?\n/).find((item) => new RegExp(`\\b${valueName}\\b`, 'i').test(item));
  if (!line) return '';
  const match = line.match(/REG_SZ\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function unescapeVdf(value) {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function readSteamLibraryFolders(steamRoot) {
  const file = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (!exists(file)) return [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const roots = [];
  for (const line of text.split(/\r?\n/)) {
    const modern = line.match(/"path"\s+"((?:\\.|[^"])*)"/i);
    const legacy = line.match(/^\s*"\d+"\s+"((?:\\.|[^"])*)"/);
    const value = modern ? modern[1] : (legacy ? legacy[1] : '');
    if (value) roots.push(unescapeVdf(value));
  }
  return roots.filter(isDirectory);
}

function findSteamRoots() {
  const candidates = [];
  const envRoots = [process.env.DSHGUI_STEAM_DIR, process.env.DSHGUI_STEAM_DIRS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[;\r\n]+/));
  candidates.push(...envRoots);

  if (process.platform === 'win32') {
    candidates.push(
      registryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
      registryValue('HKCU\\Software\\Valve\\Steam', 'InstallPath'),
      registryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
      registryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath')
    );
    candidates.push(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
      path.join(process.env.LOCALAPPDATA || '', 'Steam')
    );
    for (const drive of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      candidates.push(`${drive}:\\Steam`, `${drive}:\\steam`, `${drive}:\\SteamLibrary`);
      candidates.push(`${drive}:\\Program Files\\Steam`, `${drive}:\\Program Files (x86)\\Steam`);
    }
  } else {
    candidates.push(path.join(os.homedir(), '.steam', 'steam'), '/usr/local/steam');
  }

  const roots = unique(candidates).filter(isDirectory);
  return unique(roots.flatMap((root) => [root, ...readSteamLibraryFolders(root)]));
}

function findWallpaperDirs(appId = '431960') {
  const explicit = [process.env.DSHGUI_WALLPAPER_DIR, process.env.DSHGUI_WALLPAPER_DIRS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[;\r\n]+/));
  const discovered = findSteamRoots().map((root) => path.join(root, 'steamapps', 'workshop', 'content', appId));
  return unique([...explicit, ...discovered]).filter(isDirectory);
}

module.exports = { findSteamRoots, findWallpaperDirs, isDirectory, exists };
