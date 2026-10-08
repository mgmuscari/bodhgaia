import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng, pngDataUrl } from '../../src/ui/pngEncode';
import { framePixels, FRAME_KINDS } from '../../src/ui/uiKit';

/** Decode an RGBA, filter-0, non-interlaced PNG (what encodePng writes) with node's zlib. */
function decode(png: Uint8Array): { w: number; h: number; data: Uint8Array } {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Uint8Array[] = [];
  for (;;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.slice(o + 4, o + 8));
    const body = png.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = view.getUint32(o + 8);
      h = view.getUint32(o + 12);
      expect([...body.slice(8)]).toEqual([8, 6, 0, 0, 0]); // 8-bit RGBA, deflate, no filter, no interlace
    }
    if (type === 'IDAT') idat.push(body);
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat)); // checks the zlib header and Adler-32
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(0);
    data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, data };
}

describe('PNG encoding without a canvas (Safari scrambles canvas readback)', () => {
  it('round-trips every UI frame exactly', () => {
    for (const kind of FRAME_KINDS) {
      const p = framePixels(kind);
      const d = decode(encodePng(p));
      expect([d.w, d.h]).toEqual([p.w, p.h]);
      expect([...d.data]).toEqual([...p.data]);
    }
  });

  it('writes a valid CRC on every chunk', () => {
    const png = encodePng(framePixels('button'));
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let chunks = 0;
    for (let o = 8; o < png.length; chunks++) {
      const len = view.getUint32(o);
      expect(view.getUint32(o + 8 + len)).toBe(crcRef(png.slice(o + 4, o + 8 + len)));
      o += 12 + len;
    }
    expect(chunks).toBe(3); // IHDR, IDAT, IEND
  });

  it('serves as a data URL', () => {
    expect(pngDataUrl(framePixels('panel')).startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
  });
});

function crcRef(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
