/*
 * ============================================================
 * BACKEND CONFIG
 * Auto-detect: se sei su localhost usa il backend locale,
 * altrimenti usa il server remoto.
 * ============================================================
 */
(function () {
  const isLocal = location.protocol === 'file:' ||
    (location.protocol === 'http:' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));

  window.API_URL = isLocal
    ? 'http://localhost:8080'
    : 'http://37.221.94.156:8080';

  window.WS_URL = isLocal
    ? 'ws://localhost:8080/ws'
    : 'ws://37.221.94.156:8080/ws';
})();
