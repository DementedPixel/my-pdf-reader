import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {pdfjs, searchDocument} from './pdf';
import type {PDFDocumentProxy, SearchHit} from './pdf';
import {PageView} from './PageView';
import {Sidebar} from './Sidebar';

type SizeMap = {w: number; h: number}[];
type SideTab = 'thumbs' | 'outline' | null;

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // storage unavailable
    }
  },
};

export function App() {
  const [file, setFile] = useState<OpenedPdf | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<SizeMap>([]);
  const [scale, setScale] = useState(1.25);
  const [current, setCurrent] = useState(1);
  const [side, setSide] = useState<SideTab>('thumbs');
  const [dark, setDark] = useState(store.get('dark') !== '0');
  const [invert, setInvert] = useState(store.get('invert') === '1');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    store.set('dark', dark ? '1' : '0');
  }, [dark]);
  useEffect(() => store.set('invert', invert ? '1' : '0'), [invert]);

  const openPdf = useCallback((pdf: OpenedPdf) => setFile(pdf), []);

  useEffect(() => window.reader.onOpen(openPdf), [openPdf]);

  const goTo = useCallback((n: number, smooth = true) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({block: 'start', behavior: smooth ? 'smooth' : 'auto'});
  }, []);

  useEffect(() => {
    if (!file) return;
    let dead = false;
    setError(null);
    setHits(null);
    setQuery('');
    // pdf.js transfers the buffer to its worker, so hand it a copy.
    const task = pdfjs.getDocument({data: file.data.slice()});
    task.promise
      .then(async d => {
        if (dead) return;
        const out: SizeMap = [];
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({scale: 1});
          out.push({w: vp.width, h: vp.height});
          if (dead) return;
        }
        setDoc(d);
        setSizes(out);
        const saved = Number(store.get('page:' + file.path));
        const start = saved >= 1 && saved <= d.numPages ? saved : 1;
        setCurrent(start);
        requestAnimationFrame(() => goTo(start, false));
      })
      .catch(e => {
        if (dead) return;
        setError(
          e?.name === 'PasswordException'
            ? 'Password-protected PDFs are not supported yet.'
            : String(e?.message ?? e),
        );
      });
    return () => {
      dead = true;
      task.destroy();
      setDoc(null);
    };
  }, [file, goTo]);

  const onScroll = () => {
    const sc = scroller.current;
    if (!sc || !file) return;
    const mid = sc.scrollTop + sc.clientHeight / 3;
    let best = 1;
    for (const el of sc.querySelectorAll<HTMLElement>('[data-page]')) {
      if (el.offsetTop - sc.offsetTop <= mid) best = Number(el.dataset.page);
      else break;
    }
    if (best !== current) {
      setCurrent(best);
      store.set('page:' + file.path, String(best));
    }
  };

  const zoom = (f: number) => setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * f)));
  const fitWidth = () => {
    const sc = scroller.current;
    if (sc && sizes[0]) setScale((sc.clientWidth - 48) / sizes[0].w);
  };

  const openDialog = async () => {
    const pdf = await window.reader.pick();
    if (pdf) openPdf(pdf);
  };

  const runSearch = async () => {
    if (!doc || !query.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    setHits(await searchDocument(doc, query.trim(), {cancelled: false}));
    setSearching(false);
  };

  const saveCopy = async () => {
    if (doc && file) await window.reader.saveAs(file.name, await doc.getData());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.key === 'o') act(openDialog);
      else if (e.key === 'f') act(() => searchBox.current?.focus());
      else if (e.key === '=' || e.key === '+') act(() => zoom(1.15));
      else if (e.key === '-') act(() => zoom(1 / 1.15));
      else if (e.key === '0') act(fitWidth);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pages = useMemo(
    () =>
      doc
        ? sizes.map((s, i) => (
            <PageView
              key={i}
              doc={doc}
              pageNumber={i + 1}
              scale={scale}
              width={Math.floor(s.w * scale)}
              height={Math.floor(s.h * scale)}
            />
          ))
        : null,
    [doc, sizes, scale],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f || !f.name.toLowerCase().endsWith('.pdf')) return;
    f.arrayBuffer().then(buf =>
      openPdf({
        name: f.name,
        path: window.reader.pathForFile(f) || f.name,
        data: new Uint8Array(buf),
      }),
    );
  };

  return (
    <div
      className='app'
      onDragOver={e => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className='toolbar'>
        <button onClick={openDialog} title='Open (Ctrl+O)'>
          Open
        </button>
        <button disabled={!doc} onClick={saveCopy} title='Save a copy'>
          Save copy
        </button>
        <span className='sep' />
        <button
          disabled={!doc}
          className={side === 'thumbs' ? 'on' : ''}
          onClick={() => setSide(side === 'thumbs' ? null : 'thumbs')}
        >
          Pages
        </button>
        <button
          disabled={!doc}
          className={side === 'outline' ? 'on' : ''}
          onClick={() => setSide(side === 'outline' ? null : 'outline')}
        >
          Bookmarks
        </button>
        <span className='sep' />
        <button disabled={!doc || current <= 1} onClick={() => goTo(current - 1)}>
          ‹
        </button>
        <input
          className='pageno'
          disabled={!doc}
          value={doc ? current : ''}
          onChange={e => {
            const n = Number(e.target.value);
            if (doc && n >= 1 && n <= doc.numPages) goTo(n, false);
          }}
        />
        <span className='muted'>/ {doc?.numPages ?? '–'}</span>
        <button
          disabled={!doc || current >= (doc?.numPages ?? 0)}
          onClick={() => goTo(current + 1)}
        >
          ›
        </button>
        <span className='sep' />
        <button disabled={!doc} onClick={() => zoom(1 / 1.15)} title='Zoom out (Ctrl+-)'>
          −
        </button>
        <span className='zoom'>{Math.round(scale * 100)}%</span>
        <button disabled={!doc} onClick={() => zoom(1.15)} title='Zoom in (Ctrl+=)'>
          +
        </button>
        <button disabled={!doc} onClick={fitWidth} title='Fit width (Ctrl+0)'>
          Fit
        </button>
        <span className='spacer' />
        <input
          ref={searchBox}
          className='search'
          placeholder='Find in document (Ctrl+F)'
          value={query}
          disabled={!doc}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runSearch()}
        />
        <button
          onClick={() => setInvert(v => !v)}
          className={invert ? 'on' : ''}
          title='Invert page colours'
        >
          Night pages
        </button>
        <button onClick={() => setDark(v => !v)}>{dark ? 'Light UI' : 'Dark UI'}</button>
      </header>

      <div className='body'>
        {doc && side && hits === null && (
          <Sidebar doc={doc} current={current} tab={side} onGo={n => goTo(n, false)} />
        )}
        {hits !== null && (
          <aside className='sidebar results'>
            <div className='results-head'>
              <strong>
                {hits.length} result{hits.length === 1 ? '' : 's'}
              </strong>
              <button onClick={() => setHits(null)}>×</button>
            </div>
            {hits.map((h, i) => (
              <button key={i} className='hit' onClick={() => goTo(h.page, false)}>
                <span className='muted'>p.{h.page}</span> {h.snippet}
              </button>
            ))}
          </aside>
        )}
        <main ref={scroller} className={'viewer' + (invert ? ' invert' : '')} onScroll={onScroll}>
          {error && <p className='empty'>{error}</p>}
          {!file && !error && (
            <div className='empty'>
              <h1>PDF Reader</h1>
              <p>Drop a PDF here or press Ctrl+O. Everything stays on this computer.</p>
            </div>
          )}
          {file && !doc && !error && <p className='empty'>Opening {file.name}…</p>}
          {pages}
        </main>
      </div>
      {searching && <div className='toast'>Searching…</div>}
      {dragging && <div className='drop'>Drop PDF to open</div>}
    </div>
  );
}
