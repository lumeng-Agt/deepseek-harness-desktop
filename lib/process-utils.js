'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function processMetadata(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    try {
      const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\") | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
      return output ? JSON.parse(output) : null;
    } catch (error) { return null; }
  }

  try {
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (commandLine) return { ProcessId: pid, CommandLine: commandLine, CreationDate: null };
  } catch (error) {}
  try {
    const commandLine = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }).trim();
    return commandLine ? { ProcessId: pid, CommandLine: commandLine, CreationDate: null } : null;
  } catch (error) { return null; }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return false; }
}

function isExpectedDshCommand(commandLine, binPath) {
  if (typeof commandLine !== 'string' || !commandLine || !binPath) return false;
  const command = commandLine.toLowerCase().replace(/\\/g, '/');
  const bin = path.resolve(binPath).toLowerCase().replace(/\\/g, '/');
  const sameBin = new RegExp(`(?:^|[\\s"'])${escapeRegExp(bin)}(?=$|[\\s"'])`, 'i').test(command);
  const isWeb = /(?:^|\s|["'])web(?:\s|$|["'])/i.test(commandLine);
  return sameBin && isWeb;
}

function isOwnedProcess(state, fallbackBin) {
  if (!state || !isProcessAlive(state.pid) || state.pid === process.pid) return false;
  const meta = processMetadata(state.pid);
  const commandLine = meta && (meta.CommandLine || meta.commandLine);
  if (!meta || !isExpectedDshCommand(commandLine, state.bin || fallbackBin)) return false;
  if (state.processCreatedAt && meta.CreationDate && state.processCreatedAt !== meta.CreationDate) return false;
  return true;
}

module.exports = { isExpectedDshCommand, isOwnedProcess, isProcessAlive, processMetadata };
