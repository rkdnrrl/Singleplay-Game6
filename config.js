(function () {
  'use strict';
  /** `server.js` 의 `PLATFORM_API_URL` 기본값과 동일 — nginx 가 동적 config 를 안 줄 때 대비 */
  var DEFAULT_PLATFORM_API = 'http://43.203.215.179:4000';
  var cur = typeof window.__ALP_PLATFORM_API__ === 'undefined' ? '' : String(window.__ALP_PLATFORM_API__).trim();
  if (!cur) {
    window.__ALP_PLATFORM_API__ = DEFAULT_PLATFORM_API;
  }
})();
