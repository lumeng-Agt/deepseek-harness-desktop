'use strict';

(function () {
  var messageNode = document.getElementById('message');
  var diagnosticsNode = document.getElementById('diagnostics');
  var retryButton = document.getElementById('retry');
  var copyButton = document.getElementById('copy');
  var diagnosticsText = '';

  window.setStartupError = function (message) {
    if (messageNode && message) messageNode.textContent = message;
  };

  function readDiagnostics() {
    if (!window.dshApp || !window.dshApp.diagnostics) {
      diagnosticsText = '暂时无法读取诊断信息。';
      if (diagnosticsNode) diagnosticsNode.textContent = diagnosticsText;
      return;
    }
    window.dshApp.diagnostics().then(function (text) {
      diagnosticsText = String(text || '暂无诊断信息');
      if (diagnosticsNode) diagnosticsNode.textContent = diagnosticsText;
    }).catch(function () {
      diagnosticsText = '暂时无法读取诊断信息。';
      if (diagnosticsNode) diagnosticsNode.textContent = diagnosticsText;
    });
  }

  if (retryButton) retryButton.addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    button.textContent = '重试中…';
    if (window.dshApp && window.dshApp.retry) window.dshApp.retry().catch(function () { button.disabled = false; button.textContent = '重试'; });
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (error) {}
      area.remove();
      if (copied) resolve(); else reject(new Error('copy unavailable'));
    });
  }

  if (copyButton) copyButton.addEventListener('click', function () {
    var button = this;
    if (!diagnosticsText) return;
    copyText(diagnosticsText).then(function () {
      button.textContent = '已复制';
      setTimeout(function () { button.textContent = '复制诊断信息'; }, 1500);
    }).catch(function () { button.textContent = '复制失败'; });
  });

  readDiagnostics();
}());
