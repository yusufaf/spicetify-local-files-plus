# Contributing

Contributions are welcome! This is a single-file Spicetify extension, so getting
started is easy.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Copy `local-files-plus.js` to your Spicetify Extensions folder:
   - **Windows:** `%APPDATA%\spicetify\Extensions\`
   - **macOS/Linux:** `~/.config/spicetify/Extensions/`
4. Add `local-files-plus.js` to the `extensions` line in `config-xpui.ini`
5. Run `spicetify apply` to load changes

## Development

No build step required — just edit the JavaScript file directly.

**Testing changes:**
```bash
pnpm test           # node --check — syntax gate
spicetify apply
```
Spotify will restart with your changes.

The tag parsers (ID3v2, Vorbis comment, MP4 atom) are pure functions and can be
tested under Node directly — see the `module.exports` guard at the bottom of
`local-files-plus.js`.

**Debug output:**
- Open DevTools: `Ctrl+Shift+J` (Windows) / `Cmd+Option+J` (macOS)
- Look for `[Local Files+]` prefixed console messages

## Code Style

- Use JSDoc comments for functions
- Keep code organized in `//#region` blocks
- Use descriptive variable names
- Test with both light and dark Spicetify themes

## Pull Requests

1. Open an issue first to discuss proposed changes
2. Fork and create a feature branch
3. Make your changes
4. Submit PR with clear description of changes

## Areas for Improvement

- OGG/Opus/WAV tag parsing (currently indexed for size/type only)
- Per-frame ID3v2.4 unsynchronization (only the tag-level flag is handled)
- Smarter re-grant flow if the browser drops File System Access permission across restarts

## Questions?

Open an issue for any questions or suggestions.
