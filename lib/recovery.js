'use strict';

class RecoveryGate {
  constructor(cooldownMs = 60_000) {
    this.cooldownMs = Math.max(0, Number(cooldownMs) || 0);
    this.active = false;
    this.lastFailureAt = 0;
  }

  canStart(now = Date.now()) {
    return !this.active && (!this.lastFailureAt || now - this.lastFailureAt >= this.cooldownMs);
  }

  tryStart(now = Date.now()) {
    if (!this.canStart(now)) return false;
    this.active = true;
    return true;
  }

  finish(success, now = Date.now()) {
    this.active = false;
    if (success) this.lastFailureAt = 0;
    else this.lastFailureAt = now;
  }

  isActive() {
    return this.active;
  }
}

module.exports = { RecoveryGate };
