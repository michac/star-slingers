/**
 * sfx.ts — the game's sound (#3). Game code calls `sfx.play('<name>')` at the
 * moment something happens; every sound is synthesized in code with Web Audio
 * (the recipes in sfxRecipes.ts), so there are no audio files to load.
 *
 * Silent until the first tap: browsers keep audio locked until a gesture, so
 * main.ts calls `unlock()` from every pointerdown and pointerup, and only one
 * that lands inside a real gesture makes the AudioContext (a touch counts on
 * its release, a mouse on its press). Every later tap resumes it if anything
 * (iOS's 'interrupted', say) has stopped it. While the page is hidden it's
 * suspended, so sound pauses with the game loop. Before that, without Web Audio, or while muted, play()
 * only records the request. Every request, played or not, goes on `log`,
 * which is what the e2e suite reads (it never listens to real audio).
 *
 * Mix (dials: SFX in layout.ts): each play gets its own small gain bus, into
 * one master gain → a limiter → a lowpass → the speakers. A per-sound voice
 * cap and minimum gap drop a play that would pile up, and a small random
 * pitch shift keeps repeats from sounding robotic. The mute (the join
 * screen's speaker button) is remembered in localStorage. It mutes sound only;
 * vibration is haptics.ts's (D4).
 */
import { SFX } from './layout';
import { RECIPES, type SoundName } from './sfxRecipes';

export type { SoundName };

const MUTE_KEY = 'star-slingers.muted';
const LOG_MAX = 200;

type Cap = { readonly max: number; readonly gapMs: number };
const CAPS = SFX.caps as Partial<Record<SoundName, Cap>> & { default: Cap };

/** One playing sound: its bus (to cut it short) and when it ends (audio clock, s). */
type Voice = { bus: GainNode; endsAt: number };

function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sfx {
  /** Every sound requested, oldest first (the last LOG_MAX); a stop() is
   *  logged as `-<name>`. Recorded before the lock, mute and cap checks. */
  readonly log: string[] = [];
  /** ± fraction of random pitch per play. */
  jitter: number = SFX.pitchJitter;
  /** Off only in the Sound Lab, to hear what the cap prevents. */
  capOn = true;

  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<SoundName, Voice[]>();
  private readonly lastAt = new Map<SoundName, number>();
  private volume: number = SFX.masterVolume;
  private isMuted: boolean;
  /** A resume() from a real gesture is in flight: plays may schedule (they
   *  sound the moment it lands, a few ms later). */
  private resuming = false;
  private hidden = false;

  /** `persist`: read and save the mute in localStorage (the game's; the lab's isn't). */
  constructor(private readonly persist = true) {
    this.isMuted = persist && this.readMuted();
  }

  get muted(): boolean {
    return this.isMuted;
  }
  set muted(m: boolean) {
    this.isMuted = m;
    if (this.persist) {
      try {
        localStorage.setItem(MUTE_KEY, m ? '1' : '0');
      } catch {
        // private mode / blocked storage: the toggle still works for this visit
      }
    }
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  /** Build the audio graph (first call) and resume it. Call from a tap: it
   *  does nothing outside a user activation, where a resume would only hang. */
  unlock(): void {
    if (this.hidden || navigator.userActivation?.isActive === false) return;
    if (!this.ac) {
      if (typeof window.AudioContext !== 'function') return; // no Web Audio: stay silent
      const ac = new AudioContext();
      const master = ac.createGain();
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = SFX.limiter.thresholdDb;
      limiter.ratio.value = SFX.limiter.ratio;
      const tame = ac.createBiquadFilter();
      tame.type = 'lowpass';
      tame.frequency.value = SFX.lowpassHz;
      master.connect(limiter).connect(tame).connect(ac.destination);
      this.ac = ac;
      this.master = master;
      this.noise = noiseBuffer(ac);
      this.applyVolume();
    }
    if (this.ac.state === 'running' || this.ac.state === 'closed') return;
    this.resuming = true;
    this.ac
      .resume()
      .catch(() => undefined)
      .finally(() => (this.resuming = false));
  }

  /** Page hidden (tab switched, phone locked): suspend, so nothing plays on
   *  while the game loop sleeps; shown again: resume, best effort (a browser
   *  that refuses waits for the next tap's unlock). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ac = this.ac;
    if (!ac || ac.state === 'closed') return;
    (hidden ? ac.suspend() : ac.resume()).catch(() => undefined);
  }

  /** Play a sound now, unless it's capped. */
  play(name: SoundName): void {
    this.record(name);
    const { ac, master, noise } = this;
    // A suspended context (not resuming) would bank plays and blast them all at once on resume.
    if (!ac || !master || !noise || this.isMuted || !(ac.state === 'running' || this.resuming)) return;
    const at = ac.currentTime;
    const live = this.liveVoices(name);
    const cap = CAPS[name] ?? CAPS.default;
    if (this.capOn && (live.length >= cap.max || (at - (this.lastAt.get(name) ?? -Infinity)) * 1000 < cap.gapMs)) return;
    const bus = ac.createGain();
    bus.connect(master);
    const k = 1 + (Math.random() * 2 - 1) * this.jitter;
    const span = { end: at };
    RECIPES[name]({ ac, out: bus, t0: at + 0.005, k, noise, span });
    live.push({ bus, endsAt: span.end });
    this.lastAt.set(name, at);
  }

  /** Cut a sound short: every voice of it still playing fades out fast. */
  stop(name: SoundName): void {
    this.record(`-${name}`);
    if (!this.ac) return;
    const now = this.ac.currentTime;
    for (const v of this.liveVoices(name)) {
      v.bus.gain.setTargetAtTime(0, now, SFX.stopFadeS / 3);
      v.endsAt = now + SFX.stopFadeS;
    }
  }

  private record(entry: string): void {
    this.log.push(entry);
    if (this.log.length > LOG_MAX) this.log.shift();
  }

  /** The sound's voices still playing; finished ones are disconnected and dropped. */
  private liveVoices(name: SoundName): Voice[] {
    const now = this.ac?.currentTime ?? 0;
    const live: Voice[] = [];
    for (const v of this.voices.get(name) ?? []) {
      if (v.endsAt > now) live.push(v);
      else v.bus.disconnect();
    }
    this.voices.set(name, live);
    return live;
  }

  /** Muting waits SFX.muteTailS, so a sound played just before it (the
   *  speaker's click) is heard. */
  private applyVolume(): void {
    if (!this.ac || !this.master) return;
    const at = this.ac.currentTime + (this.isMuted ? SFX.muteTailS : 0);
    this.master.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, at, 0.02);
  }

  private readMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }
}

/** The game's one sound player. */
export const sfx = new Sfx();
