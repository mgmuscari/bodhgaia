// A Standard MIDI File parser (PURE — bytes in, a flat list of timed notes out). Formats 0 and 1 (format 2's
// independent sequences are read as if simultaneous). Running status, velocity-0 note-offs, sysex and meta events,
// a global tempo map (Set Tempo events in any track govern every track, per the SMF spec for format 1), and the
// program each channel held when a note began. Channel 10 (index 9) is General MIDI percussion.

export interface MidiNote {
  /** Onset, seconds from the start of the piece. */
  time: number;
  /** Seconds. */
  duration: number;
  /** MIDI note number. */
  pitch: number;
  /** 0..1 */
  velocity: number;
  /** 0..15 */
  channel: number;
  /** General MIDI program (0..127) in force on the channel at the onset. */
  program: number;
  /** True on channel 10 (GM percussion — `pitch` names a drum, not a pitch). */
  percussion: boolean;
}

export interface MidiPiece {
  /** Sorted by time, then pitch. */
  notes: MidiNote[];
  /** Seconds, to the end of the last note or event. */
  duration: number;
}

const PERCUSSION_CHANNEL = 9;
const DEFAULT_US_PER_QUARTER = 500_000; // 120 bpm

interface TickNote {
  tick: number;
  end: number;
  pitch: number;
  velocity: number;
  channel: number;
  program: number;
}

class Reader {
  pos = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly end = bytes.length,
  ) {}
  u8(): number {
    if (this.pos >= this.end) throw new Error('MIDI: unexpected end of data');
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vlq(): number {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    throw new Error('MIDI: malformed variable-length quantity');
  }
  id(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }
}

export function parseMidi(bytes: Uint8Array): MidiPiece {
  const r = new Reader(bytes);
  if (bytes.length < 14 || r.id() !== 'MThd') throw new Error('MIDI: not a Standard MIDI File (no MThd)');
  const hlen = r.u32();
  const hstart = r.pos;
  r.u16(); // format — 0, 1 and 2 are all read the same way here
  const ntracks = r.u16();
  const division = r.u16();
  r.pos = hstart + hlen;

  // SMPTE division (high bit set): frames/sec × ticks/frame → a fixed ticks-per-second, tempo ignored.
  const smpte = (division & 0x8000) !== 0;
  const ticksPerQuarter = smpte ? 0 : division;
  const smpteTicksPerSec = smpte ? (256 - (division >> 8)) * (division & 0xff) : 0;
  if (!smpte && ticksPerQuarter === 0) throw new Error('MIDI: zero ticks per quarter note');

  const tempos: { tick: number; us: number }[] = [];
  const raw: TickNote[] = [];
  let lastTick = 0;

  for (let t = 0; t < ntracks && r.pos + 8 <= bytes.length; t++) {
    const id = r.id();
    const len = r.u32();
    const start = r.pos;
    const end = Math.min(start + len, bytes.length);
    r.pos = end;
    if (id !== 'MTrk') continue; // unknown chunk: skip (tracks are counted only when real)
    const tr = new Reader(bytes, end);
    tr.pos = start;
    let tick = 0;
    let status = 0;
    const program = new Array<number>(16).fill(0);
    const open = new Map<number, TickNote[]>(); // channel*128+pitch → FIFO of sounding notes
    const close = (key: number, at: number) => {
      const q = open.get(key);
      const n = q?.shift();
      if (n) n.end = at;
    };
    while (tr.pos < end) {
      tick += tr.vlq();
      let b = tr.u8();
      if (b === 0xff) {
        const type = tr.u8();
        const mlen = tr.vlq();
        const mstart = tr.pos;
        if (type === 0x51 && mlen >= 3) tempos.push({ tick, us: (tr.u8() << 16) | (tr.u8() << 8) | tr.u8() });
        tr.pos = mstart + mlen;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        tr.pos += tr.vlq();
        continue;
      }
      let d1: number;
      if (b & 0x80) {
        status = b;
        d1 = tr.u8();
      } else {
        if (!status) throw new Error('MIDI: running status with no prior status byte');
        d1 = b;
        b = status;
      }
      const kind = b & 0xf0;
      const ch = b & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        if (kind === 0xc0) program[ch] = d1 & 0x7f;
        continue;
      }
      const d2 = tr.u8();
      if (kind === 0x90 && d2 > 0) {
        const n: TickNote = { tick, end: -1, pitch: d1, velocity: d2 / 127, channel: ch, program: program[ch]! };
        raw.push(n);
        const key = ch * 128 + d1;
        const q = open.get(key);
        if (q) q.push(n);
        else open.set(key, [n]);
      } else if (kind === 0x80 || kind === 0x90) {
        close(ch * 128 + d1, tick);
      }
      // 0xa0 aftertouch, 0xb0 controller, 0xe0 pitch bend: ignored
    }
    for (const q of open.values()) for (const n of q) n.end = tick;
    lastTick = Math.max(lastTick, tick);
  }

  // Tick → seconds through the tempo map.
  tempos.sort((a, b) => a.tick - b.tick);
  const segs: { tick: number; sec: number; secPerTick: number }[] = [];
  const spt = (us: number) => us / 1e6 / ticksPerQuarter;
  if (smpte) segs.push({ tick: 0, sec: 0, secPerTick: 1 / smpteTicksPerSec });
  else {
    segs.push({ tick: 0, sec: 0, secPerTick: spt(DEFAULT_US_PER_QUARTER) });
    for (const tp of tempos) {
      const prev = segs[segs.length - 1]!;
      const sec = prev.sec + (tp.tick - prev.tick) * prev.secPerTick;
      if (tp.tick === prev.tick) segs[segs.length - 1] = { tick: tp.tick, sec, secPerTick: spt(tp.us) };
      else segs.push({ tick: tp.tick, sec, secPerTick: spt(tp.us) });
    }
  }
  const toSec = (tick: number): number => {
    let s = segs[0]!;
    for (const seg of segs) {
      if (seg.tick > tick) break;
      s = seg;
    }
    return s.sec + (tick - s.tick) * s.secPerTick;
  };

  const notes: MidiNote[] = raw
    .filter((n) => n.end >= n.tick)
    .map((n) => {
      const time = toSec(n.tick);
      return {
        time,
        duration: toSec(n.end) - time,
        pitch: n.pitch,
        velocity: n.velocity,
        channel: n.channel,
        program: n.program,
        percussion: n.channel === PERCUSSION_CHANNEL,
      };
    })
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  let duration = toSec(lastTick);
  for (const n of notes) duration = Math.max(duration, n.time + n.duration);
  return { notes, duration };
}
