// NAME: Local Files+
// AUTHOR: yusufaf
// DESCRIPTION: Real tag metadata as sortable, filterable columns on the Local Files page: artist, album artist, year, genre, bitrate/quality, file type, size, folder, and more.
//
// Local Files+ moved to https://github.com/yusufaf/spicetify-extensions/tree/main/extensions/local-files-plus
// This file only loads it from there, so installs from this repository keep updating.
// Install it from the new location to stop depending on this redirect.

(function () {
  if (window.__localFilesPlusActive) return;
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/yusufaf/spicetify-extensions@main/extensions/local-files-plus/local-files-plus.js';
  script.onerror = () => console.error('[Local Files+] Could not load the extension from https://cdn.jsdelivr.net/gh/yusufaf/spicetify-extensions@main/extensions/local-files-plus/local-files-plus.js');
  document.head.appendChild(script);
})();
