import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {pdfjs, searchDocument} from './pdf';
import type {PDFDocumentProxy, PageViewport, SearchHit} from './pdf';
import {PageView} from './PageView';
import {Sidebar} from './Sidebar';
import {OverLayer, UnderLayer} from './AnnotationLayer';
import type {Handlers} from './AnnotationLayer';
import {printPdf} from './print';
import {COLORS, bakeAnnotations, newId} from './annotations';
import type {Ann, Box, Tool} from './annotations';

type SideTab = 'thumbs' | 'outline' | null;

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

const TOOLS: {id: Tool; label: string; hint: string}[] = [
  {id: 'select', label: 'Select', hint: 'Select and copy text (Esc)'},
  {id: 'highlight', label: 'Highlight', hint: 'Select text, then it is highlighted'},
  {id: 'underline', label: 'Underline', hint: 'Select text to underline it'},
  {id: 'strike', label: 'Strike', hint: 'Select text to strike it through'},
  {id: 'note', label: 'Note', hint: 'Click the page to add a note'},
  {id: 'text', label: 'Text', hint: 'Click or drag to add a text box'},
  {id: 'draw', label: 'Draw', hint: 'Freehand drawing'},
  {id: 'eraser', label: 'Erase', hint: 'Click an annotation to delete it'},
];

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

/** Convert the current text selection into per-page line rectangles at scale 1. */
function selectionBoxes(scroller: HTMLElement, scale: number): Map<number, Box[]> {
  const out = new Map<number, Box[]>();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return out;
  const all = Array.from(sel.getRangeAt(0).getClientRects()).filter(
    r => r.width > 1 && r.height > 1,
  );
  // Drop container boxes: any rect that fully encloses a clearly smaller one.
  const rects = all.filter(
    r =>
      !all.some(
        s =>
          s !== r &&
          s.left >= r.left - 0.5 &&
          s.right <= r.right + 0.5 &&
          s.top >= r.top - 0.5 &&
          s.bottom <= r.bottom + 0.5 &&
          r.height > s.height * 1.5,
      ),
  );
  const pages = Array.from(scroller.querySelectorAll<HTMLElement>('.page'));
  for (const r of rects) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = pages.find(p => {
      const b = p.getBoundingClientRect();
      return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
    });
    if (!el) continue;
    const b = el.getBoundingClientRect();
    const list = out.get(Number(el.dataset.page)) ?? [];
    list.push({
      x: (r.left - b.left) / scale,
      y: (r.top - b.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    });
    out.set(Number(el.dataset.page), list);
  }
  return out;
}

export function App() {
  const [file, setFile] = useState<OpenedPdf | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [vps, setVps] = useState<PageViewport[]>([]);
  const [scale, setScale] = useState(1.25);
  const [current, setCurrent] = useState(1);
  const [side, setSide] = useState<SideTab>('thumbs');
  const [dark, setDark] = useState(store.get('dark') !== '0');
  const [invert, setInvert] = useState(store.get('invert') === '1');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(COLORS[0]);
  const [anns, setAnnsState] = useState<Ann[]>([]);
  const [history, setHistoryState] = useState<Ann[][]>([]);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const annsRef = useRef<Ann[]>([]);
  const historyRef = useRef<Ann[][]>([]);
  const fileRef = useRef<OpenedPdf | null>(null);
  const vpsRef = useRef<PageViewport[]>([]);

  const setAnns = useCallback((next: Ann[]) => {
    annsRef.current = next;
    setAnnsState(next);
  }, []);
  const setHistory = useCallback((next: Ann[][]) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  const pushHistory = useCallback(
    (snap: Ann[]) => setHistory([...historyRef.current.slice(-99), snap]),
    [setHistory],
  );

  fileRef.current = file;
  vpsRef.current = vps;
  const dirty = anns.length > 0;

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    store.set('dark', dark ? '1' : '0');
  }, [dark]);
  useEffect(() => store.set('invert', invert ? '1' : '0'), [invert]);
  useEffect(() => window.reader.setDirty(dirty), [dirty]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /** Run `action` now, or after the user decides what to do with unsaved annotations. */
  const guard = useCallback((action: () => void) => {
    if (annsRef.current.length) setPending(() => action);
    else action();
  }, []);

  const loadFile = useCallback(
    (pdf: OpenedPdf) => {
      setAnns([]);
      setHistory([]);
      setTool('select');
      setFile(pdf);
    },
    [setAnns, setHistory],
  );

  useEffect(() => window.reader.onOpen(pdf => guard(() => loadFile(pdf))), [guard, loadFile]);
  useEffect(
    () => window.reader.onCloseRequested(() => guard(() => window.reader.closeNow())),
    [guard],
  );

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
        const out: PageViewport[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          out.push((await d.getPage(i)).getViewport({scale: 1}));
          if (dead) return;
        }
        setDoc(d);
        setVps(out);
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
    if (sc && vps[0]) setScale((sc.clientWidth - 48) / vps[0].width);
  };

  const openDialog = () =>
    guard(async () => {
      const pdf = await window.reader.pick();
      if (pdf) loadFile(pdf);
    });

  const runSearch = async () => {
    if (!doc || !query.trim()) {
      setHits(null);
      return;
    }
    setToast('Searching…');
    setHits(await searchDocument(doc, query.trim(), {cancelled: false}));
    setToast(null);
  };

  // ---- annotations ----

  const handlers: Handlers = useMemo(
    () => ({
      add(a) {
        if (a.kind !== 'note' && a.kind !== 'text') pushHistory(annsRef.current);
        setAnns([...annsRef.current, a]);
      },
      patch(id, p) {
        setAnns(annsRef.current.map(a => (a.id === id ? ({...a, ...p} as Ann) : a)));
      },
      remove(id) {
        pushHistory(annsRef.current);
        setAnns(annsRef.current.filter(a => a.id !== id));
      },
      discard(id) {
        setAnns(annsRef.current.filter(a => a.id !== id));
      },
      committed(id) {
        pushHistory(annsRef.current.filter(a => a.id !== id));
      },
    }),
    [pushHistory, setAnns],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.length) return;
    setAnns(h[h.length - 1]);
    setHistory(h.slice(0, -1));
  }, [setAnns, setHistory]);

  const addMarkup = () => {
    if (tool !== 'highlight' && tool !== 'underline' && tool !== 'strike') return;
    const sc = scroller.current;
    if (!sc) return;
    const byPage = selectionBoxes(sc, scale);
    if (!byPage.size) return;
    const added: Ann[] = [...byPage].map(([page, quads]) => ({
      id: newId(),
      page,
      kind: tool,
      color,
      quads,
    }));
    pushHistory(annsRef.current);
    setAnns([...annsRef.current, ...added]);
    window.getSelection()?.removeAllRanges();
  };

  /** Bake annotations into the PDF bytes, or return the original when there are none. */
  const bake = async (f: OpenedPdf) =>
    annsRef.current.length ? bakeAnnotations(f.data, annsRef.current, vpsRef.current) : f.data;

  const save = useCallback(async (): Promise<boolean> => {
    const f = fileRef.current;
    if (!f) return false;
    try {
      const data = await bake(f);
      if (/[\\/]/.test(f.path)) await window.reader.save(f.path, data);
      else {
        const r = await window.reader.saveAs(f.name, data);
        if (!r) return false;
        loadFile({name: r.name, path: r.path, data});
        setToast('Saved');
        return true;
      }
      loadFile({...f, data});
      setToast('Saved');
      return true;
    } catch (e) {
      setToast('Could not save: ' + String((e as Error)?.message ?? e));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFile]);

  const saveAs = async () => {
    const f = fileRef.current;
    if (!f) return;
    try {
      const data = await bake(f);
      const r = await window.reader.saveAs(f.name, data);
      if (r) {
        loadFile({name: r.name, path: r.path, data});
        setToast('Saved');
      }
    } catch (e) {
      setToast('Could not save: ' + String((e as Error)?.message ?? e));
    }
  };

  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const print = useCallback(async () => {
    const f = fileRef.current;
    if (!f || printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    try {
      const data = await bake(f);
      await printPdf(data, (done, total) => setToast(`Preparing to print… ${done}/${total}`));
      setToast(null);
    } catch (e) {
      setToast('Could not print: ' + String((e as Error)?.message ?? e));
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }, []);

  const resolvePending = async (choice: 'save' | 'discard' | 'cancel') => {
    const run = pending;
    setPending(null);
    if (!run || choice === 'cancel') return;
    if (choice === 'save' && !(await save())) return;
    if (choice === 'discard') {
      setAnns([]);
      setHistory([]);
    }
    run();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === 'Escape' && !pending) setTool('select');
      if (!(e.ctrlKey || e.metaKey)) return;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      const key = e.key.toLowerCase();
      if (key === 'o') act(openDialog);
      else if (key === 'p') act(() => void print());
      else if (key === 'f') act(() => searchBox.current?.focus());
      else if (key === 's') act(() => void (e.shiftKey ? saveAs() : save()));
      else if (key === 'z' && !typing) act(undo);
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
        ? vps.map((vp, i) => {
            const mine = anns.filter(a => a.page === i + 1);
            return (
              <PageView
                key={i}
                doc={doc}
                pageNumber={i + 1}
                scale={scale}
                width={Math.floor(vp.width * scale)}
                height={Math.floor(vp.height * scale)}
                under={<UnderLayer width={vp.width} height={vp.height} anns={mine} />}
                over={
                  <OverLayer
                    page={i + 1}
                    scale={scale}
                    width={vp.width}
                    height={vp.height}
                    anns={mine}
                    tool={tool}
                    color={color}
                    handlers={handlers}
                  />
                }
              />
            );
          })
        : null,
    [doc, vps, scale, anns, tool, color, handlers],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f || !f.name.toLowerCase().endsWith('.pdf')) return;
    f.arrayBuffer().then(buf =>
      guard(() =>
        loadFile({
          name: f.name,
          path: window.reader.pathForFile(f) || f.name,
          data: new Uint8Array(buf),
        }),
      ),
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
        <button
          disabled={!doc || !dirty}
          className={dirty ? 'primary' : ''}
          onClick={() => void save()}
          title='Save annotations into this file (Ctrl+S)'
        >
          Save{dirty ? ' •' : ''}
        </button>
        <button
          disabled={!doc}
          onClick={() => void saveAs()}
          title='Save as a new file (Ctrl+Shift+S)'
        >
          Save as…
        </button>
        <button disabled={!doc || printing} onClick={() => void print()} title='Print (Ctrl+P)'>
          Print
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

      <div className='toolbar annot'>
        {TOOLS.map(t => (
          <button
            key={t.id}
            disabled={!doc}
            className={tool === t.id ? 'on' : ''}
            title={t.hint}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className='sep' />
        {COLORS.map(c => (
          <button
            key={c}
            disabled={!doc}
            className={'swatch' + (color === c ? ' on' : '')}
            style={{background: c}}
            title={c}
            onClick={() => setColor(c)}
          />
        ))}
        <span className='sep' />
        <button disabled={!history.length} onClick={undo} title='Undo (Ctrl+Z)'>
          Undo
        </button>
        {dirty && <span className='muted'>{anns.length} unsaved</span>}
      </div>

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
        <main
          ref={scroller}
          className={'viewer' + (invert ? ' invert' : '')}
          onScroll={onScroll}
          onMouseUp={addMarkup}
        >
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
      {toast && <div className='toast'>{toast}</div>}
      {dragging && <div className='drop'>Drop PDF to open</div>}
      {pending && (
        <div className='modal-backdrop'>
          <div className='modal' role='dialog' aria-modal='true'>
            <h2>Save your annotations?</h2>
            <p>
              You have {anns.length} unsaved annotation{anns.length === 1 ? '' : 's'} in{' '}
              {file?.name}.
            </p>
            <div className='modal-actions'>
              <button onClick={() => resolvePending('cancel')}>Cancel</button>
              <button onClick={() => resolvePending('discard')}>Don’t save</button>
              <button className='primary' onClick={() => resolvePending('save')} autoFocus>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
