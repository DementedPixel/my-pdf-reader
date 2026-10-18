import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export {pdfjs};
export type {PDFDocumentProxy, PDFPageProxy, PageViewport} from 'pdfjs-dist';

export interface SearchHit {
  page: number;
  snippet: string;
}

export async function searchDocument(
  doc: import('pdfjs-dist').PDFDocumentProxy,
  query: string,
  signal: {cancelled: boolean},
): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    if (signal.cancelled) break;
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map(i => ('str' in i ? i.str : '')).join(' ');
    const lower = text.toLowerCase();
    let at = lower.indexOf(q);
    while (at !== -1 && hits.length < 500) {
      hits.push({page: p, snippet: text.slice(Math.max(0, at - 30), at + q.length + 50)});
      at = lower.indexOf(q, at + q.length);
    }
  }
  return hits;
}
