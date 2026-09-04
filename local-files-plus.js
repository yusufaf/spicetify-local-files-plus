// @ts-check
// x-release-please-start-version
// Local Files+ v0.1.0
// x-release-please-end-version
//
// Reads real tag metadata (artist, album artist, year, genre, bitrate/quality, and
// more) directly off disk via the File System Access API, and injects it into
// Spotify's Local Files page as extra sortable, filterable columns.
//
// No build step. Single IIFE. Parsing functions are pure (ArrayBuffer/DataView in,
// plain objects out) so they run identically in the browser and under `node` for
// testing — see the `module.exports` guard at the bottom.

(function LocalFilesPlus() {
  "use strict";

  //#region Type Definitions

  /**
   * @typedef {Object} ParsedTags
   * @property {string|null} artist
   * @property {string|null} albumArtist
   * @property {string|null} album
   * @property {number|null} year
   * @property {string|null} genre
   * @property {number|null} trackNo
   * @property {number|null} discNo
   * @property {number|null} bpm
   */

  /**
   * @typedef {Object} QualityInfo
   * @property {boolean} lossless
   * @property {number|null} bitrateKbps  Computed from size/duration for lossy; null for lossless.
   * @property {number|null} sampleRateHz FLAC only (from STREAMINFO).
   * @property {number|null} bitDepth     FLAC only (from STREAMINFO).
   */

  /**
   * @typedef {Object} FileRecord Cached per-file index entry, keyed by lowercased absolute path.
   * @property {string} path
   * @property {string} folder
   * @property {string} filename
   * @property {string} ext
   * @property {number} size
   * @property {number} lastModified
   * @property {ParsedTags} tags
   * @property {QualityInfo} quality
   * @property {number} scannedAt
   */

  /**
   * @typedef {Object} LfpConfig
   * @property {Record<string, boolean>} visibleColumns
   * @property {string[]} columnOrder
   * @property {string} lastFolderName
   */

  //#endregion

  //#region Constants

  const LOG_PREFIX = "[Local Files+]";
  const DB_NAME = "local-files-plus";
  const DB_VERSION = 1;
  const STORE_HANDLES = "handles";
  const STORE_TRACKS = "tracks";
  const HANDLE_KEY = "music-folder";
  const CONFIG_KEY = "local-files-plus-config";

  const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".mp4", ".flac", ".ogg", ".oga", ".opus", ".wav", ".aac", ".wma"]);

  const LOCAL_FILES_PATH = "/collection/local-files";

  const SEL_ROOT_MAIN_VIEW = ".Root__main-view";
  const SEL_TRACKLIST = ".main-trackList-trackList";
  const SEL_TRACKLIST_HEADER_ROW = ".main-trackList-trackListHeaderRow";
  const SEL_TRACKLIST_ROW = ".main-trackList-trackListRow";
  const SEL_ROW_TITLE = '.main-trackList-rowMainContentTitle, [data-testid="tracklist-row-title"], [data-testid="internal-track-link"]';
  const SEL_ROW_DURATION = '.main-trackList-duration, .main-trackList-rowDuration, [data-testid="tracklist-duration"]';
  const SEL_ROW_SECTION_END = ".main-trackList-rowSectionEnd";
  const SEL_COLUMN_PICKER_BTN = 'button[aria-label="Change visible columns"], button[aria-label*="visible columns" i]';
  const SEL_ROOTLIST_WRAPPER = ".main-rootlist-wrapper";

  /**
   * `.main-rootlist-wrapper` is not unique to the tracklist — the left sidebar's
   * library list uses the same class, so a bare `document.querySelector` can
   * grab the wrong one. Scope the search to inside the tracklist container.
   */
  function findTracklistRootlistWrapper() {
    const tracklist = document.querySelector(SEL_TRACKLIST);
    return tracklist ? tracklist.querySelector(SEL_ROOTLIST_WRAPPER) : null;
  }

  const ROW_HEIGHT_PX = 56;

  //#endregion

  //#region Genre table (ID3v1 + common Winamp extensions)

  const GENRES = [
    "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
    "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock",
    "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack",
    "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance",
    "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
    "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop",
    "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic",
    "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40",
    "Christian Rap", "Pop/Funk", "Jungle", "Native US", "Cabaret", "New Wave", "Psychedelic",
    "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka",
    "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk-Rock", "National Folk",
    "Swing", "Fast Fusion", "Bebop", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde",
    "Gothic Rock", "Progressive Rock", "Psychedelic Rock", "Symphonic Rock", "Slow Rock",
    "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour", "Speech", "Chanson",
    "Opera", "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus", "Porn Groove",
    "Satire", "Slow Jam", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad",
    "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock", "Drum Solo", "A Cappella",
    "Euro-House", "Dance Hall", "Goa", "Drum & Bass", "Club-House", "Hardcore", "Terror",
    "Indie", "BritPop", "Afro-Punk", "Polsk Punk", "Beat", "Christian Gangsta Rap",
    "Heavy Metal", "Black Metal", "Crossover", "Contemporary Christian", "Christian Rock",
    "Merengue", "Salsa", "Thrash Metal", "Anime", "JPop", "Synthpop", "Abstract", "Art Rock",
    "Baroque", "Bhangra", "Big Beat", "Breakbeat", "Chillout", "Downtempo", "Dub", "EBM",
    "Eclectic", "Electro", "Electroclash", "Emo", "Experimental", "Garage", "Global",
    "IDM", "Illbient", "Industro-Goth", "Jam Band", "Krautrock", "Leftfield", "Lounge",
    "Math Rock", "New Romantic", "Nu-Breakz", "Post-Punk", "Post-Rock", "Psytrance",
    "Shoegaze", "Space Rock", "Trop Rock", "World Music", "Neoclassical", "Audiobook",
    "Audio Theatre", "Neue Deutsche Welle", "Podcast", "Indie Rock", "G-Funk", "Dubstep",
    "Garage Rock", "Psybient",
  ];

  //#endregion

  //#region Byte / bit reading utilities

  /** @param {ArrayBuffer} buf @returns {Uint8Array} */
  function u8(buf) {
    return new Uint8Array(buf);
  }

  /** ASCII/latin1 read — safe for tag frame IDs and MP4 four-char codes (incl. the 0xA9 "©" prefix). */
  function readFourCC(bytes, off) {
    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  }

  function readUint32BE(bytes, off) {
    return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
  }

  function readUint24BE(bytes, off) {
    return (bytes[off] << 16) | (bytes[off + 1] << 8) | bytes[off + 2];
  }

  function readUint16BE(bytes, off) {
    return (bytes[off] << 8) | bytes[off + 1];
  }

  function readSyncSafeUint32(bytes, off) {
    return ((bytes[off] & 0x7f) << 21) | ((bytes[off + 1] & 0x7f) << 14) | ((bytes[off + 2] & 0x7f) << 7) | (bytes[off + 3] & 0x7f);
  }

  /** Decode a text-frame payload: first byte is an ID3v2 text-encoding marker. */
  function decodeId3Text(bytes, start, end) {
    if (start >= end) return "";
    const encByte = bytes[start];
    const body = bytes.subarray(start + 1, end);
    let text;
    try {
      if (encByte === 1) {
        // UTF-16 with BOM
        text = decodeUtf16(body, true);
      } else if (encByte === 2) {
        // UTF-16BE, no BOM
        text = decodeUtf16(body, false);
      } else if (encByte === 3) {
        text = new TextDecoder("utf-8").decode(body);
      } else {
        text = new TextDecoder("iso-8859-1").decode(body);
      }
    } catch (e) {
      text = new TextDecoder("iso-8859-1").decode(body);
    }
    // Strip trailing NULs and split multi-value fields (v2.4 allows NUL-separated values).
    return text.replace(/ +$/g, "").split(" ")[0].trim();
  }

  function decodeUtf16(bytes, hasBom) {
    let littleEndian = true;
    let offset = 0;
    if (hasBom && bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { littleEndian = true; offset = 2; }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) { littleEndian = false; offset = 2; }
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
    let out = "";
    for (let i = 0; i + 1 < view.byteLength; i += 2) {
      out += String.fromCharCode(view.getUint16(i, littleEndian));
    }
    return out;
  }

  //#endregion

  //#region Genre string normalization (shared by ID3v2 TCON, ID3v1, MP4 gnre/©gen)

  /** @param {string} raw @returns {string|null} */
  function normalizeId3Genre(raw) {
    if (!raw) return null;
    // "(17)", "(17)Rock", or bare "17" -> table lookup. Otherwise, literal text.
    const parenMatch = raw.match(/^\((\d+)\)\s*(.*)$/);
    if (parenMatch) {
      const idx = parseInt(parenMatch[1], 10);
      const trailing = parenMatch[2].trim();
      if (trailing) return trailing;
      return GENRES[idx] || null;
    }
    if (/^\d+$/.test(raw.trim())) {
      const idx = parseInt(raw.trim(), 10);
      return GENRES[idx] || null;
    }
    return raw.trim() || null;
  }

  /** @param {number} idx1Based @returns {string|null} MP4 `gnre` atom stores a 1-based ID3v1 genre index. */
  function genreFromIndex1Based(idx1Based) {
    const idx = idx1Based - 1;
    return GENRES[idx] || null;
  }

  //#endregion

  //#region ID3v2 (MP3) parser

  /**
   * Parses an ID3v2 header + full tag body. Handles v2.2/2.3/2.4 frame IDs and
   * frame-size encodings (v2.4 frame sizes are syncsafe; v2.2/2.3 are not — a common
   * source of bugs). Handles the tag-level unsynchronization flag; does not handle
   * the rarer per-frame (v2.4) unsynchronization flag.
   * @param {ArrayBuffer} headerBuf Exactly the first 10 bytes of the file.
   * @returns {{ size: number, major: number, unsync: boolean } | null}
   */
  function parseId3v2Header(headerBuf) {
    const b = u8(headerBuf);
    if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
    const major = b[3];
    const flags = b[5];
    const size = readSyncSafeUint32(b, 6);
    return { size, major, unsync: (flags & 0x80) !== 0 };
  }

  /**
   * @param {ArrayBuffer} tagBuf The tag body, exactly `header.size` bytes, starting
   *   right after the 10-byte header.
   * @param {number} major
   * @param {boolean} unsync
   * @returns {ParsedTags}
   */
  function parseId3v2Body(tagBuf, major, unsync) {
    let bytes = u8(tagBuf);
    if (unsync) bytes = removeUnsynchronization(bytes);

    const idLen = major === 2 ? 3 : 4;
    const sizeLen = major === 2 ? 3 : 4;
    const frameHeaderLen = idLen + sizeLen + (major === 2 ? 0 : 2);

    const wantedFrames = major === 2
      ? { TP1: "artist", TP2: "albumArtist", TAL: "album", TYE: "year", TCO: "genre", TRK: "trackNo", TPA: "discNo", TBP: "bpm" }
      : { TPE1: "artist", TPE2: "albumArtist", TALB: "album", TYER: "year", TDRC: "year", TCON: "genre", TRCK: "trackNo", TPOS: "discNo", TBPM: "bpm" };

    /** @type {ParsedTags} */
    const out = { artist: null, albumArtist: null, album: null, year: null, genre: null, trackNo: null, discNo: null, bpm: null };

    let off = 0;
    while (off + frameHeaderLen <= bytes.length) {
      const id = major === 2 ? String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2]) : readFourCC(bytes, off);
      if (!id || id.charCodeAt(0) === 0) break; // padding reached

      let frameSize;
      if (major === 2) {
        frameSize = readUint24BE(bytes, off + 3);
      } else if (major === 4) {
        frameSize = readSyncSafeUint32(bytes, off + 4);
      } else {
        frameSize = readUint32BE(bytes, off + 4);
      }
      const dataStart = off + frameHeaderLen;
      const dataEnd = dataStart + frameSize;
      if (frameSize <= 0 || dataEnd > bytes.length) break; // corrupt/truncated

      const field = wantedFrames[id];
      if (field && !out[field]) {
        const raw = decodeId3Text(bytes, dataStart, dataEnd);
        applyTextField(out, field, raw);
      }

      off = dataEnd;
    }

    return out;
  }

  /** Removes ID3v2 unsynchronization (0xFF 0x00 -> 0xFF) from the whole tag body. */
  function removeUnsynchronization(bytes) {
    const out = new Uint8Array(bytes.length);
    let j = 0;
    for (let i = 0; i < bytes.length; i++) {
      out[j++] = bytes[i];
      if (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0x00) i++;
    }
    return out.subarray(0, j);
  }

  /** Shared by ID3v2 and ID3v1: routes a raw text value into the right ParsedTags field, with type coercion. */
  function applyTextField(out, field, raw) {
    if (!raw) return;
    if (field === "year") {
      const m = raw.match(/\d{4}/);
      if (m) out.year = parseInt(m[0], 10);
    } else if (field === "trackNo" || field === "discNo") {
      const n = parseInt(raw.split("/")[0], 10);
      if (!isNaN(n)) out[field] = n;
    } else if (field === "bpm") {
      const n = parseInt(raw, 10);
      if (!isNaN(n)) out.bpm = n;
    } else if (field === "genre") {
      out.genre = normalizeId3Genre(raw);
    } else {
      out[field] = raw;
    }
  }

  /**
   * @param {ArrayBuffer} last128 The final 128 bytes of the file.
   * @returns {ParsedTags|null}
   */
  function parseId3v1(last128) {
    const b = u8(last128);
    if (b.length < 128 || b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return null; // "TAG"
    const latin1 = (start, len) => new TextDecoder("iso-8859-1").decode(b.subarray(start, start + len)).replace(/ +$/g, "").replace(/\s+$/, "");
    const out = { artist: latin1(33, 30) || null, albumArtist: null, album: latin1(63, 30) || null, year: null, genre: null, trackNo: null, discNo: null, bpm: null };
    const yearStr = latin1(93, 4);
    if (/^\d{4}$/.test(yearStr)) out.year = parseInt(yearStr, 10);
    // ID3v1.1: comment[28] === 0 means comment[29] is the track number.
    if (b[125] === 0 && b[126] !== 0) out.trackNo = b[126];
    out.genre = GENRES[b[127]] || null;
    return out;
  }

  //#endregion

  //#region FLAC parser

  /**
   * @param {(offset: number, length: number) => Promise<ArrayBuffer>} readRange
   * @returns {Promise<{ tags: ParsedTags, quality: QualityInfo } | null>}
   */
  async function parseFlac(readRange) {
    const magic = u8(await readRange(0, 4));
    if (magic.length < 4 || String.fromCharCode(...magic) !== "fLaC") return null;

    /** @type {ParsedTags} */
    const tags = { artist: null, albumArtist: null, album: null, year: null, genre: null, trackNo: null, discNo: null, bpm: null };
    /** @type {QualityInfo} */
    const quality = { lossless: true, bitrateKbps: null, sampleRateHz: null, bitDepth: null };

    let off = 4;
    let safety = 0;
    while (safety++ < 64) {
      const headerBytes = u8(await readRange(off, off + 4));
      if (headerBytes.length < 4) break;
      const isLast = (headerBytes[0] & 0x80) !== 0;
      const blockType = headerBytes[0] & 0x7f;
      const blockLen = readUint24BE(headerBytes, 1);
      const payloadStart = off + 4;

      if (blockType === 0) {
        // STREAMINFO — need bytes 10..17 of the block (sample rate / channels / bit depth / total samples).
        const chunk = u8(await readRange(payloadStart + 10, payloadStart + 18));
        if (chunk.length === 8) {
          const x = readUint32BE(chunk, 0);
          quality.sampleRateHz = x >>> 12;
          quality.bitDepth = ((x >>> 4) & 0x1f) + 1;
        }
      } else if (blockType === 4) {
        const buf = await readRange(payloadStart, payloadStart + blockLen);
        parseVorbisComment(u8(buf), tags);
      }

      off = payloadStart + blockLen;
      if (isLast) break;
    }

    return { tags, quality };
  }

  /** @param {Uint8Array} bytes @param {ParsedTags} out */
  function parseVorbisComment(bytes, out) {
    if (bytes.length < 4) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 0;
    const vendorLen = view.getUint32(off, true); off += 4 + vendorLen;
    if (off + 4 > bytes.length) return;
    const count = view.getUint32(off, true); off += 4;
    const decoder = new TextDecoder("utf-8");
    for (let i = 0; i < count && off + 4 <= bytes.length; i++) {
      const len = view.getUint32(off, true); off += 4;
      if (off + len > bytes.length) break;
      const entry = decoder.decode(bytes.subarray(off, off + len));
      off += len;
      const eq = entry.indexOf("=");
      if (eq < 0) continue;
      const key = entry.slice(0, eq).toUpperCase();
      const value = entry.slice(eq + 1);
      if (!value) continue;
      switch (key) {
        case "ARTIST": if (!out.artist) out.artist = value; break;
        case "ALBUMARTIST": case "ALBUM ARTIST": out.albumArtist = value; break;
        case "ALBUM": if (!out.album) out.album = value; break;
        case "DATE": case "YEAR": { const m = value.match(/\d{4}/); if (m && !out.year) out.year = parseInt(m[0], 10); break; }
        case "GENRE": if (!out.genre) out.genre = value; break;
        case "TRACKNUMBER": { const n = parseInt(value.split("/")[0], 10); if (!isNaN(n)) out.trackNo = n; break; }
        case "DISCNUMBER": { const n = parseInt(value.split("/")[0], 10); if (!isNaN(n)) out.discNo = n; break; }
        case "BPM": { const n = parseInt(value, 10); if (!isNaN(n)) out.bpm = n; break; }
      }
    }
  }

  //#endregion

  //#region MP4 / M4A parser

  const MP4_TEXT_ATOMS = {
    "©ART": "artist",
    "aART": "albumArtist",
    "©alb": "album",
    "©day": "year",
    "©gen": "genre",
  };

  /**
   * Walks top-level atoms (reading only headers, skipping payload via size) to find
   * `moov`, then reads that whole subtree in one shot and parses `udta/meta/ilst`.
   * @param {(offset: number, length: number) => Promise<ArrayBuffer>} readRange
   * @param {number} fileSize
   * @returns {Promise<{ tags: ParsedTags, quality: QualityInfo } | null>}
   */
  async function parseMp4(readRange, fileSize) {
    let off = 0;
    let moovStart = -1, moovSize = -1;
    let safety = 0;
    while (off + 8 <= fileSize && safety++ < 256) {
      const header = u8(await readRange(off, off + 16));
      if (header.length < 8) break;
      let size = readUint32BE(header, 0);
      const type = readFourCC(header, 4);
      let bodyOffset = 8;
      if (size === 1) {
        // 64-bit extended size in the next 8 bytes.
        if (header.length < 16) break;
        const hi = readUint32BE(header, 8), lo = readUint32BE(header, 12);
        size = hi * 4294967296 + lo;
        bodyOffset = 16;
      } else if (size === 0) {
        size = fileSize - off;
      }
      if (type === "moov") { moovStart = off + bodyOffset; moovSize = size - bodyOffset; break; }
      if (size < 8) break;
      off += size;
    }
    if (moovStart < 0 || moovSize <= 0 || moovSize > 8 * 1024 * 1024) return null;

    const moov = u8(await readRange(moovStart, moovStart + moovSize));
    const ilst = findMp4Atom(moov, ["udta", "meta:full", "ilst"]);

    /** @type {ParsedTags} */
    const tags = { artist: null, albumArtist: null, album: null, year: null, genre: null, trackNo: null, discNo: null, bpm: null };
    if (ilst) parseMp4Ilst(ilst, tags);

    return { tags, quality: { lossless: false, bitrateKbps: null, sampleRateHz: null, bitDepth: null } };
  }

  /**
   * Descends a chain of child atom names, e.g. `["udta", "meta:full", "ilst"]`.
   * A `:full` suffix on a step means that atom is a full box — 4 extra
   * version/flags bytes sit between its header and its children (true of `meta`).
   * @param {Uint8Array} bytes
   * @param {string[]} path
   * @returns {Uint8Array|null}
   */
  function findMp4Atom(bytes, path) {
    if (path.length === 0) return bytes;
    const [step, ...rest] = path;
    const isFullBox = step.endsWith(":full");
    const target = isFullBox ? step.slice(0, -5) : step;

    let off = 0;
    while (off + 8 <= bytes.length) {
      const size = readUint32BE(bytes, off);
      const type = readFourCC(bytes, off + 4);
      if (size < 8 || off + size > bytes.length) break;
      if (type === target) {
        const childStart = isFullBox ? off + 12 : off + 8; // skip 4-byte version/flags for full boxes (meta)
        const child = bytes.subarray(childStart, off + size);
        return findMp4Atom(child, rest);
      }
      off += size;
    }
    return null;
  }

  /** @param {Uint8Array} ilst @param {ParsedTags} out */
  function parseMp4Ilst(ilst, out) {
    let off = 0;
    while (off + 8 <= ilst.length) {
      const size = readUint32BE(ilst, off);
      const type = readFourCC(ilst, off + 4);
      if (size < 8 || off + size > ilst.length) break;
      const child = ilst.subarray(off + 8, off + size);
      handleMp4ItemAtom(type, child, out);
      off += size;
    }
  }

  /** @param {string} type @param {Uint8Array} item @param {ParsedTags} out */
  function handleMp4ItemAtom(type, item, out) {
    const dataAtom = findMp4DataAtom(item);
    if (!dataAtom) return;
    const { typeIndicator, payload } = dataAtom;

    if (type === "trkn" && payload.length >= 6) { out.trackNo = readUint16BE(payload, 2); return; }
    if (type === "disk" && payload.length >= 6) { out.discNo = readUint16BE(payload, 2); return; }
    if (type === "tmpo" && payload.length >= 2) { out.bpm = readUint16BE(payload, 0); return; }
    if (type === "gnre" && payload.length >= 2) { out.genre = genreFromIndex1Based(readUint16BE(payload, 0)); return; }

    const field = MP4_TEXT_ATOMS[type];
    if (!field || typeIndicator !== 1) return; // 1 = UTF-8 well-known type
    const text = new TextDecoder("utf-8").decode(payload).trim();
    if (!text) return;
    if (field === "year") {
      const m = text.match(/\d{4}/);
      if (m) out.year = parseInt(m[0], 10);
    } else {
      out[field] = text;
    }
  }

  /** Finds the first child `data` atom of an ilst item and returns its type indicator + payload. */
  function findMp4DataAtom(item) {
    let off = 0;
    while (off + 8 <= item.length) {
      const size = readUint32BE(item, off);
      const type = readFourCC(item, off + 4);
      if (size < 8 || off + size > item.length) break;
      if (type === "data" && size >= 16) {
        return { typeIndicator: item[off + 11], payload: item.subarray(off + 16, off + size) };
      }
      off += size;
    }
    return null;
  }

  //#endregion

  //#region Quality / bitrate

  /**
   * @param {number} sizeBytes
   * @param {number} durationSeconds
   * @returns {number|null} kbps, rounded to the nearest 8 (typical encoder brackets).
   */
  function computeBitrateKbps(sizeBytes, durationSeconds) {
    if (!durationSeconds || durationSeconds <= 0 || !sizeBytes) return null;
    const kbps = (sizeBytes * 8) / durationSeconds / 1000;
    return Math.round(kbps / 8) * 8;
  }

  /** @param {FileRecord} rec @returns {string} */
  function formatQuality(rec) {
    if (!rec) return "";
    if (rec.quality.lossless) {
      if (rec.quality.sampleRateHz && rec.quality.bitDepth) {
        return `Lossless (${rec.quality.bitDepth}/${(rec.quality.sampleRateHz / 1000).toFixed(1)})`;
      }
      return "Lossless";
    }
    return rec.quality.bitrateKbps ? `${rec.quality.bitrateKbps} kbps` : "";
  }

  //#endregion

  //#region Formatting helpers

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let val = bytes / 1024, i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function formatDate(msOrIso) {
    if (!msOrIso) return "";
    const d = typeof msOrIso === "number" ? new Date(msOrIso) : new Date(msOrIso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDurationMs(ms) {
    if (!ms && ms !== 0) return "";
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  //#endregion

  //#region Node/browser dual-environment export (parsers are pure — testable under `node`)

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      GENRES,
      normalizeId3Genre,
      genreFromIndex1Based,
      parseId3v2Header,
      parseId3v2Body,
      parseId3v1,
      removeUnsynchronization,
      parseFlac,
      parseVorbisComment,
      parseMp4,
      findMp4Atom,
      parseMp4Ilst,
      computeBitrateKbps,
      formatQuality,
      formatBytes,
      formatDate,
      formatDurationMs,
      readUint32BE,
      readUint24BE,
      readUint16BE,
      readFourCC,
      readSyncSafeUint32,
    };
  }

  //#endregion

  // Everything below this line touches the DOM / Spicetify APIs and is skipped
  // entirely when this file is `require()`d under Node for parser testing.
  if (typeof document === "undefined" || typeof window === "undefined") return;

  //#region IndexedDB

  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
        if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbGet(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(store, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const objStore = tx.objectStore(store);
      const keysReq = objStore.getAllKeys();
      const valsReq = objStore.getAll();
      tx.oncomplete = () => {
        /** @type {Map<string, any>} */
        const map = new Map();
        const keys = keysReq.result, vals = valsReq.result;
        for (let i = 0; i < keys.length; i++) map.set(keys[i], vals[i]);
        resolve(map);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbClear(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  //#endregion

  //#region State

  /** @type {Map<string, FileRecord>} keyed by lowercased absolute path */
  let fileIndex = new Map();
  /** @type {FileSystemDirectoryHandle|null} */
  let dirHandle = null;
  /** @type {FileSystemDirectoryHandle|null} A remembered handle whose permission needs re-granting (e.g. after a browser restart). */
  let pendingHandle = null;
  /** @type {LfpConfig} */
  let config = null; // set in main(), after COLUMN_DEFS below is initialized
  let scanInProgress = false;
  let lastScanStats = { total: 0, parsed: 0, skippedUnchanged: 0, errors: 0 };

  const COLUMN_DEFS = [
    { id: "quality", label: "Quality", defaultOn: true, width: "minmax(90px, 0.9fr)", get: (rec) => formatQuality(rec), sortVal: (rec) => rec ? (rec.quality.lossless ? 1e6 : rec.quality.bitrateKbps || 0) : -1 },
    { id: "year", label: "Year", defaultOn: true, width: "minmax(60px, 0.5fr)", align: "right", get: (rec) => (rec && rec.tags.year) ? String(rec.tags.year) : "", sortVal: (rec) => (rec && rec.tags.year) || 0 },
    { id: "genre", label: "Genre", defaultOn: true, width: "minmax(90px, 0.9fr)", get: (rec) => (rec && rec.tags.genre) || "", sortVal: (rec) => ((rec && rec.tags.genre) || "").toLowerCase() },
    { id: "albumArtist", label: "Album Artist", defaultOn: true, width: "minmax(110px, 1fr)", get: (rec) => (rec && rec.tags.albumArtist) || "", sortVal: (rec) => ((rec && rec.tags.albumArtist) || "").toLowerCase() },
    { id: "artist", label: "Artist", defaultOn: false, width: "minmax(110px, 1fr)", get: (rec) => (rec && rec.tags.artist) || "", sortVal: (rec) => ((rec && rec.tags.artist) || "").toLowerCase() },
    { id: "fileType", label: "Type", defaultOn: false, width: "minmax(60px, 0.5fr)", get: (rec) => (rec ? rec.ext.replace(".", "").toUpperCase() : ""), sortVal: (rec) => (rec && rec.ext) || "" },
    { id: "size", label: "Size", defaultOn: false, width: "minmax(80px, 0.6fr)", align: "right", get: (rec) => formatBytes(rec && rec.size), sortVal: (rec) => (rec && rec.size) || 0 },
    { id: "dateModified", label: "Date Modified", defaultOn: false, width: "minmax(100px, 0.8fr)", get: (rec) => formatDate(rec && rec.lastModified), sortVal: (rec) => (rec && rec.lastModified) || 0 },
    { id: "trackNo", label: "#", defaultOn: false, width: "minmax(40px, 0.3fr)", align: "right", get: (rec) => (rec && rec.tags.trackNo) ? String(rec.tags.trackNo) : "", sortVal: (rec) => (rec && rec.tags.trackNo) || 0 },
    { id: "bpm", label: "BPM", defaultOn: false, width: "minmax(50px, 0.4fr)", align: "right", get: (rec) => (rec && rec.tags.bpm) ? String(rec.tags.bpm) : "", sortVal: (rec) => (rec && rec.tags.bpm) || 0 },
    { id: "folder", label: "Folder", defaultOn: false, width: "minmax(120px, 1.2fr)", get: (rec) => (rec && rec.folder) || "", sortVal: (rec) => ((rec && rec.folder) || "").toLowerCase() },
  ];

  function loadConfig() {
    /** @type {LfpConfig} */
    const defaults = {
      visibleColumns: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.defaultOn])),
      columnOrder: COLUMN_DEFS.map((c) => c.id),
      lastFolderName: "",
    };
    try {
      const raw = Spicetify.LocalStorage.get(CONFIG_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        visibleColumns: { ...defaults.visibleColumns, ...(parsed.visibleColumns || {}) },
        columnOrder: Array.isArray(parsed.columnOrder) && parsed.columnOrder.length ? parsed.columnOrder : defaults.columnOrder,
        lastFolderName: typeof parsed.lastFolderName === "string" ? parsed.lastFolderName : "",
      };
    } catch (e) {
      console.warn(LOG_PREFIX, "Failed to load config, using defaults.", e);
      return defaults;
    }
  }

  function saveConfig() {
    try {
      Spicetify.LocalStorage.set(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn(LOG_PREFIX, "Failed to save config.", e);
    }
  }

  function activeColumns() {
    return config.columnOrder.filter((id) => config.visibleColumns[id]).map((id) => COLUMN_DEFS.find((c) => c.id === id)).filter(Boolean);
  }

  //#endregion

  //#region Directory access

  async function pickFolder() {
    const handle = await window.showDirectoryPicker({ id: "local-files-plus", mode: "read" });
    dirHandle = handle;
    await idbSet(STORE_HANDLES, HANDLE_KEY, handle);
    config.lastFolderName = handle.name;
    saveConfig();
    return handle;
  }

  async function restoreHandle() {
    try {
      const handle = await idbGet(STORE_HANDLES, HANDLE_KEY);
      if (!handle) return null;
      const perm = await handle.queryPermission({ mode: "read" });
      if (perm === "granted") { dirHandle = handle; return handle; }
      return handle; // caller decides whether to prompt for re-grant
    } catch (e) {
      console.warn(LOG_PREFIX, "Failed to restore folder handle.", e);
      return null;
    }
  }

  async function requestPermissionOnExistingHandle(handle) {
    const perm = await handle.requestPermission({ mode: "read" });
    if (perm === "granted") dirHandle = handle;
    return perm;
  }

  //#endregion

  //#region Scan: walk + parse + cache

  /** @param {FileSystemDirectoryHandle} root @returns {Promise<Array<{path: string, handle: FileSystemFileHandle}>>} */
  async function walkDirectory(root) {
    /** @type {Array<{path: string, handle: FileSystemFileHandle}>} */
    const results = [];
    async function recurse(dirHandle, pathPrefix) {
      for await (const [name, handle] of dirHandle.entries()) {
        const path = pathPrefix + "\\" + name;
        if (handle.kind === "directory") {
          await recurse(handle, path);
        } else {
          const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) results.push({ path, handle });
        }
      }
    }
    await recurse(root, root.name);
    return results;
  }

  /** @param {File} file @returns {(offset: number, length: number) => Promise<ArrayBuffer>} */
  function makeReadRange(file) {
    return async (start, end) => {
      const s = Math.max(0, start), e = Math.min(file.size, end);
      if (e <= s) return new ArrayBuffer(0);
      return file.slice(s, e).arrayBuffer();
    };
  }

  /** @param {File} file @param {string} ext @returns {Promise<{ tags: ParsedTags, quality: QualityInfo }>} */
  async function parseFile(file, ext) {
    const readRange = makeReadRange(file);
    const empty = { artist: null, albumArtist: null, album: null, year: null, genre: null, trackNo: null, discNo: null, bpm: null };

    if (ext === ".mp3" || ext === ".aac" || ext === ".wma") {
      const headerBuf = await readRange(0, 10);
      const header = parseId3v2Header(headerBuf);
      let tags = empty;
      if (header) {
        const bodyBuf = await readRange(10, 10 + header.size);
        tags = parseId3v2Body(bodyBuf, header.major, header.unsync);
      }
      if (!tags.artist && !tags.album && file.size >= 128) {
        const tail = await readRange(file.size - 128, file.size);
        const v1 = parseId3v1(tail);
        if (v1) tags = { ...v1, ...Object.fromEntries(Object.entries(tags).filter(([, v]) => v != null)) };
      }
      return { tags, quality: { lossless: false, bitrateKbps: null, sampleRateHz: null, bitDepth: null }, ext };
    }

    if (ext === ".flac") {
      const result = await parseFlac(readRange);
      if (result) return { ...result, ext };
      return { tags: empty, quality: { lossless: true, bitrateKbps: null, sampleRateHz: null, bitDepth: null }, ext };
    }

    if (ext === ".m4a" || ext === ".mp4") {
      const result = await parseMp4(readRange, file.size);
      if (result) return { ...result, ext };
      return { tags: empty, quality: { lossless: false, bitrateKbps: null, sampleRateHz: null, bitDepth: null }, ext };
    }

    // .ogg/.oga/.opus/.wav — not parsed for tags in v1; still indexed for size/quality columns.
    return { tags: empty, quality: { lossless: ext === ".wav", bitrateKbps: null, sampleRateHz: null, bitDepth: null }, ext };
  }

  /** @param {(msg: string) => void} [onProgress] */
  async function runScan(onProgress) {
    if (!dirHandle || scanInProgress) return;
    scanInProgress = true;
    lastScanStats = { total: 0, parsed: 0, skippedUnchanged: 0, errors: 0 };
    try {
      const files = await walkDirectory(dirHandle);
      lastScanStats.total = files.length;
      const existing = await idbGetAll(STORE_TRACKS);
      const nextIndex = new Map();

      for (const { path, handle } of files) {
        const key = path.toLowerCase();
        try {
          const file = await handle.getFile();
          const prior = existing.get(key);
          if (prior && prior.size === file.size && prior.lastModified === file.lastModified) {
            nextIndex.set(key, prior);
            lastScanStats.skippedUnchanged++;
            continue;
          }
          const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
          const parsed = await parseFile(file, ext);
          /** @type {FileRecord} */
          const rec = {
            path,
            folder: path.slice(0, path.lastIndexOf("\\")),
            filename: path.slice(path.lastIndexOf("\\") + 1),
            ext: parsed.ext,
            size: file.size,
            lastModified: file.lastModified,
            tags: parsed.tags,
            quality: parsed.quality,
            scannedAt: Date.now(),
          };
          nextIndex.set(key, rec);
          lastScanStats.parsed++;
        } catch (e) {
          lastScanStats.errors++;
          console.warn(LOG_PREFIX, "Failed to parse", path, e);
        }
        if (onProgress && lastScanStats.parsed % 25 === 0) onProgress(`${nextIndex.size}/${files.length}`);
      }

      fileIndex = nextIndex;
      await idbClear(STORE_TRACKS);
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, "readwrite");
        const store = tx.objectStore(STORE_TRACKS);
        for (const [key, rec] of nextIndex) store.put(rec, key);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      });

      console.log(LOG_PREFIX, `Scan complete: ${lastScanStats.parsed} parsed, ${lastScanStats.skippedUnchanged} unchanged, ${lastScanStats.errors} errors, ${lastScanStats.total} total.`);
    } finally {
      scanInProgress = false;
    }
  }

  async function loadIndexFromIndexedDb() {
    const map = await idbGetAll(STORE_TRACKS);
    fileIndex = map;
    return map;
  }

  //#endregion

  //#region Matching: LocalFilesAPI tracks <-> FileRecord

  function decodePathFromImageUrl(url) {
    if (!url || !url.startsWith("spotify:localfileimage:")) return null;
    try {
      return decodeURIComponent(url.slice("spotify:localfileimage:".length));
    } catch (e) {
      return null;
    }
  }

  /** @param {any[]} tracks LocalFilesAPI.getTracks() result @returns {Map<string, FileRecord>} keyed by track.uri */
  function matchTracksToFiles(tracks) {
    /** @type {Map<string, FileRecord>} */
    const matched = new Map();

    // Bucket unmatched-by-path file records by rounded duration for fallback lookup.
    // (Populated lazily below once we know which paths were claimed by tier 1.)
    const claimedPaths = new Set();

    for (const track of tracks) {
      const url = track.album && track.album.images && track.album.images[0] && track.album.images[0].url;
      const path = decodePathFromImageUrl(url);
      if (path) {
        const rec = fileIndex.get(path.toLowerCase());
        if (rec) {
          matched.set(track.uri, rec);
          claimedPaths.add(path.toLowerCase());
          const kbps = computeBitrateKbps(rec.size, track.duration.milliseconds / 1000);
          if (!rec.quality.lossless) rec.quality.bitrateKbps = kbps;
        }
      }
    }

    // Tier 2: fuzzy match remaining tracks by normalized filename stem. Candidates
    // are consumed with `.shift()` so exact-duplicate stems pair off deterministically
    // rather than every remaining track matching the same first candidate.
    const remaining = tracks.filter((t) => !matched.has(t.uri));
    if (remaining.length) {
      /** @type {Map<string, FileRecord[]>} keyed by normalized filename stem */
      const byStem = new Map();
      for (const [key, rec] of fileIndex) {
        if (claimedPaths.has(key)) continue;
        const stem = normalizeForMatch(rec.filename.replace(/\.[^.]+$/, ""));
        if (!byStem.has(stem)) byStem.set(stem, []);
        byStem.get(stem).push(rec);
      }
      for (const track of remaining) {
        const stem = normalizeForMatch(track.name);
        const candidates = byStem.get(stem);
        if (candidates && candidates.length) {
          const rec = candidates.shift();
          matched.set(track.uri, rec);
          const kbps = computeBitrateKbps(rec.size, track.duration.milliseconds / 1000);
          if (!rec.quality.lossless) rec.quality.bitrateKbps = kbps;
        }
      }
    }

    return matched;
  }

  function normalizeForMatch(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  /** @type {Map<string, FileRecord>} keyed by track.uri, refreshed each time the matcher runs */
  let trackMatchIndex = new Map();

  /** @type {any[]} raw LocalFilesAPI.getTracks() result, cached for the custom sort/filter list */
  let cachedTracks = [];

  async function refreshMatchIndex() {
    if (fileIndex.size === 0) { trackMatchIndex = new Map(); return trackMatchIndex; }
    try {
      const tracks = await Spicetify.Platform.LocalFilesAPI.getTracks();
      cachedTracks = tracks;
      trackMatchIndex = matchTracksToFiles(tracks);
    } catch (e) {
      console.warn(LOG_PREFIX, "Failed to fetch local tracks for matching.", e);
    }
    return trackMatchIndex;
  }

  //#endregion

  //#region Row lookup by visible DOM content (title text + duration text)

  /** @type {Map<string, {rec: FileRecord, track: any}[]>} keyed by "title|duration" for greedy consumption on duplicates */
  let rowLookupBuckets = new Map();

  /** Rebuilds buckets keyed by (title, duration text) from the last matched track set. */
  let rebuildInFlight = false;

  async function rebuildRowLookupFromTracks() {
    // Build into a local map and swap it in only once complete — replacing
    // rowLookupBuckets synchronously before the `await` below would leave a
    // window where every row briefly looks unmatched, which reads back as
    // every cell flickering blank on each rebuild (e.g. on every History event).
    if (rebuildInFlight) return;
    if (trackMatchIndex.size === 0) { rowLookupBuckets = new Map(); return; }
    rebuildInFlight = true;
    try {
      const tracks = await Spicetify.Platform.LocalFilesAPI.getTracks();
      cachedTracks = tracks;
      const next = new Map();
      for (const track of tracks) {
        const rec = trackMatchIndex.get(track.uri);
        if (!rec) continue;
        const key = track.name + "|" + formatDurationMs(track.duration.milliseconds);
        if (!next.has(key)) next.set(key, []);
        next.get(key).push({ rec, track });
      }
      rowLookupBuckets = next;
    } catch (e) {
      console.warn(LOG_PREFIX, "Failed to rebuild row lookup.", e);
    } finally {
      rebuildInFlight = false;
    }
  }

  /** @param {Element} row @returns {{rec: FileRecord, track: any}|null} */
  /**
   * Reads only direct text-node children of `el`, skipping element children.
   * Used for the title cell specifically so our own `.lfp-missing-marker` span
   * (appended as a child of that same element) never leaks into the text we
   * match against — `el.textContent` would include it, and since that marker's
   * presence itself depends on the match result, including it creates a
   * self-poisoning loop: marker present -> key wrong -> match fails -> marker
   * removed -> key right -> match succeeds -> marker re-added -> repeat forever.
   */
  function directTextContent(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text;
  }

  function lookupRowRecord(row) {
    const titleEl = row.querySelector(SEL_ROW_TITLE);
    const durationEl = row.querySelector(SEL_ROW_DURATION);
    if (!titleEl || !durationEl) return null;
    const title = directTextContent(titleEl).trim();
    const duration = durationEl.textContent.trim();
    const key = title + "|" + duration;
    const bucket = rowLookupBuckets.get(key);
    if (!bucket || !bucket.length) return null;
    return bucket[0]; // duplicates (identical title+duration) are indistinguishable; arbitrary pick is fine
  }

  //#endregion

  //#region Style injection + grid override

  let styleEl = null;

  function ensureStyleEl() {
    if (styleEl && document.contains(styleEl)) return styleEl;
    styleEl = document.getElementById("lfp-styles");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "lfp-styles";
      document.head.appendChild(styleEl);
    }
    return styleEl;
  }

  function updateGridStyle() {
    const cols = activeColumns();
    ensureStyleEl();
    if (cols.length === 0) {
      styleEl.textContent = "";
      return;
    }
    const varNames = cols.map((c, i) => `[lfp${i}] ${c.width}`).join(" ");
    styleEl.textContent = `
      ${SEL_TRACKLIST}.lfp-active {
        --grid-template-columns: [index] var(--index-column-width, 16px) [first] minmax(var(--first-min-width), var(--first-max-width, 3fr)) [var1] minmax(var(--var1-min-width), var(--var1-max-width, 1.4fr)) ${varNames} [last] minmax(var(--last-min-width), var(--last-max-width, 0.8fr)) !important;
      }
      .lfp-cell { display: flex; align-items: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--spice-subtext, #a7a7a7); font-size: 0.875rem; }
      .lfp-cell--right { justify-content: flex-end; }
      .lfp-cell--header { color: var(--spice-text, #fff); font-weight: 700; }
      .lfp-missing-marker { color: var(--spice-notification-error, #f15e6c); margin-left: 4px; font-size: 0.75em; vertical-align: middle; }
      .lfp-quality-flac { color: var(--spice-button-active, #1ed760); }
    `;
  }

  //#endregion

  //#region Row / header cell injection (augments Spotify's native virtualized list)

  function isLocalFilesPage() {
    const path = Spicetify.Platform && Spicetify.Platform.History && Spicetify.Platform.History.location && Spicetify.Platform.History.location.pathname;
    return path === LOCAL_FILES_PATH;
  }

  function injectHeader() {
    const tracklist = document.querySelector(SEL_TRACKLIST);
    const headerRow = document.querySelector(SEL_TRACKLIST_HEADER_ROW);
    if (!tracklist || !headerRow) return;

    tracklist.classList.toggle("lfp-active", activeColumns().length > 0);

    const endCell = headerRow.querySelector(SEL_ROW_SECTION_END);
    if (!endCell) return;

    const cols = activeColumns();
    const currentIds = [...headerRow.querySelectorAll("[data-lfp-col]")].map((el) => el.dataset.lfpCol);
    const wantedIds = cols.map((c) => c.id);
    if (currentIds.join(",") === wantedIds.join(",")) {
      renumberColindex(headerRow);
      return;
    }
    headerRow.querySelectorAll("[data-lfp-col]").forEach((el) => el.remove());
    for (const col of cols) {
      const cell = document.createElement("div");
      cell.className = "main-trackList-rowSectionVariable lfp-cell lfp-cell--header" + (col.align === "right" ? " lfp-cell--right" : "");
      cell.setAttribute("role", "columnheader");
      cell.dataset.lfpCol = col.id;
      cell.textContent = col.label;
      cell.style.cursor = "pointer";
      cell.addEventListener("click", () => {
        if (customSortColId === col.id) {
          customSortDir = customSortDir === "asc" ? "desc" : "asc";
        } else {
          customSortColId = col.id;
          customSortDir = "asc";
        }
        updateSortIndicators();
        renderCustomList();
      });
      endCell.parentElement.insertBefore(cell, endCell);
    }
    renumberColindex(headerRow);
  }

  function renumberColindex(row) {
    const cells = [...row.children];
    cells.forEach((cell, i) => cell.setAttribute("aria-colindex", String(i + 1)));
    row.parentElement && row.parentElement.setAttribute && null; // no-op guard
    const tracklist = document.querySelector(SEL_TRACKLIST);
    if (tracklist) tracklist.setAttribute("aria-colcount", String(cells.length));
  }

  function injectRow(row) {
    const cols = activeColumns();
    const endCell = row.querySelector(SEL_ROW_SECTION_END);
    if (!endCell) return;

    const currentIds = [...row.querySelectorAll("[data-lfp-col]")].map((el) => el.dataset.lfpCol);
    const wantedIds = cols.map((c) => c.id);
    const match = lookupRowRecord(row);
    const rec = match ? match.rec : null;

    if (currentIds.join(",") !== wantedIds.join(",")) {
      row.querySelectorAll("[data-lfp-col]").forEach((el) => el.remove());
      for (const col of cols) {
        const cell = document.createElement("div");
        cell.className = "main-trackList-rowSectionVariable lfp-cell" + (col.align === "right" ? " lfp-cell--right" : "");
        cell.setAttribute("role", "gridcell");
        cell.dataset.lfpCol = col.id;
        endCell.parentElement.insertBefore(cell, endCell);
      }
    }

    for (const col of cols) {
      const cell = row.querySelector(`[data-lfp-col="${col.id}"]`);
      if (!cell) continue;
      const text = col.get(rec);
      if (col.id === "quality" && rec && rec.quality.lossless) cell.classList.add("lfp-quality-flac");
      // Assigning textContent replaces the cell's child text node even when the
      // string is unchanged, which re-fires our own MutationObserver and would
      // otherwise loop forever (visible as row content flickering every ~120ms).
      if (cell.textContent !== text) cell.textContent = text;
    }

    renumberColindex(row);
    applyMissingMarker(row, match);
  }

  function applyMissingMarker(row, match) {
    const titleEl = row.querySelector(SEL_ROW_TITLE);
    if (!titleEl) return;
    const existing = titleEl.querySelector(".lfp-missing-marker");
    const missing = match && (!match.track.album || !match.track.album.name || !match.rec.tags.artist || !match.rec.tags.trackNo);
    if (missing && !existing) {
      const marker = document.createElement("span");
      marker.className = "lfp-missing-marker";
      marker.title = "Missing tag data";
      marker.textContent = "⚠"; // ⚠
      titleEl.appendChild(marker);
    } else if (!missing && existing) {
      existing.remove();
    }
  }

  //#endregion

  //#region Observer / sweep (mirrors album-length's setupObserver -> scheduleInject -> injectAll)

  let injectScheduled = null;

  function scheduleInject() {
    if (injectScheduled) clearTimeout(injectScheduled);
    injectScheduled = setTimeout(injectAll, 120);
  }

  function injectAll() {
    if (!isLocalFilesPage()) {
      const tracklist = document.querySelector(SEL_TRACKLIST);
      if (tracklist) tracklist.classList.remove("lfp-active");
      if (customListEl) customListEl.style.display = "none";
      const wrapper = findTracklistRootlistWrapper();
      if (wrapper) wrapper.style.display = "";
      return;
    }
    tryAugmentNativeColumnPicker(); // idempotent; the picker button is page-specific and may not exist yet at boot
    ensureFilterInput();
    injectHeader();
    updateSortIndicators();
    renderCustomList(); // shows/hides the native list vs. our own, depending on isCustomViewActive()
    if (!isCustomViewActive() && activeColumns().length > 0) {
      document.querySelectorAll(SEL_TRACKLIST_ROW).forEach(injectRow);
    }
  }

  function setupObserver() {
    const target = document.querySelector(SEL_ROOT_MAIN_VIEW) || document.body;
    const observer = new MutationObserver(scheduleInject);
    observer.observe(target, { childList: true, subtree: true });
    if (Spicetify.Platform && Spicetify.Platform.History) {
      Spicetify.Platform.History.listen(() => {
        if (isLocalFilesPage()) rebuildRowLookupFromTracks().then(scheduleInject);
        else scheduleInject();
      });
    }
  }

  //#endregion

  //#region Column picker (augments Spotify's native "Change visible columns" popover; own popover as fallback)

  function tryAugmentNativeColumnPicker() {
    const btn = document.querySelector(SEL_COLUMN_PICKER_BTN);
    if (!btn || btn.dataset.lfpBound) return false;
    btn.dataset.lfpBound = "1";
    btn.addEventListener("click", () => {
      setTimeout(() => {
        const popover = [...document.querySelectorAll('[role="menu"], [role="dialog"]')].find((el) => el.textContent.includes("Album") || el.textContent.includes("Duration"));
        if (!popover || popover.querySelector(".lfp-picker-section")) return;
        injectPickerCheckboxes(popover);
      }, 50);
    });
    return true;
  }

  function injectPickerCheckboxes(popover) {
    const section = document.createElement("div");
    section.className = "lfp-picker-section";
    section.style.cssText = "border-top:1px solid var(--spice-button-disabled,#5e5e5e);margin-top:4px;padding-top:4px;";
    for (const col of COLUMN_DEFS) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;color:var(--spice-text,#fff);font-size:0.875rem;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!config.visibleColumns[col.id];
      checkbox.addEventListener("change", () => {
        config.visibleColumns[col.id] = checkbox.checked;
        saveConfig();
        updateGridStyle();
        injectAll();
      });
      row.appendChild(checkbox);
      row.appendChild(document.createTextNode(col.label));
      section.appendChild(row);
    }
    popover.appendChild(section);
  }

  //#endregion

  //#region Custom sort + filter (Spotify owns row order/virtualization for its
  // own list, so a custom sort or an active filter takes over rendering with a
  // small self-owned windowed list, reusing native row classes for visual parity.
  // The default state — no filter, no custom sort — leaves Spotify's own list in
  // place untouched.)

  let customSortColId = null;
  let customSortDir = "asc";
  let filterText = "";
  let customListEl = null;
  let customScrollEl = null;

  function isCustomViewActive() {
    return !!filterText || !!customSortColId;
  }

  /** @param {string} raw @returns {(entry: {track: any, rec: FileRecord|null}) => boolean} */
  function compileFilter(raw) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    /** @type {Array<(e: any) => boolean>} */
    const preds = [];
    for (const tok of tokens) {
      const m = tok.match(/^(\w+):(.+)$/);
      if (!m) {
        const needle = tok.toLowerCase();
        if (needle === "flac" || needle === "lossless") {
          preds.push((e) => !!(e.rec && e.rec.quality.lossless));
        } else if (/^(mp3|m4a|mp4|flac|ogg|oga|opus|wav|aac|wma)$/.test(needle)) {
          preds.push((e) => e.rec && e.rec.ext === "." + needle);
        } else {
          preds.push((e) => {
            const hay = [e.track.name, e.rec && e.rec.tags.artist, e.rec && e.rec.tags.album, e.rec && e.rec.folder]
              .filter(Boolean).join(" ").toLowerCase();
            return hay.includes(needle);
          });
        }
        continue;
      }
      const [, key, val] = m;
      const lowerKey = key.toLowerCase();
      if (lowerKey === "bitrate") {
        const cmp = val.match(/^([<>]=?)?(\d+)$/);
        if (cmp) {
          const op = cmp[1] || "=", n = parseInt(cmp[2], 10);
          preds.push((e) => {
            const kbps = e.rec && !e.rec.quality.lossless ? e.rec.quality.bitrateKbps : null;
            if (kbps == null) return false;
            if (op === ">" || op === ">=") return kbps >= n;
            if (op === "<" || op === "<=") return kbps <= n;
            return kbps === n;
          });
        }
      } else if (lowerKey === "year") {
        const n = parseInt(val, 10);
        preds.push((e) => e.rec && e.rec.tags.year === n);
      } else if (lowerKey === "genre") {
        const needle = val.toLowerCase();
        preds.push((e) => e.rec && (e.rec.tags.genre || "").toLowerCase().includes(needle));
      } else if (lowerKey === "folder") {
        const needle = val.toLowerCase();
        preds.push((e) => e.rec && e.rec.folder.toLowerCase().includes(needle));
      } else if (lowerKey === "missing") {
        const field = val.toLowerCase();
        preds.push((e) => {
          if (!e.rec) return true;
          if (field === "album") return !e.track.album || !e.track.album.name;
          if (field === "artist") return !e.rec.tags.artist;
          if (field === "track" || field === "tracknumber") return !e.rec.tags.trackNo;
          return false;
        });
      } else if (lowerKey === "type" || lowerKey === "ext") {
        const needle = "." + val.toLowerCase().replace(/^\./, "");
        preds.push((e) => e.rec && e.rec.ext === needle);
      } else if (lowerKey === "lossless" || lowerKey === "flac") {
        preds.push((e) => !!(e.rec && e.rec.quality.lossless));
      }
    }
    return (e) => preds.every((p) => p(e));
  }

  function buildAndFilterSortRows() {
    const filterFn = filterText ? compileFilter(filterText) : null;
    let rows = cachedTracks.map((track) => ({ track, rec: trackMatchIndex.get(track.uri) || null }));
    if (filterFn) rows = rows.filter(filterFn);
    if (customSortColId) {
      const def = COLUMN_DEFS.find((c) => c.id === customSortColId);
      if (def) {
        rows.sort((a, b) => {
          const av = def.sortVal(a.rec), bv = def.sortVal(b.rec);
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return customSortDir === "asc" ? cmp : -cmp;
        });
      }
    } else {
      rows.sort((a, b) => a.track.name.localeCompare(b.track.name));
    }
    return rows;
  }

  function ensureCustomListEl() {
    if (customListEl && document.contains(customListEl)) return customListEl;
    const wrapper = findTracklistRootlistWrapper();
    if (!wrapper || !wrapper.parentElement) return null;
    customListEl = document.createElement("div");
    customListEl.id = "lfp-custom-list";
    customListEl.style.cssText = "position:relative;";
    wrapper.parentElement.insertBefore(customListEl, wrapper);
    customScrollEl = wrapper.closest("[data-overlayscrollbars-viewport]") || wrapper.parentElement;
    customScrollEl.addEventListener("scroll", () => renderCustomList(), { passive: true });
    return customListEl;
  }

  function renderCustomRow(entry, index) {
    const { track, rec } = entry;
    const row = document.createElement("div");
    row.className = "main-trackList-trackListRow main-trackList-trackListRowGrid lfp-custom-row";
    row.style.cssText = `position:absolute; top:${index * ROW_HEIGHT_PX}px; left:0; right:0; height:${ROW_HEIGHT_PX}px; cursor:pointer;`;
    row.addEventListener("click", () => {
      try { Spicetify.Player.playUri(track.uri); } catch (e) { console.warn(LOG_PREFIX, "Playback failed.", e); }
    });

    const indexCell = document.createElement("div");
    indexCell.className = "main-trackList-rowSectionIndex lfp-cell";
    indexCell.textContent = String(index + 1);
    row.appendChild(indexCell);

    const titleCell = document.createElement("div");
    titleCell.className = "main-trackList-rowSectionStart lfp-cell";
    titleCell.style.cssText = "flex-direction:column; align-items:flex-start; justify-content:center; overflow:hidden;";
    const titleLine = document.createElement("div");
    titleLine.style.cssText = "color:var(--spice-text,#fff); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;";
    titleLine.textContent = track.name;
    const artistLine = document.createElement("div");
    artistLine.style.cssText = "font-size:0.8em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;";
    artistLine.textContent = (rec && rec.tags.artist) || (track.artists && track.artists[0] && track.artists[0].name) || "";
    titleCell.appendChild(titleLine);
    titleCell.appendChild(artistLine);
    row.appendChild(titleCell);

    for (const col of activeColumns()) {
      const cell = document.createElement("div");
      cell.className = "main-trackList-rowSectionVariable lfp-cell" + (col.align === "right" ? " lfp-cell--right" : "");
      cell.textContent = col.get(rec);
      row.appendChild(cell);
    }

    const durationCell = document.createElement("div");
    durationCell.className = "main-trackList-rowSectionEnd lfp-cell lfp-cell--right";
    durationCell.textContent = formatDurationMs(track.duration.milliseconds);
    row.appendChild(durationCell);

    return row;
  }

  function renderCustomList() {
    const wrapper = findTracklistRootlistWrapper();
    if (!wrapper) return;
    const active = isCustomViewActive();
    wrapper.style.display = active ? "none" : "";
    if (!active) {
      if (customListEl) customListEl.style.display = "none";
      return;
    }
    const container = ensureCustomListEl();
    if (!container) return;
    container.style.display = "";

    const rows = buildAndFilterSortRows();
    container.style.height = rows.length * ROW_HEIGHT_PX + "px";

    const scrollEl = customScrollEl || container.parentElement;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const viewHeight = scrollEl ? scrollEl.clientHeight : 600;
    const buffer = 8;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - buffer);
    const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT_PX) + buffer);

    container.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.appendChild(renderCustomRow(rows[i], i));
    container.appendChild(frag);

    const status = document.getElementById("lfp-filter-status");
    if (status) status.textContent = filterText ? `${rows.length} match${rows.length === 1 ? "" : "es"}` : "";
  }

  function updateSortIndicators() {
    document.querySelectorAll("[data-lfp-col]").forEach((cell) => {
      if (!cell.matches('[role="columnheader"]')) return;
      const id = cell.dataset.lfpCol;
      const def = COLUMN_DEFS.find((c) => c.id === id);
      if (!def) return;
      const suffix = id === customSortColId ? (customSortDir === "asc" ? " ▲" : " ▼") : "";
      const wanted = def.label + suffix;
      if (cell.textContent !== wanted) cell.textContent = wanted;
    });
  }

  function ensureFilterInput() {
    if (document.getElementById("lfp-filter-input")) return;
    // Anchored above the header row (the same stable container used for header
    // cell insertion) rather than inside Spotify's own toolbar — that toolbar's
    // flex layout is not well understood and swallowed the input visually.
    const headerRow = document.querySelector(SEL_TRACKLIST_HEADER_ROW);
    if (!headerRow || !headerRow.parentElement) return;

    const wrap = document.createElement("div");
    wrap.id = "lfp-filter-bar";
    wrap.style.cssText = "display:flex; align-items:center; gap:8px; padding:4px 16px 8px;";
    const input = document.createElement("input");
    input.id = "lfp-filter-input";
    input.type = "text";
    input.placeholder = "Filter local files (e.g. flac year:2019 genre:jazz)";
    input.value = filterText;
    input.style.cssText = "background:var(--spice-highlight-elevated,#2a2a2a); color:var(--spice-text,#fff); border:1px solid var(--spice-button-disabled,#5e5e5e); border-radius:4px; padding:4px 8px; font-size:0.8125rem; width:280px; box-sizing:border-box;";
    input.addEventListener("input", () => {
      filterText = input.value;
      renderCustomList();
    });
    const status = document.createElement("span");
    status.id = "lfp-filter-status";
    status.style.cssText = "font-size:0.75rem; color:var(--spice-subtext,#a7a7a7); white-space:nowrap;";
    wrap.appendChild(input);
    wrap.appendChild(status);
    headerRow.parentElement.insertBefore(wrap, headerRow);
  }

  //#endregion

  //#region Settings modal

  /**
   * Inline-styled rather than via Spotify's own button classes — those are
   * hashed/versioned Encore classes (`e-10810-*` in this build) that differ
   * across Spotify releases, so guessing a class name silently renders an
   * unstyled native button instead of erroring.
   */
  function styleModalButton(btn, primary) {
    btn.style.cssText = primary
      ? "margin-right:8px;margin-top:8px;padding:8px 16px;border-radius:500px;border:none;background:var(--spice-button,#1ed760);color:var(--spice-text,#000);font-weight:700;cursor:pointer;"
      : "margin-top:8px;padding:8px 16px;border-radius:500px;border:1px solid var(--spice-button-disabled,#727272);background:transparent;color:var(--spice-text,#fff);font-weight:700;cursor:pointer;";
  }

  function openSettingsModal() {
    const container = document.createElement("div");
    container.style.cssText = "padding:16px;color:var(--spice-text,#fff);min-width:360px;";

    const status = document.createElement("p");
    status.textContent = dirHandle
      ? `Folder: ${config.lastFolderName || dirHandle.name} — ${fileIndex.size} files indexed.`
      : pendingHandle
        ? `Folder "${config.lastFolderName || pendingHandle.name}" needs access re-granted.`
        : "No music folder selected yet.";
    container.appendChild(status);

    const afterGrant = async () => {
      status.textContent = "Scanning...";
      await runScan((progress) => { status.textContent = `Scanning... ${progress}`; });
      await refreshMatchIndex();
      await rebuildRowLookupFromTracks();
      updateGridStyle();
      injectAll();
      status.textContent = `Folder: ${config.lastFolderName} — ${fileIndex.size} files indexed.`;
    };

    if (!dirHandle && pendingHandle) {
      const regrantBtn = document.createElement("button");
      regrantBtn.textContent = "Re-grant access";
      styleModalButton(regrantBtn, true);
      regrantBtn.addEventListener("click", async () => {
        try {
          const perm = await requestPermissionOnExistingHandle(pendingHandle);
          if (perm === "granted") { pendingHandle = null; await afterGrant(); }
          else status.textContent = "Access not granted.";
        } catch (e) {
          console.error(LOG_PREFIX, "Re-grant failed.", e);
        }
      });
      container.appendChild(regrantBtn);
    }

    const grantBtn = document.createElement("button");
    grantBtn.textContent = dirHandle ? "Change folder" : "Choose music folder";
    styleModalButton(grantBtn, true);
    grantBtn.addEventListener("click", async () => {
      try {
        await pickFolder();
        pendingHandle = null;
        await afterGrant();
      } catch (e) {
        if (e && e.name !== "AbortError") console.error(LOG_PREFIX, "Folder pick failed.", e);
      }
    });
    container.appendChild(grantBtn);

    const rescanBtn = document.createElement("button");
    rescanBtn.textContent = "Rescan";
    styleModalButton(rescanBtn, false);
    rescanBtn.disabled = !dirHandle;
    if (rescanBtn.disabled) rescanBtn.style.opacity = "0.5";
    rescanBtn.addEventListener("click", afterGrant);
    container.appendChild(rescanBtn);

    Spicetify.PopupModal.display({ title: "Local Files+", content: container, isLarge: false });
  }

  //#endregion

  //#region Boot

  async function waitForSpicetify() {
    while (!(Spicetify && Spicetify.Platform && Spicetify.Platform.History && Spicetify.Platform.LocalFilesAPI && Spicetify.LocalStorage && Spicetify.Menu && Spicetify.PopupModal)) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function main() {
    await waitForSpicetify();
    console.log(LOG_PREFIX, "Starting...");

    config = loadConfig();
    await loadIndexFromIndexedDb();

    const restored = await restoreHandle();
    if (restored) {
      const perm = await restored.queryPermission({ mode: "read" });
      if (perm === "granted") dirHandle = restored;
      else pendingHandle = restored; // needs a click to re-grant; offered in the settings modal
    }

    if (fileIndex.size > 0) {
      await refreshMatchIndex();
      await rebuildRowLookupFromTracks();
    }

    updateGridStyle();

    new Spicetify.Menu.Item("Local Files+", false, openSettingsModal).register();

    setupObserver();
    tryAugmentNativeColumnPicker();
    scheduleInject();

    console.log(LOG_PREFIX, "Initialized.");
  }

  main().catch((e) => console.error(LOG_PREFIX, "Fatal init error.", e));

  //#endregion
})();
