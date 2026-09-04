# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Spicetify extension (`local-files-plus.js`, ~1700 lines, no build step) that reads real tag metadata off local audio files via the File System Access API and injects it into Spotify's Local Files page as extra sortable, filterable columns. Everything ships as one IIFE.

## Commands

```bash
pnpm test          # node --check local-files-plus.js — syntax gate, the only automated test
pnpm install        # installs husky hooks via `prepare`
```

Husky runs `pnpm test` on pre-commit and `commitlint` (config-conventional) on commit-msg. Commit messages **must** be Conventional Commits — release-please parses them to cut releases.

### Testing changes in the real client

There is no unit test suite for the browser-facing code, but the tag parsers are pure functions (`ArrayBuffer`/`DataView` in, plain objects out) and run identically under `node` — they're guarded by `if (typeof module !== "undefined" && module.exports) { module.exports = {...} }` and the file returns early (`if (typeof document === "undefined" ...) return;`) before touching the DOM. That makes them testable against real files with `require("./local-files-plus.js")` from a small Node script, independent of Spotify — compare output against a real tag reader (e.g. the `audio-tag` MCP server, backed by mutagen) as an oracle.

Everything else needs the live client:

1. Copy `local-files-plus.js` to `%APPDATA%\spicetify\Extensions\` (Windows) or `~/.config/spicetify/Extensions/`.
2. `spicetify apply` — Spotify restarts. **Do not hardlink this file into the Extensions/xpui bundle locations** — `spicetify apply`'s extension-refresh step has been observed truncating a hardlinked file in place, which (since a hardlink is one file with multiple names) destroys the repo source too. Use plain copies and re-copy after each edit, or a real symlink if you have the privilege to create one.
3. DevTools (`Ctrl+Shift+J`), filter console for `[Local Files+]`.

`tests.live.md` holds the live smoke-test checklist. Use the `spicetify-live-test` skill for CDP mechanics (reload, eval, screenshot, console) instead of asking the user to click through manually. Note: `showDirectoryPicker()` opens a real native OS dialog that automation cannot drive — the one-time folder grant needs an actual human click. Everything downstream of a granted index (rendering, matching, sort, filter) can be tested by writing directly into the `local-files-plus` IndexedDB `tracks` store via CDP `evaluate_script`, bypassing the picker entirely.

## Architecture

**Parse → index → match → render**, four largely independent stages:

1. **Parse** (`parseId3v2Header/Body`, `parseFlac`, `parseMp4`) — format-specific byte parsers, each given a `readRange(offset, length) => Promise<ArrayBuffer>` callback rather than a whole file, so they only read the slices they need (ID3v2 header then exactly its declared size; FLAC block headers one at a time; MP4 walks top-level atom headers to find `moov`, then reads that whole subtree in one shot). This matters for MP4 specifically — `mdat` (the actual audio) can be gigabytes and must never be read.
2. **Index** (`runScan` → IndexedDB `tracks` store, keyed by lowercased absolute path) — a `FileRecord` per file: parsed tags + quality info + `size`/`lastModified` for change detection on rescan.
3. **Match** (`matchTracksToFiles`) — ties `Spicetify.Platform.LocalFilesAPI.getTracks()` entries to `FileRecord`s. Tier 1: decode the absolute path Spotify embeds in `track.album.images[0].url` (`spotify:localfileimage:<url-encoded-path>`) — this only exists for tracks Spotify itself found *some* album art/tag for. Tier 2: fuzzy-match the rest by normalized filename stem. Real bitrate is computed here (`computeBitrateKbps(file.size, track.duration.milliseconds / 1000)`) since local files only expose duration via `LocalFilesAPI`, not the file itself without a full audio decode.
4. **Render** — two paths depending on whether a custom sort/filter is active:
   - **Default**: augment Spotify's own virtualized list. `injectRow`/`injectHeader` insert `.lfp-cell` divs into each row/header, matched to Spicetify's own via `SEL_TRACKLIST_ROW`/`SEL_ROW_SECTION_END`. The grid itself is widened by an injected `<style>` overriding `--grid-template-columns` with `!important` on `.main-trackList-trackList.lfp-active` — writing to the element's own inline style directly gets clobbered by React on every re-render, but an `!important` stylesheet rule wins over a non-important inline style.
   - **Custom sort/filter active**: `renderCustomList()` hides Spotify's `.main-rootlist-wrapper` and renders its own small windowed list (`renderCustomRow`, fixed 56px rows, absolute-positioned, buffer of 8 rows above/below viewport) into a sibling container, since Spotify owns row order for its own list and there's no supported way to feed it a different sort.

**Rows are matched to tracks by visible text, not by DOM/React internals.** `lookupRowRecord` reads a row's title + duration text and looks them up in `rowLookupBuckets` (keyed `"title|duration"`, built from the already-resolved `trackMatchIndex`). This was a deliberate choice over reading the track URI out of the row's React fiber — Spotify sometimes silently substitutes a resolved catalog URI (`spotify:track:...`) for a local file's row instead of `spotify:local:...`, and fiber internals aren't a stable target across Spotify releases anyway. Text-based matching is what `spicetify-album-length` and `spicetify-listening-list` already do successfully.

**The self-poisoning bug to never reintroduce**: `applyMissingMarker` appends a `.lfp-missing-marker` span *inside* the same title element `lookupRowRecord` reads via `.textContent`. If you ever change that lookup back to `titleEl.textContent` instead of `directTextContent(titleEl)` (which reads only direct text-node children, skipping element children like the marker), you get an infinite loop: marker present → title text polluted → lookup fails → marker removed (since a failed match reads as "not missing") → title clean → lookup succeeds → marker re-added → repeat forever, at whatever the observer's debounce interval is. This shipped once and looked like random row flicker; `tests.live.md` T4 exists specifically to catch it again.

**`.main-rootlist-wrapper` is not unique** — the left sidebar's library list uses the same class. Always go through `findTracklistRootlistWrapper()` (scoped to inside `.main-trackList-trackList`), never a bare `document.querySelector(SEL_ROOTLIST_WRAPPER)` — the latter silently broke the sidebar in testing.

**Idempotency**: every DOM-mutating function is guarded to no-op when nothing actually changed (`if (cell.textContent !== text) cell.textContent = text`, `if (currentIds.join(",") !== wantedIds.join(","))` before tearing down/rebuilding cells). Assigning `.textContent` unconditionally — even to the same string — still replaces the child text node and fires a `childList` mutation, which re-triggers the extension's own `MutationObserver` and can loop forever if not guarded. `renumberColindex`/`classList.toggle` are attribute-only mutations and don't trigger the observer (it only watches `childList`+`subtree`), so those are safe unconditional.

**Button styling is inline, never a guessed Spotify class name.** Spotify's own button classes are hashed/versioned Encore classes (`e-10810-*` in the build this was developed against) that differ across releases — a class name copied from one build silently renders an unstyled native button in the next, with no error. Use `--spice-*` CSS custom properties inline instead (see `styleModalButton`, `.lfp-cell` rules).

### Storage keys

| Key | Contents |
|-----|----------|
| `local-files-plus-config` (`Spicetify.LocalStorage`) | JSON `{visibleColumns, columnOrder, lastFolderName}` |
| IndexedDB `local-files-plus` → `handles` | the granted `FileSystemDirectoryHandle` |
| IndexedDB `local-files-plus` → `tracks` | `FileRecord` per file, keyed by lowercased absolute path |

## Conventions

- Keep code in `//#region` blocks; JSDoc typedefs at the top drive editor tooling since there's no TypeScript build.
- Console output is prefixed `[Local Files+]`.
- `manifest.json` is the Spicetify Marketplace descriptor; `preview` must point at a file that actually exists in the repo.
- The version lives in the file header between `x-release-please-start-version`/`x-release-please-end-version` markers, and in `package.json`/`version.txt`. Don't bump versions by hand — release-please owns all three via `release-please-config.json`.
