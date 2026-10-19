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
- Annotations: highlight, underline, strike-through, notes, text boxes, freehand drawing, eraser, undo
  (Ctrl+Z). Saved into the PDF as standard annotations with appearance streams, so they show in
  any viewer. Ctrl+S saves in place (atomic write), Ctrl+Shift+S saves a copy.
- Print (Ctrl+P) through the system print dialog, all pages by default or any page range. Prints
  the document as it stands, including unsaved annotations.
- Unsaved-changes prompt when closing or opening another file

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

Form filling, signing, page tools, tabs, password-protected PDFs, editing/moving existing
annotations (currently only annotations added in the current session can be erased).

Known limits: printed pages are rasterised at 200 DPI and scaled to fit the sheet (mixed
portrait/landscape pages are not rotated individually), saving rewrites the whole file (digitally signed PDFs lose their signature), and
text-box text is limited to Latin characters (standard Helvetica).
