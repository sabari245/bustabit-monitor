export const HASH_POLL_SCRIPT = `
(function () {
  if (window.__btrackHashPoll) {
    window.ipc.log('debug', 'Monitor injection skipped because it is already active');
    return;
  }
  window.__btrackHashPoll = true;

  var decoder = new TextDecoder();
  var gameId = null;
  var lastHash = null;

  function post(data) {
    window.ipc.postMessage(JSON.stringify(data));
  }

  function trace(level, message, details) {
    window.ipc.log(level, message, details);
  }

  function table(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var start = view.getUint32(0, true);
    var vtable = start - view.getInt32(start, true);
    return {
      view: view,
      start: start,
      field: function (index) {
        var slot = vtable + 4 + index * 2;
        return slot < vtable + view.getUint16(vtable, true)
          ? view.getUint16(slot, true)
          : 0;
      }
    };
  }

  function readString(data, field) {
    var position = data.start + field;
    var start = position + data.view.getUint32(position, true);
    var length = data.view.getUint32(start, true);
    return decoder.decode(new Uint8Array(data.view.buffer, data.view.byteOffset + start + 4, length));
  }

  function handleFrame(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length < 6) return;
    var colon = bytes.indexOf(58);
    if (bytes[0] !== 46 || colon < 0) return;

    var event = decoder.decode(bytes.subarray(1, colon));
    var payload = bytes.subarray(colon + 1);
    if (payload.length < 8) return;
    var data = table(payload);

    if (event === 'gameStarting') {
      var idField = data.field(0);
      if (idField) gameId = Number(data.view.getBigInt64(data.start + idField, true));
      return;
    }

    if (event !== 'gameEnded') return;

    var bustField = data.field(1);
    var hashField = data.field(2);
    if (!bustField || !hashField) return;

    var hash = readString(data, hashField).toLowerCase();
    if (hash === lastHash) return;

    lastHash = hash;
    trace('debug', 'Completed round decoded', {
      id: gameId,
      bust: Math.round(data.view.getFloat64(data.start + bustField, true) * 100) / 100,
      hash: hash.slice(0, 12)
    });
    post({
      id: gameId,
      hash: hash,
      bust: Math.round(data.view.getFloat64(data.start + bustField, true) * 100) / 100
    });
  }

  function safelyHandleFrame(buffer) {
    try {
      handleFrame(buffer);
    } catch (error) {
      trace('warn', 'Ignored an unreadable WebSocket frame', {
        bytes: buffer.byteLength,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function handleMessage(event) {
    if (event.data instanceof ArrayBuffer) safelyHandleFrame(event.data);
    else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(safelyHandleFrame).catch(function (error) {
        trace('warn', 'Could not read a WebSocket blob', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }

  var OriginalWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct: function (Target, args) {
      var socket = new Target(...args);
      trace('debug', 'WebSocket connection observed');
      socket.addEventListener('message', handleMessage);
      return socket;
    }
  });
  trace('info', 'Bustabit WebSocket monitor installed');
})();
`;
