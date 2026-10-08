// The arranger (PURE — MIDI bytes in, MIDI bytes out; Maddy 2026-10-08: "rearrange the classical music to the style
// of these tracks"). A solo-piano score becomes an ensemble in the shape of her arrangements for the game: a lead
// (the composer's melody, note for note), a counter-line in the second half, a comp, a pad, colour, a bass, bells at
// the phrase starts and a soft drum groove — keeping the score's meter and tempo map and voicing only the harmony
// the score itself sounds. Run by scripts/arrange.ts at authoring time; the game ships the result.

export interface ScoreNote {
  tick: number;
  dur: number;
  pitch: number;
  vel: number;
  track: number;
}

export interface Score {
  division: number;
  tempos: { tick: number; usPerQuarter: number }[];
  meters: { tick: number; num: number; den: number }[];
  notes: ScoreNote[];
  /** The upper voice of the upper hand: one note at a time. */
  melody: ScoreNote[];
  /** The tick the last note ends. */
  end: number;
}

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────

class Reader {
  i = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b; // (no parameter properties: scripts/arrange.ts runs this under node's type stripping)
  }
  u8(): number {
    return this.b[this.i++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u16() << 16) >>> 0) + this.u16();
  }
  vlq(): number {
    let v = 0;
    for (;;) {
      const c = this.u8();
      v = v * 128 + (c & 0x7f);
      if (c < 0x80) return v;
    }
  }
}

/** Read a score: its notes (all hands), tempo and meter maps, and its melody. */
export function readScore(bytes: Uint8Array): Score {
  const r = new Reader(bytes);
  r.i = 8;
  r.u16(); // format
  const ntracks = r.u16();
  const division = r.u16();
  const notes: ScoreNote[] = [];
  const tempos: Score['tempos'] = [];
  const meters: Score['meters'] = [];
  r.i = 14;
  for (let t = 0; t < ntracks; t++) {
    r.i += 4; // MTrk
    const len = r.u32();
    const end = r.i + len;
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; vel: number }>();
    while (r.i < end) {
      tick += r.vlq();
      let s = r.b[r.i]!;
      if (s === 0xff) {
        r.i++;
        const type = r.u8();
        const l = r.vlq();
        if (type === 0x51) tempos.push({ tick, usPerQuarter: (r.b[r.i]! << 16) | (r.b[r.i + 1]! << 8) | r.b[r.i + 2]! });
        if (type === 0x58) meters.push({ tick, num: r.b[r.i]!, den: 2 ** r.b[r.i + 1]! });
        r.i += l;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        r.i++;
        r.i += r.vlq();
        continue;
      }
      if (s & 0x80) {
        status = s;
        r.i++;
      } else s = status;
      const hi = status & 0xf0;
      if (hi === 0xc0 || hi === 0xd0) {
        r.i++;
        continue;
      }
      const a = r.u8();
      const b = r.u8();
      const key = ((status & 0x0f) << 8) | a;
      if (hi === 0x90 && b > 0) open.set(key, { tick, vel: b });
      else if (hi === 0x80 || hi === 0x90) {
        const o = open.get(key);
        if (o) {
          open.delete(key);
          if (tick > o.tick) notes.push({ tick: o.tick, dur: tick - o.tick, pitch: a, vel: o.vel, track: t });
        }
      }
    }
    r.i = end;
  }
  if (tempos.length === 0) tempos.push({ tick: 0, usPerQuarter: 500_000 });
  if (meters.length === 0) meters.push({ tick: 0, num: 4, den: 4 });
  tempos.sort((a, b) => a.tick - b.tick);
  meters.sort((a, b) => a.tick - b.tick);
  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  return { division, tempos, meters, notes, melody: melodyOf(notes), end: notes.reduce((e, n) => Math.max(e, n.tick + n.dur), 0) };
}

/** The melody: the upper voice of the upper hand (the track sounding highest on average), one note at a time —
 *  an onset under a still-sounding higher melody note is an inner voice and is left to the harmony. */
function melodyOf(notes: ScoreNote[]): ScoreNote[] {
  const byTrack = new Map<number, { sum: number; n: number }>();
  for (const n of notes) {
    const s = byTrack.get(n.track) ?? { sum: 0, n: 0 };
    s.sum += n.pitch;
    s.n++;
    byTrack.set(n.track, s);
  }
  let upper = -1;
  let best = -1;
  for (const [t, s] of byTrack) if (s.sum / s.n > best) [best, upper] = [s.sum / s.n, t];
  const single = byTrack.size === 1;
  const tops = new Map<number, ScoreNote>();
  for (const n of notes) {
    if (!single && n.track !== upper) continue;
    if (n.pitch < 55) continue;
    const t = tops.get(n.tick);
    if (!t || n.pitch > t.pitch) tops.set(n.tick, n);
  }
  const out: ScoreNote[] = [];
  for (const n of [...tops.values()].sort((a, b) => a.tick - b.tick)) {
    const prev = out[out.length - 1];
    if (prev && n.tick < prev.tick + prev.dur && n.pitch < prev.pitch) continue; // an inner voice under it
    out.push({ ...n });
  }
  for (let i = 0; i + 1 < out.length; i++) out[i]!.dur = Math.max(1, Math.min(out[i]!.dur, out[i + 1]!.tick - out[i]!.tick));
  return out;
}

// ── writing ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface Part {
  name: string;
  channel: number;
  program: number;
  notes: { tick: number; dur: number; pitch: number; vel: number }[];
}

export interface Song {
  division: number;
  tempos: Score['tempos'];
  meters: Score['meters'];
  markers: { tick: number; text: string }[];
  title?: string;
  tracks: Part[];
}

const latin1 = (s: string): number[] => [...s].map((c) => Math.min(255, c.charCodeAt(0)));
const vlqBytes = (v: number): number[] => {
  const out = [v & 0x7f];
  for (v = Math.floor(v / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80);
  return out;
};

function chunk(events: { tick: number; order: number; bytes: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlqBytes(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const n = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body];
}

const meta = (type: number, data: number[]): number[] => [0xff, type, ...vlqBytes(data.length), ...data];

/** A format-1 Standard MIDI File: a conductor track (title, meters, tempos, markers), then one track per part. */
export function writeMidi(song: Song): Uint8Array {
  const conductor = [
    ...(song.title ? [{ tick: 0, order: 0, bytes: meta(0x03, latin1(song.title)) }, { tick: 0, order: 0, bytes: meta(0x01, latin1(`${song.title} - bodhgaia`)) }] : []),
    ...song.meters.map((m) => ({ tick: m.tick, order: 1, bytes: meta(0x58, [m.num, Math.round(Math.log2(m.den)), 24, 8]) })),
    ...song.tempos.map((t) => ({ tick: t.tick, order: 2, bytes: meta(0x51, [(t.usPerQuarter >>> 16) & 255, (t.usPerQuarter >>> 8) & 255, t.usPerQuarter & 255]) })),
    ...song.markers.map((m) => ({ tick: m.tick, order: 3, bytes: meta(0x06, latin1(m.text)) })),
  ];
  const tracks = song.tracks.map((p) => {
    const ev = [
      { tick: 0, order: 0, bytes: meta(0x03, latin1(p.name)) },
      { tick: 0, order: 1, bytes: [0xc0 | p.channel, p.program & 0x7f] },
    ];
    for (const n of p.notes) {
      ev.push({ tick: n.tick, order: 3, bytes: [0x90 | p.channel, n.pitch & 0x7f, Math.max(1, Math.min(127, Math.round(n.vel)))] });
      ev.push({ tick: n.tick + Math.max(1, n.dur), order: 2, bytes: [0x80 | p.channel, n.pitch & 0x7f, 0] }); // offs before ons
    }
    return chunk(ev);
  });
  const all = [chunk(conductor), ...tracks];
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, all.length, (song.division >>> 8) & 255, song.division & 255];
  return new Uint8Array([...head, ...all.flat()]);
}

// ── arranging ───────────────────────────────────────────────────────────────────────────────────────────────

export type StyleId = 'waltz' | 'swing' | 'bossa' | 'ballad';

interface Hit {
  /** In beats from the bar start. */
  at: number;
  dur: number;
  vel: number;
}
interface DrumHit {
  at: number;
  key: number;
  vel: number;
}

/** How each style fills a bar of `beats` beats (patterns past the bar's end are dropped). */
export const STYLES: Record<StyleId, {
  comp: (beats: number) => Hit[];
  bass: (beats: number) => { at: number; dur: number; degree: 'root' | 'fifth' | 'approach' }[];
  drums: (beats: number, bar: number) => DrumHit[];
}> = {
  // a brushed jazz waltz: bass on one, comp on two and three
  waltz: {
    comp: (b) => [{ at: 1, dur: 0.6, vel: 62 }, { at: 2, dur: 0.6, vel: 58 }].filter((h) => h.at < b),
    bass: (b) => [{ at: 0, dur: Math.max(1, b - 1.1), degree: 'root' }, { at: b - 1, dur: 0.9, degree: 'fifth' }],
    drums: (b) => [
      ...Array.from({ length: b }, (_, k) => ({ at: k, key: 51, vel: k === 0 ? 46 : 38 })),
      { at: 0, key: 36, vel: 40 },
      ...Array.from({ length: b - 1 }, (_, k) => ({ at: k + 1, key: 38, vel: 28 })),
    ],
  },
  // her swing comp (one, the and-of-two, four), a two-feel bass with an approach, ride and brushes
  swing: {
    comp: (b) => [{ at: 0, dur: 0.5, vel: 64 }, { at: 1.67, dur: 0.5, vel: 60 }, { at: 3, dur: 0.5, vel: 62 }].filter((h) => h.at < b),
    bass: (b) => (b >= 4 ? [{ at: 0, dur: 1.9, degree: 'root' }, { at: 2, dur: 1.6, degree: 'fifth' }, { at: 3.67, dur: 0.33, degree: 'approach' }] : [{ at: 0, dur: b * 0.95, degree: 'root' }]),
    drums: (b) => [
      ...[0, 1, 1.67, 2, 3, 3.67].filter((a) => a < b).map((a) => ({ at: a, key: 51, vel: Number.isInteger(a) ? 48 : 36 })),
      ...[1, 3].filter((a) => a < b).flatMap((a) => [{ at: a, key: 44, vel: 42 }, { at: a, key: 38, vel: 30 }]),
      { at: 0, key: 36, vel: 42 },
    ],
  },
  // her bossa: guitar on one, the and-of-two, the and-of-three; root-fifth bass; shaker, kick and clave rim
  bossa: {
    comp: (b) => [{ at: 0, dur: 0.45, vel: 72 }, { at: 1.5, dur: 0.45, vel: 68 }, { at: 2.5, dur: 0.45, vel: 68 }].filter((h) => h.at < b),
    bass: (b) => [
      { at: 0, dur: 1.4, degree: 'root' as const },
      { at: 1.5, dur: 0.45, degree: 'root' as const },
      { at: 2, dur: 1.4, degree: 'fifth' as const },
      { at: 3.5, dur: 0.45, degree: 'fifth' as const },
    ].filter((h) => h.at < b),
    drums: (b, bar) => [
      ...Array.from({ length: b * 4 }, (_, k) => ({ at: k / 4, key: 70, vel: k % 4 === 0 ? 42 : 30 })),
      ...[0, 1.5, 2, 3.5].filter((a) => a < b).map((a) => ({ at: a, key: 36, vel: 40 })),
      ...(bar % 2 === 0 ? [0, 1.5, 3] : [1, 2.5]).filter((a) => a < b).map((a) => ({ at: a, key: 37, vel: 38 })),
    ],
  },
  // a slow night ballad for compound or free time: a chord per beat, a ride per beat, a brush on the second
  ballad: {
    comp: (b) => Array.from({ length: b }, (_, k) => ({ at: k, dur: 0.9, vel: k === 0 ? 62 : 56 })),
    bass: (b) => [{ at: 0, dur: Math.max(0.9, Math.ceil(b / 2) - 0.1), degree: 'root' }, ...(b >= 2 ? [{ at: Math.ceil(b / 2), dur: Math.max(0.9, b - Math.ceil(b / 2) - 0.1), degree: 'fifth' as const }] : [])],
    drums: (b) => [
      ...Array.from({ length: b }, (_, k) => ({ at: k, key: 51, vel: k === 0 ? 40 : 32 })),
      ...(b >= 2 ? [{ at: 1, key: 38, vel: 26 }] : []),
      { at: 0, key: 36, vel: 36 },
    ],
  },
};

/** One arrangement: its style, title and General MIDI instruments. */
export interface Arrangement {
  style: StyleId;
  title: string;
  lead: number;
  counter: number;
  comp: number;
  pad: number;
  colour: number;
  bass: number;
  bells: number;
}

interface Bar {
  tick: number;
  len: number;
  /** Ticks per beat (a dotted quarter in compound time). */
  beat: number;
  beats: number;
}

function barsOf(score: Score): Bar[] {
  const out: Bar[] = [];
  const q = score.division;
  let tick = 0;
  let mi = 0;
  while (tick < score.end) {
    while (mi + 1 < score.meters.length && score.meters[mi + 1]!.tick <= tick) mi++;
    const m = score.meters[mi]!;
    const len = Math.round((m.num * q * 4) / m.den);
    const compound = m.den === 8 && m.num % 3 === 0 && m.num > 3;
    const beat = compound ? (q * 3) / 2 : (q * 4) / m.den;
    out.push({ tick, len, beat, beats: Math.max(1, Math.round(len / beat)) });
    tick += len;
  }
  return out;
}

/** Pitch classes sounding in [t0, t1), weighted by how long, strongest first; and the lowest pitch in the window. */
function harmony(score: Score, t0: number, t1: number): { pcs: number[]; bass: number | null } {
  const w = new Array<number>(12).fill(0);
  let bass: number | null = null;
  for (const n of score.notes) {
    if (n.tick >= t1) break;
    const a = Math.max(t0, n.tick);
    const b = Math.min(t1, n.tick + n.dur);
    if (b <= a) continue;
    w[n.pitch % 12]! += b - a;
    if (bass === null || n.pitch < bass) bass = n.pitch;
  }
  const pcs = w.map((v, pc) => ({ v, pc })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v || x.pc - y.pc).slice(0, 4).map((x) => x.pc);
  if (bass !== null && !pcs.includes(bass % 12)) pcs.push(bass % 12);
  return { pcs, bass };
}

/** Voice pitch classes upward from `lo`, keeping those at or under `hi`. */
function voice(pcs: number[], lo: number, hi: number): number[] {
  return pcs.map((pc) => lo + ((pc - (lo % 12) + 12) % 12)).filter((p) => p <= hi).sort((a, b) => a - b);
}

/** Into the bass register: C2..B2. */
const inBass = (pc: number): number => 36 + pc;

/** Arrange a solo-piano score as an ensemble. */
export function arrange(bytes: Uint8Array, plan: Arrangement): Uint8Array {
  const score = readScore(bytes);
  const style = STYLES[plan.style];
  const bars = barsOf(score);
  const parts: Record<'lead' | 'counter' | 'comp' | 'pad' | 'colour' | 'bass' | 'bells' | 'drums', Part['notes']> = {
    lead: [], counter: [], comp: [], pad: [], colour: [], bass: [], bells: [], drums: [],
  };
  // the lead: the composer's melody, note for note
  for (const n of score.melody) parts.lead.push({ tick: n.tick, dur: n.dur, pitch: n.pitch, vel: 90 + (n.vel - 64) / 6 });

  bars.forEach((bar, bi) => {
    const whole = harmony(score, bar.tick, bar.tick + bar.len);
    if (whole.pcs.length === 0) return; // a silent bar (a rest): the band rests too
    const root = whole.bass !== null ? whole.bass % 12 : whole.pcs[0]!;
    const next = bars[bi + 1] ? harmony(score, bars[bi + 1]!.tick, bars[bi + 1]!.tick + bars[bi + 1]!.len) : null;
    const nextRoot = next?.bass !== null && next?.bass !== undefined ? next.bass % 12 : root;
    const at = (beats: number): number => bar.tick + Math.round(beats * bar.beat);
    const dur = (beats: number): number => Math.max(1, Math.round(beats * bar.beat));
    // the pad: the bar's chord, held
    for (const p of voice(whole.pcs, 50, 67)) parts.pad.push({ tick: bar.tick, dur: bar.len - Math.round(score.division / 8), pitch: p, vel: 46 });
    // the comp: the beat's own chord on the style's hits
    for (const h of style.comp(bar.beats)) {
      const t = at(h.at);
      const beatChord = harmony(score, t, t + Math.round(bar.beat));
      const pcs = beatChord.pcs.length ? beatChord.pcs.filter((pc) => whole.pcs.includes(pc)) : whole.pcs;
      for (const p of voice(pcs.length ? pcs : whole.pcs, 55, 70)) parts.comp.push({ tick: t, dur: dur(h.dur), pitch: p, vel: h.vel });
    }
    // the bass: root and fifth (the fifth only where the score sounds it), an approach into the next bar's root
    const fifth = (root + 7) % 12;
    for (const h of style.bass(bar.beats)) {
      if (h.at >= bar.beats) continue;
      const pc = h.degree === 'root' ? root : h.degree === 'fifth' ? (whole.pcs.includes(fifth) ? fifth : root) : (nextRoot + 11) % 12;
      if (h.degree === 'approach' && !whole.pcs.includes(pc)) continue; // an approach only where it is a chord tone
      parts.bass.push({ tick: at(h.at), dur: dur(Math.min(h.dur, bar.beats - h.at)), pitch: inBass(pc), vel: 92 });
    }
    // the counter-line: a guide tone held through each bar of the second half (her "second chorus")
    if (bi >= bars.length / 2) {
      const guide = whole.pcs.find((pc) => pc !== root) ?? root;
      const [p] = voice([guide], 57, 69);
      if (p !== undefined) parts.counter.push({ tick: bar.tick, dur: Math.round(bar.len * 0.9), pitch: p, vel: 80 });
    }
    // colour: a high chord tone every fourth bar; bells on the phrase starts
    if (bi % 4 === 0) {
      const top = voice(whole.pcs, 76, 90);
      if (top.length) parts.colour.push({ tick: at(Math.min(1, bar.beats - 1)), dur: dur(0.4), pitch: top[top.length - 1]!, vel: 58 });
    }
    if (bi % 8 === 0) parts.bells.push({ tick: bar.tick, dur: dur(Math.min(2, bar.beats)), pitch: voice([root], 84, 96)[0] ?? 84, vel: 58 });
    // the groove
    for (const d of style.drums(bar.beats, bi)) if (d.at < bar.beats) parts.drums.push({ tick: at(d.at), dur: dur(0.2), pitch: d.key, vel: d.vel });
  });

  const lastBar = bars.find((b) => b.tick + b.len >= score.end) ?? bars[bars.length - 1]!;
  const song: Song = {
    division: score.division,
    tempos: score.tempos,
    meters: score.meters,
    title: plan.title,
    markers: [{ tick: 0, text: 'loopStart' }, { tick: lastBar.tick + lastBar.len, text: 'loopEnd' }],
    tracks: [
      { name: 'lead', channel: 0, program: plan.lead, notes: parts.lead },
      { name: 'counter-line (second half)', channel: 1, program: plan.counter, notes: parts.counter },
      { name: 'comp', channel: 2, program: plan.comp, notes: parts.comp },
      { name: 'pad', channel: 3, program: plan.pad, notes: parts.pad },
      { name: 'colour', channel: 4, program: plan.colour, notes: parts.colour },
      { name: 'bass', channel: 5, program: plan.bass, notes: parts.bass },
      { name: 'bells', channel: 6, program: plan.bells, notes: parts.bells },
      { name: 'drums', channel: 9, program: 0, notes: parts.drums },
    ],
  };
  return writeMidi(song);
}
