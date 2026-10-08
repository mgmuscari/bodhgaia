// A PNG encoder (PURE — pure-ui allowlist): pixels → PNG bytes / data URL without a canvas. Safari's fingerprinting
// protection perturbs or blanks canvas readback (toDataURL), which left the UI's 9-slice frames empty and every bar
// dark (Maddy 2026-10-08). The frames are tiny, so the deflate stream is stored (uncompressed): RGBA, 8-bit,
// filter 0 on every row, one IDAT.

import type { Pixels } from './pixelArt';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib wrapper around stored deflate blocks (≤ 65535 bytes each), with the Adler-32 trailer. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  let a = 1;
  let s = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    s = (s + a) % 65521;
  }
  out[o++] = s >>> 8;
  out[o++] = s & 0xff;
  out[o++] = a >>> 8;
  out[o++] = a & 0xff;
  return out;
}

export function encodePng(p: Pixels): Uint8Array {
  const row = p.w * 4;
  const raw = new Uint8Array((row + 1) * p.h);
  for (let y = 0; y < p.h; y++) raw.set(p.data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1); // filter byte 0
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, p.w);
  hv.setUint32(4, p.h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks: [string, Uint8Array][] = [['IHDR', ihdr], ['IDAT', zlibStored(raw)], ['IEND', new Uint8Array(0)]];
  const out = new Uint8Array(8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0));
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(out.buffer);
  let o = 8;
  for (const [type, data] of chunks) {
    view.setUint32(o, data.length);
    for (let k = 0; k < 4; k++) out[o + 4 + k] = type.charCodeAt(k);
    out.set(data, o + 8);
    view.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

export function pngDataUrl(p: Pixels): string {
  const png = encodePng(p);
  let bin = '';
  for (const b of png) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}
