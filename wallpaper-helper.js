#!/usr/bin/env node
/**
 * Wallpaper Engine 文件解析助手
 * 把 Wallpaper Engine 壁纸里的非标准格式（PKGV 场景包、TEX 纹理里嵌入的图片/视频）
 * 转成常见格式（.mp4 / .png / .jpg）。
 *
 * 用法:
 *   node wallpaper-helper.js [输入目录] [输出目录]
 *   node wallpaper-helper.js <scene.pkg 或壁纸文件夹> [输出目录]
 *
 * 默认:
 *   输入 = D:\\Steam\\steamapps\\workshop\\content\\431960
 *   输出 = D:\\wallpaper-converted
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function exists(p) { try { return p && fs.existsSync(p); } catch (e) { return false; } }

function findDefaultIn() {
  if (process.env.DSHGUI_WALLPAPER_DIR && exists(process.env.DSHGUI_WALLPAPER_DIR)) return process.env.DSHGUI_WALLPAPER_DIR;
  const steamRoots = [];
  for (const d of ['C', 'D', 'E', 'F', 'G']) {
    steamRoots.push(d + ':\\Steam');
    steamRoots.push(d + ':\\steam');
    steamRoots.push(d + ':\\Program Files (x86)\\Steam');
    steamRoots.push(d + ':\\SteamLibrary');
  }
  for (const root of steamRoots) {
    const w = path.join(root, 'steamapps', 'workshop', 'content', '431960');
    if (exists(w)) return w;
  }
  return null;
}

const DEFAULT_IN = findDefaultIn();
const DEFAULT_OUT = path.join(os.homedir(), 'wallpaper-converted');

// ---------- PKGV 容器解析 ----------
function parsePkg(buf) {
  if (buf.length < 16) return null;
  const magicLen = buf.readUInt32LE(0);
  if (magicLen !== 8) return null;
  const magic = buf.toString('ascii', 4, 12);
  if (!magic.startsWith('PKGV')) return null;
  const version = magic.slice(4);
  let p = 12;
  const count = buf.readUInt32LE(p); p += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 8 > buf.length) break;
    const nameLen = buf.readUInt32LE(p); p += 4;
    if (p + nameLen + 8 > buf.length) break;
    const name = buf.toString('utf8', p, p + nameLen); p += nameLen;
    const offset = buf.readUInt32LE(p); p += 4;
    const size = buf.readUInt32LE(p); p += 4;
    entries.push({ name, offset, size });
  }
  return { version, entries, dataStart: p, buf };
}

// ---------- 从 .tex 纹理提取嵌入的 JPEG/PNG/MP4 ----------
// 检测顺序很重要：MP4 优先（视频流里可能含 JPEG 帧，会误判），
// 且图片签名必须出现在纹理头部附近（TEXB 头之后），避免误抓视频深处的帧。
function extractFromTex(tex) {
  if (!tex || tex.length < 16) return null;
  const HEAD = 2000; // 图片签名允许出现的最大偏移（纹理头部区域）

  // 1) MP4 (ftyp) — 优先，因为视频流里可能嵌有 JPEG 帧
  const ftyp = Buffer.from('ftyp');
  const fi = tex.indexOf(ftyp);
  if (fi >= 4 && fi < HEAD) {
    return { type: 'mp4', data: tex.slice(fi - 4), size: tex.length - (fi - 4) };
  }

  // 2) PNG — 只在头部区域找
  const pngSig = Buffer.from([0x89,0x50,0x4E,0x47]);
  const pi = tex.indexOf(pngSig);
  if (pi >= 0 && pi < HEAD) {
    const iend = Buffer.from([0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]);
    const ei = tex.indexOf(iend, pi);
    if (ei >= 0) return { type: 'png', data: tex.slice(pi, ei + 8), size: ei + 8 - pi };
  }

  // 3) JPEG — 只在头部区域找，并校验尺寸
  for (let i = 0; i < Math.min(HEAD, tex.length - 3); i++) {
    if (tex[i] === 0xFF && tex[i+1] === 0xD8 && tex[i+2] === 0xFF) {
      for (let j = i + 2; j < tex.length - 1; j++) {
        if (tex[j] === 0xFF && tex[j+1] === 0xD9) {
          const data = tex.slice(i, j + 2);
          let w = 0, h = 0;
          for (let k = 2; k < data.length - 9; k++) {
            if (data[k] === 0xFF && (data[k+1] === 0xC0 || data[k+1] === 0xC1 || data[k+1] === 0xC2)) { h = data.readUInt16BE(k+5); w = data.readUInt16BE(k+7); break; }
          }
          if (w >= 200 && h >= 200 && w <= 16384 && h <= 16384 && data.length / (w * h) >= 0.05) {
            return { type: 'jpg', data, size: data.length };
          }
        }
      }
    }
  }
  return null;
}

// ---------- LZ4 块解压（纯 JS，无依赖） ----------
function lz4Decompress(src, expectedSize) {
  const out = Buffer.alloc(expectedSize);
  let si = 0, oi = 0;
  while (si < src.length) {
    const token = src[si++];
    let litLen = token >> 4;
    if (litLen === 15) { let b; do { b = src[si++]; litLen += b; } while (b === 255); }
    src.copy(out, oi, si, si + litLen);
    si += litLen; oi += litLen;
    if (si >= src.length) break;
    const offset = src.readUInt16LE(si); si += 2;
    let matchLen = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) { let b; do { b = src[si++]; matchLen += b; } while (b === 255); }
    for (let k = 0; k < matchLen; k++) { out[oi] = out[oi - offset]; oi++; }
  }
  return out;
}

// ---------- 最小 PNG 编码器（RGBA → PNG，无依赖） ----------
function encodePng(width, height, rgba) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = require('zlib').deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 检测 LZ4 压缩的 RGBA 纹理（精灵表等） ----------
// TEXV0005 里 format=7 且 TEXB 数据是 LZ4 压缩的 RGBA 时，返回解压后的 RGBA + 尺寸。
function tryLz4Texture(tex) {
  if (!tex || tex.length < 100) return null;
  // TEXI 头：width@26, height@30, format@22
  const format = tex.readUInt32LE(22);
  const width = tex.readUInt32LE(26);
  const height = tex.readUInt32LE(30);
  if (width < 200 || height < 200 || width > 16384 || height > 16384) return null;
  // TEXB 头在 46（"TEXB0003\0" 9 字节，到 55）
  if (tex.toString('ascii', 46, 54) !== 'TEXB0003') return null;
  // 未压缩大小 @79，压缩大小 @83，数据 @87
  const uncompressedSize = tex.readUInt32LE(79);
  const compressedSize = tex.readUInt32LE(83);
  if (uncompressedSize !== width * height * 4) return null; // 必须是 RGBA
  if (compressedSize <= 0 || compressedSize >= uncompressedSize) return null;
  const comp = tex.slice(87, 87 + compressedSize);
  try {
    const rgba = lz4Decompress(comp, uncompressedSize);
    return { width, height, rgba };
  } catch (e) {
    return null;
  }
}

// ---------- 从 pkg 原始字节提取 PNG/JPG（scene 静态图） ----------
function extractImage(buf) {
  if (!buf) return null;
  // PNG
  const pngSig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const iend = Buffer.from([0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]);
  let best = null;
  let pos = 0;
  while (true) {
    const i = buf.indexOf(pngSig, pos);
    if (i < 0) break;
    const e = buf.indexOf(iend, i);
    if (e >= 0) {
      const data = buf.slice(i, e + 8);
      if (data.length > 20*1024) {
        const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
        if (w >= 200 && h >= 200 && w <= 16384 && h <= 16384 && (!best || w*h > best.w*best.h)) best = { type:'png', data, w, h };
      }
      pos = e + 8;
    } else pos = i + 8;
  }
  // JPG
  const jpgSig = Buffer.from([0xFF,0xD8,0xFF]);
  const jpgEnd = Buffer.from([0xFF,0xD9]);
  pos = 0;
  while (true) {
    const i = buf.indexOf(jpgSig, pos);
    if (i < 0) break;
    const e = buf.indexOf(jpgEnd, i);
    if (e >= 0) {
      const data = buf.slice(i, e + 2);
      if (data.length > 20*1024) {
        let w=0,h=0;
        for (let k=2;k<data.length-9;k++){ if(data[k]===0xFF&&(data[k+1]===0xC0||data[k+1]===0xC1||data[k+1]===0xC2)){ h=data.readUInt16BE(k+5); w=data.readUInt16BE(k+7); break; } }
        if (w >= 200 && h >= 200 && w <= 16384 && h <= 16384 && data.length/(w*h) >= 0.05 && (!best || w*h > best.w*best.h)) best = { type:'jpg', data, w, h };
      }
      pos = e + 2;
    } else pos = i + 3;
  }
  return best;
}

// ---------- 处理单个壁纸文件夹 ----------
function processWallpaper(id, outRoot) {
  const dir = path.join(INPUT_DIR, id);
  if (!fs.existsSync(dir)) return null;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return null;

  let title = id, type = '';
  const pj = path.join(dir, 'project.json');
  if (fs.existsSync(pj)) {
    try { const j = JSON.parse(fs.readFileSync(pj, 'utf8')); if (j.title) title = j.title; if (j.type) type = j.type; } catch (e) {}
  }
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
  const outDir = path.join(outRoot, id + '_' + safeTitle);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const result = { id, title, type, files: [] };

  // 1) scene 类型：解析 pkg
  const pkgPath = path.join(dir, 'scene.pkg');
  if (fs.existsSync(pkgPath)) {
    const pkg = parsePkg(fs.readFileSync(pkgPath));
    if (pkg) {
      // 提取所有图层纹理（多层场景有背景/人物/眼睛等多个图层）
      // 跳过 mask/particle/effect 等辅助纹理（特效遮罩，不是图层）
      const isAux = (name) => /mask|particle|effect|waterflow|waterripple|waterwave|foliagesway|shake|shine|opacity|halo|drop|normal|phase/i.test(name);
      const texEntries = pkg.entries
        .filter(e => e.name.toLowerCase().endsWith('.tex') && !isAux(e.name))
        .sort((a,b)=>b.size-a.size);
      let extractedCount = 0;
      for (const te of texEntries) {
        if (extractedCount >= 20) break; // 最多 20 个图层
        const tex = pkg.buf.slice(pkg.dataStart + te.offset, pkg.dataStart + te.offset + te.size);
        // 先尝试 LZ4 压缩的 RGBA 纹理（精灵表等）
        const lz = tryLz4Texture(tex);
        if (lz) {
          const png = encodePng(lz.width, lz.height, lz.rgba);
          const base = sanitizeName(path.basename(te.name, '.tex'));
          const fn = (extractedCount === 0 ? 'wallpaper' : base) + '.png';
          fs.writeFileSync(path.join(outDir, fn), png);
          result.files.push(fn);
          extractedCount++;
          continue;
        }
        const ex = extractFromTex(tex);
        if (ex && (ex.type === 'jpg' || ex.type === 'png' || ex.type === 'mp4')) {
          const base = sanitizeName(path.basename(te.name, '.tex'));
          const fn = (extractedCount === 0 ? 'wallpaper' : base) + '.' + ex.type;
          fs.writeFileSync(path.join(outDir, fn), ex.data);
          result.files.push(fn);
          extractedCount++;
        }
      }
      // 声音文件（mp3/wav/ogg）
      for (const e of pkg.entries) {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === '.mp3' || ext === '.wav' || ext === '.ogg') {
          try {
            const data = pkg.buf.slice(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size);
            const fn = sanitizeName(path.basename(e.name));
            fs.writeFileSync(path.join(outDir, fn), data);
            result.files.push(fn);
          } catch (err) { /* skip bad audio entry */ }
        }
      }
    }
    // 从 pkg 原始字节提取静态图（scene 里直接嵌的 PNG/JPG）
    if (result.files.length === 0) {
      const img = extractImage(fs.readFileSync(pkgPath));
      if (img) {
        const fn = 'wallpaper.' + img.type;
        fs.writeFileSync(path.join(outDir, fn), img.data);
        result.files.push(fn);
      }
    }
  }

  // 2) video 类型：直接复制视频文件
  for (const f of fs.readdirSync(dir)) {
    const ext = path.extname(f).toLowerCase();
    if ((ext === '.mp4' || ext === '.webm') && !f.startsWith('hi-res') && !f.startsWith('test-extract')) {
      const src = path.join(dir, f);
      if (fs.statSync(src).size > 1024*1024) {
        fs.copyFileSync(src, path.join(outDir, f));
        result.files.push(f);
      }
    }
  }

  // 3) web 类型：复制所有媒体资源（图片/视频/音频）
  if (result.files.length === 0 || type === 'web') {
    const mediaExt = ['.jpg','.jpeg','.png','.webp','.gif','.mp4','.webm','.mp3','.flac','.ogg','.wav','.m4a'];
    const walkMedia = (d) => {
      let names = [];
      try { names = fs.readdirSync(d); } catch (e) { return; }
      for (const n of names) {
        const p = path.join(d, n);
        let s; try { s = fs.statSync(p); } catch (e) { continue; }
        if (s.isDirectory()) { walkMedia(p); continue; }
        const ext = path.extname(n).toLowerCase();
        if (mediaExt.includes(ext) && !n.startsWith('preview') && !n.startsWith('hi-res') && !n.startsWith('test-extract') && s.size > 1024) {
          try {
            const fn = sanitizeName(n);
            fs.copyFileSync(p, path.join(outDir, fn));
            result.files.push(fn);
          } catch (e) {}
        }
      }
    };
    walkMedia(dir);
  }

  // 4) 兜底：复制 preview 图
  if (result.files.length === 0) {
    for (const p of ['preview.jpg','preview.png','preview.gif']) {
      const src = path.join(dir, p);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(outDir, p)); result.files.push(p); break; }
    }
  }

  return result;
}

// ---------- 文件名清洗 ----------
function sanitizeName(name) {
  // 去掉 null 字节、控制字符、非法文件名字符
  return name
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'unnamed';
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
let INPUT_DIR = DEFAULT_IN;
let OUTPUT_DIR = DEFAULT_OUT;
if (args.length >= 1) INPUT_DIR = args[0];
if (args.length >= 2) OUTPUT_DIR = args[1];

if (!fs.existsSync(INPUT_DIR)) {
  console.error('输入目录不存在: ' + INPUT_DIR);
  process.exit(1);
}
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 判断输入是单个壁纸文件夹 / pkg 还是 workshop 根目录
let targets = [];
const inStat = fs.statSync(INPUT_DIR);
if (inStat.isDirectory()) {
  const pkgHere = path.join(INPUT_DIR, 'scene.pkg');
  const projHere = path.join(INPUT_DIR, 'project.json');
  if (fs.existsSync(pkgHere) || fs.existsSync(projHere)) {
    // 单个壁纸文件夹
    targets = [path.basename(INPUT_DIR)];
    INPUT_DIR = path.dirname(INPUT_DIR);
  } else {
    targets = fs.readdirSync(INPUT_DIR).filter(id => {
      try { return fs.statSync(path.join(INPUT_DIR, id)).isDirectory(); } catch (e) { return false; }
    });
  }
} else if (inStat.isFile() && INPUT_DIR.toLowerCase().endsWith('.pkg')) {
  console.error('请传入包含 scene.pkg 的壁纸文件夹，而不是 pkg 文件本身');
  process.exit(1);
}

let ok = 0, empty = 0, failed = 0;
for (const id of targets) {
  let r = null;
  try {
    r = processWallpaper(id, OUTPUT_DIR);
  } catch (err) {
    failed++;
    console.log('[错误] ' + id + '  ' + (err && err.message));
    continue;
  }
  if (!r) continue;
  if (r.files.length > 0) {
    ok++;
    console.log('[OK] ' + r.id + ' ' + r.title + '  ->  ' + r.files.join(', '));
  } else {
    empty++;
    console.log('[空] ' + r.id + ' ' + r.title + '  (无法提取)');
  }
}
console.log('');
console.log('完成: ' + ok + ' 个成功, ' + empty + ' 个无法提取, ' + failed + ' 个出错');
console.log('输出目录: ' + OUTPUT_DIR);
