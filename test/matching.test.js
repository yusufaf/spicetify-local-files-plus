const test = require("node:test");
const assert = require("node:assert/strict");
const { findIndexKeyForPath, matchNamesForRecord, matchTracksToFiles, normalizeForMatch } = require("../local-files-plus.js");

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

test("offers a file under its title tag and file name, and loosely under its file name without a track number", () => {
  const names = (filename, title = null) => matchNamesForRecord({ filename, tags: { title } });
  assert.deepEqual(names("06 LeFluGame Ft Jace Of Two9.mp3"), {
    names: ["06 leflugame ft jace of two9"],
    looseNames: ["leflugame ft jace of two9"],
  });
  assert.deepEqual(names("1. Movie ft. Major Myjah.mp3"), { names: ["1 movie ft major myjah"], looseNames: ["movie ft major myjah"] });
  // A title tag that already equals the stripped name isn't repeated as a loose name.
  assert.deepEqual(names("01 - Song.flac", "Song"), { names: ["song", "01 song"], looseNames: [] });
  // "10 Days" keeps its number in the exact names; only the loose name drops it.
  assert.deepEqual(names("10 Days.mp3"), { names: ["10 days"], looseNames: ["days"] });
});

test("normalizes names in any script, so non-Latin titles don't all collapse to the same empty key", () => {
  assert.equal(normalizeForMatch("Café — Déjà Vu"), "café déjà vu");
  assert.equal(normalizeForMatch("日本語のタイトル"), "日本語のタイトル");
  assert.notEqual(normalizeForMatch("日本"), normalizeForMatch("韓国"));
});

test("matches decomposed file names (macOS) to composed track names, and keeps combining marks", () => {
  const decomposed = "Cafe\u0301";
  assert.notEqual(decomposed, "Caf\u00e9"); // the inputs really differ
  assert.equal(normalizeForMatch(decomposed), normalizeForMatch("Caf\u00e9"));
  assert.equal(normalizeForMatch("\u0928\u092e\u0938\u094d\u0924\u0947"), "\u0928\u092e\u0938\u094d\u0924\u0947"); // नमस्ते
});

const record = (path, title = null) => ({
  path,
  filename: path.split(/[\\/]/).pop(),
  tags: { title },
  quality: { lossless: false, bitrateKbps: null },
  size: 3_000_000,
});
const track = (uri, name, imagePath = null) => ({
  uri,
  name,
  duration: { milliseconds: 180_000 },
  album: imagePath ? { images: [{ url: "spotify:localfileimage:" + encodeURIComponent(imagePath) }] } : { images: [] },
});
const indexOf = (...recs) => new Map(recs.map((rec) => [rec.path.toLowerCase(), rec]));

test("matches by the path Spotify reports, and works out the bitrate from size and length", () => {
  const rec = record("Music\\Nujabes\\Aruarian Dance.mp3");
  const matched = matchTracksToFiles([track("t1", "Whatever", "C:\\Users\\Me\\Music\\Nujabes\\Aruarian Dance.mp3")], indexOf(rec));
  assert.equal(matched.get("t1"), rec);
  assert.equal(rec.quality.bitrateKbps, 136); // 3,000,000 bytes over 180 s, to the nearest 8
});

test("gives exact names priority, so 'Days' can't take '10 Days.mp3' from the track called '10 Days'", () => {
  const tenDays = record("Music\\10 Days.mp3");
  const days = record("Music\\Days.mp3");
  // Index order puts '10 Days' first, which used to hand it to the 'Days' track.
  const matched = matchTracksToFiles([track("days", "Days"), track("ten", "10 Days")], indexOf(tenDays, days));
  assert.equal(matched.get("days"), days);
  assert.equal(matched.get("ten"), tenDays);
});

test("falls back to the title tag, then to the file name without its track number", () => {
  const tagged = record("Music\\01 track.mp3", "Real Title");
  const numbered = record("Music\\06 LeFluGame.mp3");
  const matched = matchTracksToFiles([track("a", "Real Title"), track("b", "LeFluGame")], indexOf(tagged, numbered));
  assert.equal(matched.get("a"), tagged);
  assert.equal(matched.get("b"), numbered);
});
