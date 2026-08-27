'use strict';

function hasDshBootSignature(body) {
  const text = String(body || '');
  return /__DSH_BOOT__/.test(text) && /DeepSeek\s+Harness/i.test(text);
}

function isDshRpcResponse(body) {
  try {
    const value = typeof body === 'string' ? JSON.parse(body) : body;
    return value?.type === 'server-response' && value?.result?.ok === true;
  } catch (error) {
    // session.list can be large. The envelope and its success flag are near
    // the start of the JSON, so a bounded probe may validate the response
    // without retaining every session summary.
    const prefix = String(body || '').slice(0, 8192);
    return /"type"\s*:\s*"server-response"/.test(prefix)
      && /"result"\s*:\s*\{\s*"ok"\s*:\s*true/.test(prefix);
  }
}

module.exports = { hasDshBootSignature, isDshRpcResponse };
