# Live Tests — Local Files+

Extension file: `local-files-plus.js`
Use skill `spicetify-live-test` for CDP mechanics (reload, eval, screenshot, console).

## Storage

| Key | Where | Contents |
|-----|-------|----------|
| `local-files-plus-config` | `Spicetify.LocalStorage` | JSON `{visibleColumns, columnOrder, lastFolderName}` |
| IndexedDB `local-files-plus` / store `handles` | browser | the granted `FileSystemDirectoryHandle`, key `music-folder` |
| IndexedDB `local-files-plus` / store `tracks` | browser | one `FileRecord` per absolute path (lowercased key) |

## Smoke test (run after every edit)

1. `node --check local-files-plus.js` — syntax gate.
2. CDP reload xpui.
3. Console (filter `Local Files+`): expect `Starting...` then `Initialized.` with no errors in between.
4. `Spicetify.Platform.History.push('/collection/local-files')`; screenshot.

## T1: Parser correctness (no live client needed)

Pure functions, testable under plain `node` via `require('./local-files-plus.js')`
(the file no-ops past the `module.exports` guard when `document`/`window` are
undefined). Compare output against a real tag reader (e.g. the `audio-tag` MCP
server, which uses mutagen) on a handful of real MP3/FLAC/M4A files — artist, album
artist, year, genre, track/disc number should match exactly.

## T2: Grant + scan

- Profile menu → Local Files+ → Choose music folder → pick the same folder Spotify
  uses for Local Files.
- Console: `Scan complete: N parsed, ... total.` — `total` should match the number of
  audio files actually in the folder.
- IndexedDB `tracks` store count should equal `total`.

## T3: Match coverage

Every `Spicetify.Platform.LocalFilesAPI.getTracks()` entry should resolve to a
`FileRecord` — including ones with no `album.images[0].url` (Spotify only exposes a
disk path there for tracks it has *some* album tag for; the remainder rely on the
title+duration fallback match in `matchTracksToFiles`).

## T4: Columns render, no flicker

- Enable a few columns via the "Change visible columns" popover; confirm they appear
  in both the header and rows.
- Sample the same row's cell text repeatedly (~15 times, 300ms apart) while idle —
  it must be perfectly stable. (A prior bug: the missing-tag marker span, appended
  inside the same title element used for row matching, poisoned its own lookup key
  and caused every affected row to flicker between matched/blank forever. Any change
  near `applyMissingMarker` or `lookupRowRecord` should re-run this check.)

## T5: Missing-tag marker

A row whose matched file has no artist, no track number, or whose Spotify track has
no album should show a small ⚠ after the title. Toggling between matched/unmatched
must not leave a stale marker.

## T6: Column picker persistence

Toggle a column off/on via the native popover; reload; confirm the choice survived
(`Spicetify.LocalStorage.get('local-files-plus-config')`).

## T7: Sort + filter

- Click an extra column's header: arrow indicator appears, rows re-sort, clicking
  again reverses direction.
- Type into the filter bar (`flac`, `year:2019`, `bitrate:>256`, `missing:album`,
  `folder:<name>`): row count and status text (`N matches`) should update live, and
  the native list should be hidden in favor of the custom windowed list while a
  filter or sort is active. Clearing the filter (with no active sort) restores the
  native list.
- Click a row in the custom list: confirm `Spicetify.Player.isPlaying()` becomes
  `true` shortly after (`Spicetify.Player.data` is not populated in every build —
  don't rely on it).

## T8: Cache

Rescan without changing any files: `skippedUnchanged` should equal `total`, `parsed`
should be 0. Touch one file's mtime; only that file should re-parse.

## T9: Clean uninstall

Remove the extension, reload: the native grid returns to its normal 4-column layout,
`aria-colcount="4"`, no leftover `.lfp-*` elements or styles.
