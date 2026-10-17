const test = require("node:test");
const assert = require("node:assert/strict");
const { findIndexKeyForPath, matchNamesForRecord, normalizeForMatch } = require("../local-files-plus.js");

test("finds a file from Spotify's absolute path, though the index only knows paths from the chosen folder", () => {
  const index = new Map([["music\\nujabes\\song.mp3", {}], ["music\\song.mp3", {}]]);
  assert.equal(findIndexKeyForPath(index, "C:\\Users\\Me\\Music\\Nujabes\\Song.mp3"), "music\\nujabes\\song.mp3");
  assert.equal(findIndexKeyForPath(index, "C:\\Users\\Me\\Music\\Song.mp3"), "music\\song.mp3");
  assert.equal(findIndexKeyForPath(index, "/Users/me/Music/Nujabes/Song.mp3"), "music\\nujabes\\song.mp3");
});

test("never matches on a bare file name from another folder", () => {
  const index = new Map([["music\\song.mp3", {}]]);
  assert.equal(findIndexKeyForPath(index, "D:\\Other\\song.mp3"), null);
  assert.equal(findIndexKeyForPath(index, "song.mp3"), null);
});

test("offers a file under its title tag, its file name, and its file name without a track number", () => {
  const names = (filename, title = null) => matchNamesForRecord({ filename, tags: { title } });
  assert.deepEqual(names("06 LeFluGame Ft Jace Of Two9.mp3"), ["06 leflugame ft jace of two9", "leflugame ft jace of two9"]);
  assert.deepEqual(names("1. Movie ft. Major Myjah.mp3"), ["1 movie ft major myjah", "movie ft major myjah"]);
  assert.deepEqual(names("01 - Song.flac", "Song"), ["song", "01 song"]);
  // A title that starts with a number still matches through the untouched file name.
  assert.ok(names("10 Days.mp3").includes("10 days"));
});

test("normalizes names in any script, so non-Latin titles don't all collapse to the same empty key", () => {
  assert.equal(normalizeForMatch("Café — Déjà Vu"), "café déjà vu");
  assert.equal(normalizeForMatch("日本語のタイトル"), "日本語のタイトル");
  assert.notEqual(normalizeForMatch("日本"), normalizeForMatch("韓国"));
});
