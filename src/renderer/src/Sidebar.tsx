import {useEffect, useRef, useState} from 'react';
import type {PDFDocumentProxy} from './pdf';

interface OutlineNode {
  title: string;
  dest: unknown;
  items: OutlineNode[];
}

function Thumb({
  doc,
  n,
  active,
  onGo,
}: {
  doc: PDFDocumentProxy;
  n: number;
  active: boolean;
  onGo(n: number): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  const wrap = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true));
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    let dead = false;
    (async () => {
      const page = await doc.getPage(n);
      const vp0 = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: 120 / vp0.width});
      const c = ref.current;
      if (!c || dead) return;
      c.width = viewport.width;
      c.height = viewport.height;
      await page.render({canvas: c, viewport}).promise.catch(() => {});
    })();
    return () => {
      dead = true;
    };
  }, [seen, doc, n]);
  return (
    <button ref={wrap} className={'thumb' + (active ? ' active' : '')} onClick={() => onGo(n)}>
      <canvas ref={ref} width={120} height={160} />
      <span>{n}</span>
    </button>
  );
}

function Outline({items, onDest}: {items: OutlineNode[]; onDest(d: unknown): void}) {
  return (
    <ul className='outline'>
      {items.map((it, i) => (
        <li key={i}>
          <button onClick={() => onDest(it.dest)}>{it.title}</button>
          {it.items.length > 0 && <Outline items={it.items} onDest={onDest} />}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  doc: PDFDocumentProxy;
  current: number;
  tab: 'thumbs' | 'outline';
  onGo(n: number): void;
}

export function Sidebar({doc, current, tab, onGo}: Props) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    doc.getOutline().then(o => setOutline((o as OutlineNode[] | null) ?? []));
  }, [doc]);

  const goDest = async (dest: unknown) => {
    const d =
      typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null);
    if (!d) return;
    const ref = d[0] as {num: number; gen: number};
    onGo((await doc.getPageIndex(ref)) + 1);
  };

  if (tab === 'outline') {
    return (
      <aside className='sidebar'>
        {outline && outline.length ? (
          <Outline items={outline} onDest={goDest} />
        ) : (
          <p className='muted'>This document has no bookmarks.</p>
        )}
      </aside>
    );
  }
  return (
    <aside className='sidebar'>
      {Array.from({length: doc.numPages}, (_, i) => (
        <Thumb key={i} doc={doc} n={i + 1} active={current === i + 1} onGo={onGo} />
      ))}
    </aside>
  );
}
