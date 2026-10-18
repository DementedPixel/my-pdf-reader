import {useEffect, useRef, useState} from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import {pdfjs} from './pdf';
import type {PDFDocumentProxy} from './pdf';

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
}

export function PageView({doc, pageNumber, scale, width, height}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: {cancel(): void} | null = null;
    let text: {cancel(): void} | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({scale});
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      const render = page.render({
        canvas: c,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      task = render;
      const layer = textLayer.current!;
      layer.replaceChildren();
      layer.style.setProperty('--scale-factor', String(scale));
      const tl = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      });
      text = tl;
      try {
        await Promise.all([render.promise, tl.render()]);
      } catch {
        // cancelled render
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [visible, doc, pageNumber, scale]);

  return (
    <div ref={host} className='page' data-page={pageNumber} style={{width, height}}>
      {visible && (
        <>
          <canvas ref={canvas} style={{width, height}} />
          <div ref={textLayer} className='textLayer' />
        </>
      )}
    </div>
  );
}
