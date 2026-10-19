import {pdfjs} from './pdf';

/** Print resolution. Pages are rasterised, so this trades file size in memory for sharpness. */
const PRINT_DPI = 200;

const blobOf = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      b => (b ? resolve(b) : reject(new Error('Could not render page'))),
      'image/jpeg',
      0.92,
    ),
  );

/**
 * Print a PDF through the system print dialog.
 *
 * Takes the bytes (annotations already baked in) rather than the live viewer, so the printout
 * matches a saved copy and ignores zoom and night-page inversion. Each page becomes one sheet in
 * a hidden container that only `@media print` reveals; the dialog's page range then maps 1:1 to
 * PDF pages.
 */
export async function printPdf(
  data: Uint8Array,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const task = pdfjs.getDocument({data: data.slice()});
  const doc = await task.promise;
  const root = document.createElement('div');
  root.id = 'print-root';
  const urls: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(n - 1, doc.numPages);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({scale: PRINT_DPI / 72});
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({canvas, viewport}).promise;
      const url = URL.createObjectURL(await blobOf(canvas));
      urls.push(url);
      page.cleanup();
      const img = document.createElement('img');
      img.src = url;
      root.append(img);
    }
    onProgress(doc.numPages, doc.numPages);
    document.body.append(root);
    await Promise.all(Array.from(root.children, i => (i as HTMLImageElement).decode()));
    // Blocks while the system dialog is open.
    window.print();
  } finally {
    root.remove();
    urls.forEach(u => URL.revokeObjectURL(u));
    await task.destroy();
  }
}
