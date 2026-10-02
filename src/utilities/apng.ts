/**
 * Minimal APNG decoder. `parseApng` (pure) splits an (A)PNG into standalone
 * per-frame PNGs plus placement/timing, so the browser decodes each frame;
 * `decodeApngFrames` composites them per the APNG dispose/blend rules into one
 * full canvas per frame. A plain PNG yields a single frame.
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export const APNG_DISPOSE_NONE = 0;
export const APNG_DISPOSE_BACKGROUND = 1;
export const APNG_DISPOSE_PREVIOUS = 2;
export const APNG_BLEND_SOURCE = 0;
export const APNG_BLEND_OVER = 1;

export interface ApngFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  delayMs: number;
  disposeOp: number;
  blendOp: number;
  /** A complete standalone PNG containing just this frame's pixels. */
  png: Uint8Array<ArrayBuffer>;
}

export interface ApngInfo {
  width: number;
  height: number;
  /** 0 = loop forever. */
  numPlays: number;
  frames: ApngFrame[];
}

interface Chunk {
  type: string;
  data: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function readChunks(bytes: Uint8Array<ArrayBuffer>): Chunk[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let pos = PNG_SIGNATURE.length;
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const start = pos + 8;
    if (start + length + 4 > bytes.length) throw new Error(`Truncated PNG chunk ${type}`);
    chunks.push({ type, data: bytes.subarray(start, start + length) });
    pos = start + length + 4; // skip CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Chunks that describe the image data layout and must be copied into every frame PNG. */
const SHARED_CHUNKS = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT']);

/** Splits an APNG into standalone per-frame PNGs with their placement/timing. */
export function parseApng(input: ArrayBuffer | Uint8Array<ArrayBuffer>): ApngInfo {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const chunks = readChunks(bytes);

  const ihdr = chunks.find(c => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = ihdrView.getUint32(0);
  const height = ihdrView.getUint32(4);

  const shared = chunks.filter(c => SHARED_CHUNKS.has(c.type));
  const actl = chunks.find(c => c.type === 'acTL');

  const makePng = (frameWidth: number, frameHeight: number, idat: Uint8Array[]): Uint8Array<ArrayBuffer> => {
    const header = new Uint8Array(ihdr.data);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, frameWidth);
    hv.setUint32(4, frameHeight);
    return concat([
      PNG_SIGNATURE,
      buildChunk('IHDR', header),
      ...shared.map(c => buildChunk(c.type, c.data)),
      buildChunk('IDAT', concat(idat)),
      buildChunk('IEND', new Uint8Array(0)),
    ]);
  };

  if (!actl) {
    // Static PNG: the whole file is one frame.
    return {
      width,
      height,
      numPlays: 0,
      frames: [{
        left: 0, top: 0, width, height, delayMs: 0,
        disposeOp: APNG_DISPOSE_NONE, blendOp: APNG_BLEND_SOURCE,
        png: makePng(width, height, chunks.filter(c => c.type === 'IDAT').map(c => c.data)),
      }],
    };
  }

  const numPlays = new DataView(actl.data.buffer, actl.data.byteOffset, actl.data.byteLength).getUint32(4);
  const frames: ApngFrame[] = [];
  let current: Omit<ApngFrame, 'png'> | null = null;
  let data: Uint8Array[] = [];

  const flush = () => {
    if (current && data.length > 0) frames.push({ ...current, png: makePng(current.width, current.height, data) });
    current = null;
    data = [];
  };

  for (const chunk of chunks) {
    if (chunk.type === 'fcTL') {
      flush();
      const v = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      const delayNum = v.getUint16(20);
      const delayDen = v.getUint16(22) || 100; // spec: 0 denominator means 1/100 s
      current = {
        width: v.getUint32(4),
        height: v.getUint32(8),
        left: v.getUint32(12),
        top: v.getUint32(16),
        delayMs: (delayNum / delayDen) * 1000,
        disposeOp: v.getUint8(24),
        blendOp: v.getUint8(25),
      };
    } else if (chunk.type === 'IDAT' && current) {
      // IDAT without a preceding fcTL is a hidden default image; skip it.
      data.push(chunk.data);
    } else if (chunk.type === 'fdAT' && current) {
      data.push(chunk.data.subarray(4)); // drop the sequence number
    }
  }
  flush();

  if (frames.length === 0) throw new Error('APNG contains no frames');
  return { width, height, numPlays, frames };
}

/** Fetches an (A)PNG and returns one fully composited canvas per frame. */
export async function decodeApngFrames(url: string): Promise<HTMLCanvasElement[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const apng = parseApng(await response.arrayBuffer());

  const bitmaps = await Promise.all(
    apng.frames.map(f => createImageBitmap(new Blob([f.png], { type: 'image/png' })))
  );

  const work = document.createElement('canvas');
  work.width = apng.width;
  work.height = apng.height;
  const ctx = work.getContext('2d')!;

  const output: HTMLCanvasElement[] = [];
  let pendingDispose: (() => void) | null = null;

  apng.frames.forEach((frame, i) => {
    pendingDispose?.();

    // "Previous" disposal on the first frame is treated as "background" by the spec.
    const disposeOp = i === 0 && frame.disposeOp === APNG_DISPOSE_PREVIOUS
      ? APNG_DISPOSE_BACKGROUND
      : frame.disposeOp;
    const saved = disposeOp === APNG_DISPOSE_PREVIOUS
      ? ctx.getImageData(frame.left, frame.top, frame.width, frame.height)
      : null;

    if (frame.blendOp === APNG_BLEND_SOURCE) ctx.clearRect(frame.left, frame.top, frame.width, frame.height);
    ctx.drawImage(bitmaps[i], frame.left, frame.top);
    bitmaps[i].close();

    const snapshot = document.createElement('canvas');
    snapshot.width = apng.width;
    snapshot.height = apng.height;
    snapshot.getContext('2d')!.drawImage(work, 0, 0);
    output.push(snapshot);

    pendingDispose =
      disposeOp === APNG_DISPOSE_BACKGROUND ? () => ctx.clearRect(frame.left, frame.top, frame.width, frame.height)
      : saved ? () => ctx.putImageData(saved, frame.left, frame.top)
      : null;
  });

  return output;
}
