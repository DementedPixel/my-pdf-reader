# PDF Reader

A fast, offline PDF reader. No account, no cloud, no telemetry, no upsells.

Built clean-room on [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), Electron and React.
No Adobe code or assets are used.

## Features

- Continuous scrolling with lazy page rendering, zoom (Ctrl +/-), fit width (Ctrl 0)
- Page thumbnails and bookmarks (outline)
- Full-document search (Ctrl F) with a results list
- Selectable text, drag-and-drop open, `.pdf` file association, remembers last page per file
- Dark UI and "night pages" inversion
- Save a copy

## Privacy guarantee

The main process cancels every non-localhost `http(s)`/`ws(s)` request, the renderer CSP forbids
remote connections, and there is no auto-updater. Nothing leaves your machine.

## Develop

```bash
npm install
npm run dev
npm run dist
```

## Roadmap

Annotations (highlight, notes, draw), form filling, signing, page tools, tabs, password-protected PDFs, print.
