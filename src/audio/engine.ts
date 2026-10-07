// The audio ENGINE: the contract's AudioEngine as a small SNES S-DSP over WebAudio. A deliberately thin shell —
// every decision (sample bytes, pitch → rate, envelope automation, voice stealing, echo filter) is made by the
// pure, tested modules in ./synth; this file only builds nodes and replays their plans.
//
// Graph:  voice (BufferSource → [noise filter] → envelope gain → panner) → bus (music | sfx | ambience)
//         bus → master;  music + ambience → echo send → [delay ⇄ FIR · feedback] → echo return → master
//         master → 16 kHz low-pass (the 32 kHz DAC's ceiling) → a limiter → a soft clip → destination

import type { AudioEngine, Bus, InstrumentId, NoteSpec, Voice } from './contract';
import { ECHO_FIR, SAMPLE_RATE, echoDelaySeconds, resampleFir, softClipCurve } from './synth/dsp';
import { releaseEnd, releaseSchedule, type EnvEvent } from './synth/envelope';
import { bakeInstrument, type InstrumentSample } from './synth/instruments';
import { levelAt, planVoice } from './synth/plan';
import { MAX_VOICES, VoicePool } from './synth/voices';

/** The S-DSP echo registers: EDL (× 16 ms), feedback, and how much of the music/ambience is sent. */
export const ECHO = { edl: 8, feedback: 0.42, send: 0.32, wet: 0.55 } as const;

export interface SynthEngine extends AudioEngine {
  readonly context: BaseAudioContext;
  dispose(): void;
}

export interface SynthOptions {
  maxVoices?: number;
  /** An OfflineAudioContext renders without a gesture — treat it as unlocked. */
  offline?: boolean;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function apply(param: AudioParam, events: EnvEvent[]): void {
  for (const e of events) {
    if (e.kind === 'set') param.setValueAtTime(e.v, e.t);
    else if (e.kind === 'linear') param.linearRampToValueAtTime(e.v, e.t);
    else param.setTargetAtTime(e.v, e.t, e.tau);
  }
}

/** Drop automation from `t` on, holding the current value where the browser supports it. */
function cut(param: AudioParam, t: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}

export function createSynthEngine(ctx: BaseAudioContext, opts: SynthOptions = {}): SynthEngine {
  const gain = (v: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  // — master chain —
  const master = gain(0.7);
  const dac = ctx.createBiquadFilter();
  dac.type = 'lowpass';
  dac.frequency.value = Math.min(SAMPLE_RATE / 2, ctx.sampleRate / 2 - 100);
  dac.Q.value = 0.5;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = '2x';
  master.connect(dac).connect(limiter).connect(clip).connect(ctx.destination);

  const buses: Record<Bus, GainNode> = { music: gain(0.5), sfx: gain(0.7), ambience: gain(0.4) };
  for (const b of Object.values(buses)) b.connect(master);
  let masterVolume = 0.7;
  let muted = false;

  // — echo —
  const echoIn = gain(ECHO.send);
  buses.music.connect(echoIn);
  buses.ambience.connect(echoIn);
  const delay = ctx.createDelay(0.25);
  delay.delayTime.value = echoDelaySeconds(ECHO.edl);
  const fir = ctx.createConvolver();
  fir.normalize = false;
  const ir = resampleFir(ECHO_FIR, ctx.sampleRate);
  const irBuf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
  irBuf.getChannelData(0).set(ir);
  fir.buffer = irBuf;
  const feedback = gain(ECHO.feedback);
  const wet = gain(ECHO.wet);
  echoIn.connect(delay).connect(fir);
  fir.connect(feedback).connect(delay);
  fir.connect(wet).connect(master);

  // — samples (baked lazily, once per instrument) —
  const samples = new Map<InstrumentId, { s: InstrumentSample; buf: AudioBuffer }>();
  const sample = (id: InstrumentId) => {
    let v = samples.get(id);
    if (!v) {
      const s = bakeInstrument(id);
      const buf = ctx.createBuffer(1, s.data.length, SAMPLE_RATE);
      buf.getChannelData(0).set(s.data);
      v = { s, buf };
      samples.set(id, v);
    }
    return v;
  };

  const pool = new VoicePool(opts.maxVoices ?? MAX_VOICES);
  const live = new Map<number, { kill(t: number): void }>();
  const isReady = (): boolean => (opts.offline ? true : ctx.state === 'running');

  const play = (note: NoteSpec): Voice | null => {
    if (!isReady() || muted || !buses[note.bus]) return null;
    const { s, buf } = sample(note.instrument);
    const plan = planVoice(s, note, ctx.currentTime);
    if (plan.peak <= 0) return null;
    const adm = pool.admit(plan.velocity, plan.start, plan.end);
    if (!adm) return null;
    if (adm.steal !== null) live.get(adm.steal)?.kill(plan.start);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (s.loop) {
      src.loop = true;
      src.loopStart = s.loopStart / SAMPLE_RATE;
      src.loopEnd = s.loopEnd / SAMPLE_RATE;
    }
    src.playbackRate.value = plan.rate;
    const nodes: AudioNode[] = [src];
    if (plan.filterHz !== null && s.noise) {
      const f = ctx.createBiquadFilter();
      f.type = s.noise.type;
      f.frequency.value = plan.filterHz;
      f.Q.value = s.noise.q;
      nodes.push(f);
    }
    const env = gain(0);
    apply(env.gain, plan.events);
    const pan = ctx.createStereoPanner();
    pan.pan.value = plan.pan;
    nodes.push(env, pan);
    for (let i = 1; i < nodes.length; i++) nodes[i - 1]!.connect(nodes[i]!);
    pan.connect(buses[note.bus]);

    src.start(plan.start);
    if (Number.isFinite(plan.end)) src.stop(plan.end + 0.02);
    const id = adm.id;
    let off = plan.stopAt;
    src.onended = () => {
      for (const n of nodes) n.disconnect();
      pool.remove(id);
      live.delete(id);
    };
    live.set(id, {
      kill: (t) => {
        live.delete(id); // a stolen voice ignores a later stop() (it must not be re-gated back to life)
        cut(env.gain, t);
        env.gain.setValueAtTime(levelAt(plan, t, off), t);
        env.gain.linearRampToValueAtTime(0, t + 0.005);
        src.stop(t + 0.01);
      },
    });
    return {
      stop: (at) => {
        if (!live.has(id)) return;
        const t = Math.max(plan.start, Number.isFinite(at) ? at! : ctx.currentTime);
        if (off !== undefined && off <= t) return; // already gated off
        cut(env.gain, t);
        apply(env.gain, releaseSchedule(plan.envelope, plan.start, plan.peak, t));
        off = t;
        const end = Math.min(plan.end, releaseEnd(plan.envelope, t));
        pool.release(id, end);
        src.stop(end + 0.02);
      },
    };
  };

  const setMasterGain = (): void => {
    master.gain.setTargetAtTime(muted ? 0 : masterVolume, ctx.currentTime, 0.02);
  };

  return {
    context: ctx,
    get ready() {
      return isReady();
    },
    unlock: () => {
      const c = ctx as AudioContext;
      if (!opts.offline && c.state === 'suspended' && typeof c.resume === 'function') void c.resume().catch(() => {});
    },
    now: () => ctx.currentTime,
    play,
    setVolume: (bus, volume) => {
      const v = clamp01(volume);
      if (bus === 'master') {
        masterVolume = v;
        setMasterGain();
      } else if (buses[bus]) {
        buses[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      }
    },
    setMuted: (m) => {
      muted = m;
      setMasterGain();
    },
    dispose: () => {
      for (const v of live.values()) v.kill(ctx.currentTime);
      live.clear();
      master.disconnect();
    },
  };
}
