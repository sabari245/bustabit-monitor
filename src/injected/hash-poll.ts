export const HASH_POLL_SCRIPT = `
(function () {
  if (window.__btrackHashPoll) return;
  window.__btrackHashPoll = true;
  var lastHash = null;

  function post(data) {
    window.ipc.postMessage(JSON.stringify(data));
  }

  function sendHash(hash) {
    if (!hash || hash === lastHash) return;
    lastHash = hash;
    post({ hash: hash.toLowerCase(), id: null, bust: null });
  }

  function scan(value) {
    var match = value && value.match(/[0-9a-fA-F]{64}/);
    if (match) sendHash(match[0]);
  }

  var OriginalWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct: function (Target, args) {
      var socket = new Target(...args);
      socket.addEventListener('message', function (event) {
        if (typeof event.data === 'string') scan(event.data);
        else if (event.data instanceof ArrayBuffer) scan(new TextDecoder().decode(event.data));
        else if (event.data instanceof Blob) event.data.text().then(scan);
      });
      return socket;
    }
  });

  window.__btrackHashPoll = setInterval(function () {
    try {
      if (
        typeof engine !== "undefined" &&
        engine.history &&
        typeof engine.history.first === "function"
      ) {
        var g = engine.history.first();
        if (g && g.hash) post({ hash: g.hash, id: g.id, bust: g.bust ?? null });
      }
    } catch (_) {}
    try {
      if (document.body) scan(document.body.innerText);
    } catch (_) {}
  }, 500);
})();
`;
