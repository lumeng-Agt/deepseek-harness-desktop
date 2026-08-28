'use strict';

const fs = require('fs');
const path = require('path');

function replaceFile(temp, target) {
  try {
    fs.renameSync(temp, target);
    return;
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
  }

  const backup = `${target}.${process.pid}.${Date.now()}.bak`;
  let movedOld = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedOld = true;
    }
    fs.renameSync(temp, target);
    if (movedOld) fs.rmSync(backup, { force: true });
  } catch (error) {
    try {
      if (movedOld && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    } catch (ignored) {}
    throw error;
  }
}

function atomicWriteFile(file, data, options) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, data, options);
    replaceFile(temp, file);
    return true;
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (ignored) {}
    return false;
  }
}

module.exports = { atomicWriteFile };
