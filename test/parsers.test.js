const test = require("node:test");
const assert = require("node:assert/strict");
const { parseId3v2Body, parseVorbisComment, parseMp4 } = require("../local-files-plus.js");

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type, ...children) => {
  const body = children.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
};

test("reads the title from ID3v2.3 TIT2", () => {
  const text = [0, ...ascii("My Song")]; // encoding byte 0 = ISO-8859-1
  const frame = [...ascii("TIT2"), ...u32(text.length), 0, 0, ...text];
  const tags = parseId3v2Body(new Uint8Array(frame).buffer, 3, false);
  assert.equal(tags.title, "My Song");
});

test("keeps every word of an ID3v2 value, dropping only what follows a NUL separator", () => {
  // v0.2.0 split on a space instead of NUL, so "Hip Hop" came back as "Hip".
  const text = [0, ...ascii("Hip Hop"), 0, ...ascii("Jazz")];
  const frame = [...ascii("TCON"), ...u32(text.length), 0, 0, ...text];
  const tags = parseId3v2Body(new Uint8Array(frame).buffer, 3, false);
  assert.equal(tags.genre, "Hip Hop");
});

test("reads the title from a Vorbis comment", () => {
  const entries = ["TITLE=Flac Song", "ARTIST=Someone"];
  const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const vendor = ascii("test");
  const bytes = [...le32(vendor.length), ...vendor, ...le32(entries.length)];
  for (const e of entries) bytes.push(...le32(e.length), ...ascii(e));
  const out = { title: null, artist: null };
  parseVorbisComment(new Uint8Array(bytes), out);
  assert.equal(out.title, "Flac Song");
  assert.equal(out.artist, "Someone");
});

test("marks ALAC in an M4A as lossless, and AAC as not", async () => {
  const fileFor = (codec) => {
    const stsd = box("stsd", [0, 0, 0, 0], u32(1), box(codec, new Array(28).fill(0)));
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", stsd)))));
    return new Uint8Array([...box("ftyp", ascii("M4A ")), ...moov]);
  };
  for (const [codec, lossless] of [["alac", true], ["mp4a", false]]) {
    const bytes = fileFor(codec);
    const readRange = async (s, e) => bytes.slice(s, e).buffer;
    const result = await parseMp4(readRange, bytes.length);
    assert.equal(result.quality.lossless, lossless, codec);
  }
});
