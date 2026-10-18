import {PDFDict, PDFDocument, PDFHexString, PDFRef, PDFString, StandardFonts} from 'pdf-lib';
import type {PDFFont} from 'pdf-lib';
import type {PageViewport} from 'pdfjs-dist';

/** Rect in scale-1 viewport pixels (top-left origin), i.e. the page as displayed. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

interface Base {
  id: string;
  page: number;
  color: string;
}
export interface MarkupAnn extends Base {
  kind: 'highlight' | 'underline' | 'strike';
  quads: Box[];
}
export interface InkAnn extends Base {
  kind: 'ink';
  width: number;
  points: Pt[];
}
export interface NoteAnn extends Base {
  kind: 'note';
  at: Pt;
  text: string;
}
export interface TextAnn extends Base {
  kind: 'text';
  box: Box;
  text: string;
  size: number;
}
export type Ann = MarkupAnn | InkAnn | NoteAnn | TextAnn;
export type Tool =
  'select' | 'highlight' | 'underline' | 'strike' | 'note' | 'text' | 'draw' | 'eraser';

export const NOTE_SIZE = 22;
export const TEXT_SIZE = 14;
export const INK_WIDTH = 2;

export const COLORS = ['#ffd400', '#5fd35f', '#4da3ff', '#ff6fb1', '#ff4d4d', '#1c1c1c'];

let counter = 0;
export const newId = () => `a${Date.now().toString(36)}${counter++}`;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Replace characters the standard Helvetica (WinAnsi) font cannot encode. */
function encodable(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return Array.from(s)
    .map(ch => (ok.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const t = line + word;
      if (line && font.widthOfTextAtSize(t.trimEnd(), size) > maxW) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = t;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const escapePdf = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Writes the annotations into a copy of the PDF as standard annotation objects, each with its own
 * appearance stream so every viewer shows them the same way.
 */
export async function bakeAnnotations(
  bytes: Uint8Array,
  anns: Ann[],
  viewports: PageViewport[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, {updateMetadata: false});
  const ctx = pdf.context;
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const now = `D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

  for (const a of anns) {
    const page = pages[a.page - 1];
    const vp = viewports[a.page - 1];
    if (!page || !vp) continue;
    const toPdf = (p: Pt): [number, number] => vp.convertToPdfPoint(p.x, p.y) as [number, number];
    const bbox = (pts: [number, number][], pad = 0): number[] => [
      Math.min(...pts.map(p => p[0])) - pad,
      Math.min(...pts.map(p => p[1])) - pad,
      Math.max(...pts.map(p => p[0])) + pad,
      Math.max(...pts.map(p => p[1])) + pad,
    ];
    const [r, g, b] = rgb(a.color);
    const common = {
      Type: 'Annot',
      F: 4,
      C: [r, g, b],
      M: PDFString.of(now),
      T: PDFHexString.fromText('Reader'),
    };
    let annot: Record<string, unknown>;
    let apDict: Record<string, unknown>;
    let apContent: string;

    if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike') {
      const quadPts: [number, number][][] = a.quads.map(q => [
        toPdf({x: q.x, y: q.y}),
        toPdf({x: q.x + q.w, y: q.y}),
        toPdf({x: q.x, y: q.y + q.h}),
        toPdf({x: q.x + q.w, y: q.y + q.h}),
      ]);
      const all = quadPts.flat();
      const rect = bbox(all);
      const [x0, y0, x1, y1] = rect;
      let c =
        a.kind === 'highlight'
          ? `/GS gs ${n(r)} ${n(g)} ${n(b)} rg\n`
          : `${n(r)} ${n(g)} ${n(b)} RG 1 w\n`;
      for (const [tl, tr, bl, br] of quadPts) {
        if (a.kind === 'highlight') {
          c += `${n(tl[0])} ${n(tl[1])} m ${n(tr[0])} ${n(tr[1])} l ${n(br[0])} ${n(br[1])} l ${n(bl[0])} ${n(bl[1])} l h f\n`;
        } else if (a.kind === 'underline') {
          c += `${n(bl[0])} ${n(bl[1])} m ${n(br[0])} ${n(br[1])} l S\n`;
        } else {
          const mid = (p: [number, number], q: [number, number]) => [
            (p[0] + q[0]) / 2,
            (p[1] + q[1]) / 2,
          ];
          const m1 = mid(tl, bl);
          const m2 = mid(tr, br);
          c += `${n(m1[0])} ${n(m1[1])} m ${n(m2[0])} ${n(m2[1])} l S\n`;
        }
      }
      const subtype =
        a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut';
      annot = {
        ...common,
        Subtype: subtype,
        Rect: rect,
        QuadPoints: all.flatMap(p => p),
      };
      apDict = {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [x0, y0, x1, y1],
        Resources: {ExtGState: {GS: {Type: 'ExtGState', BM: 'Multiply'}}},
      };
      apContent = c;
    } else if (a.kind === 'ink') {
      const pts = a.points.map(toPdf);
      if (pts.length < 2) continue;
      const rect = bbox(pts, a.width + 1);
      let c = `${n(r)} ${n(g)} ${n(b)} RG ${n(a.width)} w 1 J 1 j\n${n(pts[0][0])} ${n(pts[0][1])} m\n`;
      for (const p of pts.slice(1)) c += `${n(p[0])} ${n(p[1])} l\n`;
      c += 'S\n';
      annot = {
        ...common,
        Subtype: 'Ink',
        Rect: rect,
        InkList: [pts.flatMap(p => p)],
        BS: {W: a.width},
      };
      apDict = {Type: 'XObject', Subtype: 'Form', BBox: rect};
      apContent = c;
    } else if (a.kind === 'note') {
      const tl = toPdf(a.at);
      const br = toPdf({x: a.at.x + NOTE_SIZE, y: a.at.y + NOTE_SIZE});
      const rect = bbox([tl, br]);
      const [x0, y0, x1, y1] = rect;
      const w = x1 - x0;
      const h = y1 - y0;
      // Speech-bubble icon: filled rounded body plus a tail, in the note colour.
      const c =
        `${n(r)} ${n(g)} ${n(b)} rg 0.2 0.2 0.2 RG 0.8 w\n` +
        `${n(x0 + w * 0.08)} ${n(y0 + h * 0.3)} ${n(w * 0.84)} ${n(h * 0.62)} re B\n` +
        `${n(x0 + w * 0.2)} ${n(y0 + h * 0.3)} m ${n(x0 + w * 0.2)} ${n(y0 + h * 0.06)} l ${n(x0 + w * 0.46)} ${n(y0 + h * 0.3)} l h B\n`;
      annot = {
        ...common,
        Subtype: 'Text',
        Rect: rect,
        Name: 'Comment',
        Open: false,
        Contents: PDFHexString.fromText(a.text),
      };
      apDict = {Type: 'XObject', Subtype: 'Form', BBox: rect};
      apContent = c;
    } else if (a.kind === 'text') {
      const tl = toPdf({x: a.box.x, y: a.box.y});
      const br = toPdf({x: a.box.x + a.box.w, y: a.box.y + a.box.h});
      const rect = bbox([tl, br]);
      const text = encodable(helv, a.text);
      const lines = wrap(helv, text, a.size, Math.max(10, a.box.w - 4));
      // Text is laid out upright on screen; counter-rotate the form so it stays upright on rotated pages.
      const th = (-vp.rotation * Math.PI) / 180;
      let c = `${n(r)} ${n(g)} ${n(b)} rg BT /Helv ${n(a.size)} Tf ${n(a.size * 1.2)} TL 2 ${n(a.box.h - a.size)} Td\n`;
      for (const l of lines) c += `(${escapePdf(l)}) Tj T*\n`;
      c += 'ET\n';
      annot = {
        ...common,
        Subtype: 'FreeText',
        Rect: rect,
        Contents: PDFHexString.fromText(a.text),
        DA: PDFString.of(`/Helv ${n(a.size)} Tf ${n(r)} ${n(g)} ${n(b)} rg`),
        Q: 0,
      };
      apDict = {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, a.box.w, a.box.h],
        Matrix: [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th), 0, 0],
        Resources: {Font: {Helv: helv.ref}},
      };
      apContent = c;
    } else {
      continue;
    }

    const apRef = ctx.register(ctx.stream(apContent, apDict as never));
    const dict = ctx.obj({...annot, AP: {N: apRef}}) as PDFDict;
    const ref: PDFRef = ctx.register(dict);
    page.node.addAnnot(ref);
  }

  return pdf.save({useObjectStreams: false});
}
