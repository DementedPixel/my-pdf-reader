import {useRef, useState} from 'react';
import {INK_WIDTH, NOTE_SIZE, TEXT_SIZE, newId} from './annotations';
import type {Ann, Box, Pt, Tool} from './annotations';

export interface Handlers {
  add(a: Ann): void;
  patch(id: string, p: Partial<Ann>): void;
  remove(id: string): void;
  /** Remove without an undo step (an empty note / text box the user abandoned). */
  discard(id: string): void;
  /** A new note / text box got its first text: make its creation undoable. */
  committed(id: string): void;
}

const inBox = (p: Pt, b: Box, pad = 0) =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hit(a: Ann, p: Pt): boolean {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strike':
      return a.quads.some(q => inBox(p, q, 2));
    case 'ink':
      return a.points.some((pt, i) =>
        i === 0
          ? Math.hypot(p.x - pt.x, p.y - pt.y) < a.width + 4
          : segDist(p, a.points[i - 1], pt) < a.width + 4,
      );
    case 'note':
      return inBox(p, {x: a.at.x, y: a.at.y, w: NOTE_SIZE, h: NOTE_SIZE}, 2);
    case 'text':
      return inBox(p, a.box, 2);
  }
}

interface Props {
  page: number;
  scale: number;
  /** Page size at scale 1. */
  width: number;
  height: number;
  anns: Ann[];
  tool: Tool;
  color: string;
  handlers: Handlers;
}

/** Highlights, underlines, strike-throughs and ink: drawn under the text layer so text stays selectable. */
export function UnderLayer({width, height, anns}: Pick<Props, 'width' | 'height' | 'anns'>) {
  return (
    <svg className='ann-under' viewBox={`0 0 ${width} ${height}`}>
      {anns.map(a => {
        if (a.kind === 'highlight')
          return a.quads.map((q, i) => (
            <rect
              key={a.id + i}
              className='hl'
              x={q.x}
              y={q.y}
              width={q.w}
              height={q.h}
              fill={a.color}
            />
          ));
        if (a.kind === 'underline' || a.kind === 'strike')
          return a.quads.map((q, i) => {
            const y = a.kind === 'underline' ? q.y + q.h : q.y + q.h / 2;
            return (
              <line
                key={a.id + i}
                x1={q.x}
                x2={q.x + q.w}
                y1={y}
                y2={y}
                stroke={a.color}
                strokeWidth={1.2}
              />
            );
          });
        if (a.kind === 'ink')
          return (
            <polyline
              key={a.id}
              points={a.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill='none'
              stroke={a.color}
              strokeWidth={a.width}
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          );
        return null;
      })}
    </svg>
  );
}

/** Notes, text boxes and the pointer handling for the drawing / placing / erasing tools. */
export function OverLayer({page, scale, width, height, anns, tool, color, handlers}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [drag, setDrag] = useState<{from: Pt; to: Pt} | null>(null);

  const capturing = tool === 'note' || tool === 'text' || tool === 'draw' || tool === 'eraser';
  const point = (e: React.PointerEvent): Pt => {
    const r = root.current!.getBoundingClientRect();
    return {x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale};
  };

  const down = (e: React.PointerEvent) => {
    if (!capturing || e.button !== 0) return;
    const p = point(e);
    if (tool === 'eraser') {
      const target = [...anns].reverse().find(a => hit(a, p));
      if (target) handlers.remove(target.id);
      return;
    }
    if (tool === 'note') {
      const id = newId();
      const at = {x: Math.min(p.x, width - NOTE_SIZE), y: Math.min(p.y, height - NOTE_SIZE)};
      handlers.add({id, page, kind: 'note', color, at, text: ''});
      setOpenNote(id);
      setFocusId(id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'draw') setStroke([p]);
    else setDrag({from: p, to: p});
  };

  const move = (e: React.PointerEvent) => {
    if (stroke) {
      const p = point(e);
      const last = stroke[stroke.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.8) setStroke([...stroke, p]);
    } else if (drag) setDrag({...drag, to: point(e)});
  };

  const up = () => {
    if (stroke) {
      const points =
        stroke.length === 1 ? [stroke[0], {x: stroke[0].x + 0.1, y: stroke[0].y}] : stroke;
      handlers.add({id: newId(), page, kind: 'ink', color, width: INK_WIDTH, points});
      setStroke(null);
    } else if (drag) {
      const x = Math.min(drag.from.x, drag.to.x);
      const y = Math.min(drag.from.y, drag.to.y);
      const big = Math.abs(drag.to.x - drag.from.x) > 20 && Math.abs(drag.to.y - drag.from.y) > 14;
      const box: Box = big
        ? {x, y, w: Math.abs(drag.to.x - drag.from.x), h: Math.abs(drag.to.y - drag.from.y)}
        : {x: drag.from.x, y: drag.from.y, w: 160, h: 44};
      box.x = Math.max(0, Math.min(box.x, width - box.w));
      box.y = Math.max(0, Math.min(box.y, height - box.h));
      const id = newId();
      handlers.add({id, page, kind: 'text', color, box, text: '', size: TEXT_SIZE});
      setFocusId(id);
      setDrag(null);
    }
  };

  const childEvents = capturing ? 'none' : 'auto';

  return (
    <div
      ref={root}
      className={'ann-over tool-' + tool}
      style={{pointerEvents: capturing ? 'auto' : 'none'}}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      {anns.map(a => {
        if (a.kind === 'note') {
          const open = openNote === a.id;
          return (
            <div
              key={a.id}
              style={{position: 'absolute', left: a.at.x * scale, top: a.at.y * scale}}
            >
              <button
                className='note-icon'
                title={a.text || 'Empty note'}
                style={{
                  width: NOTE_SIZE * scale,
                  height: NOTE_SIZE * scale,
                  background: a.color,
                  pointerEvents: childEvents,
                }}
                onClick={() => {
                  if (open && !a.text.trim()) handlers.discard(a.id);
                  setOpenNote(open ? null : a.id);
                }}
              >
                ✎
              </button>
              {open && (
                <textarea
                  className='note-pop'
                  style={{pointerEvents: childEvents}}
                  value={a.text}
                  placeholder='Write a note…'
                  ref={el => {
                    if (el && focusId === a.id) {
                      setTimeout(() => el.focus(), 0);
                      setFocusId(null);
                    }
                  }}
                  onChange={e => {
                    if (!a.text && e.target.value) handlers.committed(a.id);
                    handlers.patch(a.id, {text: e.target.value});
                  }}
                />
              )}
            </div>
          );
        }
        if (a.kind === 'text') {
          return (
            <textarea
              key={a.id}
              className='textbox'
              spellCheck={false}
              style={{
                left: a.box.x * scale,
                top: a.box.y * scale,
                width: a.box.w * scale,
                height: a.box.h * scale,
                fontSize: a.size * scale,
                color: a.color,
                pointerEvents: childEvents,
              }}
              value={a.text}
              ref={el => {
                if (el && focusId === a.id) {
                  setTimeout(() => el.focus(), 0);
                  setFocusId(null);
                }
              }}
              onChange={e => {
                if (!a.text && e.target.value) handlers.committed(a.id);
                handlers.patch(a.id, {text: e.target.value});
              }}
              onBlur={() => !a.text.trim() && handlers.discard(a.id)}
            />
          );
        }
        return null;
      })}
      {(stroke || drag) && (
        <svg className='ann-preview' viewBox={`0 0 ${width} ${height}`}>
          {stroke && (
            <polyline
              points={stroke.map(p => `${p.x},${p.y}`).join(' ')}
              fill='none'
              stroke={color}
              strokeWidth={INK_WIDTH}
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          )}
          {drag && (
            <rect
              x={Math.min(drag.from.x, drag.to.x)}
              y={Math.min(drag.from.y, drag.to.y)}
              width={Math.abs(drag.to.x - drag.from.x)}
              height={Math.abs(drag.to.y - drag.from.y)}
              fill='none'
              stroke={color}
              strokeDasharray='4 3'
            />
          )}
        </svg>
      )}
    </div>
  );
}
