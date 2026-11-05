/**
 * Sound Lab (#3): a soundboard for every proposed game sound, synthesized in
 * code (the game's own src/sfx.ts + src/sfxRecipes.ts). Tap a button to hear one; the demos play them
 * the way the game would, so the mix can be judged in context.
 */
import { SFX } from '../src/layout';
import { CSS } from '../src/tokens';
import { Sfx, type SoundName } from '../src/sfx';

const synth = new Sfx(false); // the game's sound player, without saving the mute

const GROUPS: { title: string; sounds: [SoundName, string][] }[] = [
  { title: 'Shots', sounds: [['thwip', 'FIRE · thwip'], ['charged', 'Charged · thwoom'], ['missile', 'Missile · fwoosh'], ['bombLaunch', 'Bomb · bloop'], ['detonate', 'Bomb blows']] },
  { title: 'Hits', sounds: [['rockBreak', 'Rock breaks'], ['toughDent', 'Two-hit rock · tonk'], ['refused', 'No effect · tink']] },
  { title: 'Fleet', sounds: [['shieldPop', 'Shield pops'], ['shipLost', 'Ship lost · bwomp'], ['shieldRebuild', 'Shield rebuilds']] },
  { title: 'Waves', sounds: [['waveClear', 'Wave clear'], ['runWon', 'Run won'], ['tryAgain', 'Try again? · wah-wah']] },
  { title: 'Upgrades', sounds: [['podsAppear', 'Pods appear'], ['podPickup', 'Pod taken'], ['podTimeout', 'Pods time out'], ['modeSwipe', 'SPECIAL swipe']] },
  { title: 'Between acts', sounds: [['flyby', 'Colony ship flyby (pans L→R)']] },
  { title: 'Command ship', sounds: [['bossEnter', 'Slides in · rumble'], ['bossHit', 'Hit · clang'], ['escortClunk', 'Escort · clunk'], ['beamCharge', 'Beam charging'], ['beamZap', 'Beam fires · zap'], ['bossDefeated', 'Beaten']] },
  { title: 'Giant asteroid', sounds: [['giantThump', 'Hit · thump'], ['giantBurst', 'Bursts']] },
  { title: 'Join screen', sounds: [['joinBlip', 'Seat joins'], ['countBeep', '3 · 2 · 1'], ['countGo', 'Go']] },
];

/** A scripted stretch of play: [seconds from start, sound]. */
type Script = [number, SoundName][];

/** Two seats firing steadily for 4s, some charged, rocks breaking. */
function rapidFire(): Script {
  const s: Script = [];
  for (let t = 0; t < 4; t += 0.14) {
    s.push([t, Math.random() < 0.2 ? 'charged' : 'thwip']); // top seat
    s.push([t + 0.07, Math.random() < 0.2 ? 'charged' : 'thwip']); // bottom seat
    if (Math.random() < 0.35) s.push([t + 0.25, 'rockBreak']);
  }
  return s;
}

/** About 12s of a wave: join, countdown, shooting, a shield pop, a pod, the clear. */
function waveDemo(): Script {
  const s: Script = [[0, 'joinBlip'], [0.5, 'joinBlip'], [1.2, 'countBeep'], [2.2, 'countBeep'], [3.2, 'countBeep'], [4.2, 'countGo']];
  const shots: [number, SoundName, SoundName?][] = [
    [5.0, 'thwip', 'rockBreak'], [5.4, 'thwip'], [5.7, 'thwip', 'toughDent'], [6.1, 'thwip', 'rockBreak'],
    [6.6, 'charged', 'rockBreak'], [7.0, 'thwip'], [7.3, 'missile', 'rockBreak'], [7.9, 'thwip', 'rockBreak'],
    [8.6, 'thwip'], [9.0, 'charged', 'rockBreak'], [9.8, 'thwip', 'rockBreak'],
  ];
  for (const [t, shot, hit] of shots) {
    s.push([t, shot]);
    if (hit) s.push([t + 0.3, hit]);
  }
  s.push([8.3, 'shieldPop'], [10.6, 'waveClear'], [11.8, 'shieldRebuild']);
  return s;
}

/** The command ship: slides in, escorts lock, beam charges and fires, then it's beaten. */
function bossDemo(): Script {
  return [
    [0, 'bossEnter'], [2.4, 'thwip'], [2.7, 'escortClunk'], [3.1, 'thwip'], [3.3, 'refused'],
    [3.6, 'beamCharge'], [4.0, 'thwip'], [4.3, 'escortClunk'], [5.45, 'beamZap'], [5.6, 'shieldPop'],
    [6.2, 'charged'], [6.45, 'bossHit'], [7.0, 'charged'], [7.25, 'bossHit'], [7.8, 'charged'], [8.05, 'bossDefeated'], [9.2, 'waveClear'],
    [10.5, 'podsAppear'], [11.6, 'thwip'], [11.85, 'podPickup'],
  ];
}

let stopDemo: (() => void) | null = null;

function runScript(script: Script, btn: HTMLButtonElement): void {
  stopDemo?.();
  const timers = script.map(([t, name]) => window.setTimeout(() => synth.play(name), t * 1000));
  const end = Math.max(...script.map(([t]) => t)) + 2.5;
  const done = window.setTimeout(() => stop(), end * 1000);
  btn.classList.add('on');
  const stop = (): void => {
    timers.forEach(clearTimeout);
    clearTimeout(done);
    btn.classList.remove('on');
    stopDemo = null;
  };
  stopDemo = stop;
}

function button(label: string, onTap: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  // pointerdown, not click: plays on touch with no delay, like the game's buttons.
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    synth.unlock();
    onTap(b);
  });
  return b;
}

function section(title: string, parent: HTMLElement): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  parent.append(h, grid);
  return grid;
}

function build(): void {
  const root = document.getElementById('lab')!;
  root.style.setProperty('--p1', CSS.p1);
  root.style.setProperty('--p2', CSS.p2);
  root.style.setProperty('--ink', CSS.ink);
  root.style.setProperty('--muted', CSS.chromeMuted);
  root.style.setProperty('--accent', CSS.accent);

  // Controls: volume, mute, the voice cap and the pitch variation.
  const ctl = document.createElement('div');
  ctl.className = 'controls';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '100';
  vol.value = String(SFX.masterVolume * 100);
  vol.addEventListener('input', () => synth.setVolume(Number(vol.value) / 100));
  const volLabel = document.createElement('label');
  volLabel.append('Volume ', vol);
  const mute = button('🔊', (b) => {
    synth.muted = !synth.muted;
    b.textContent = synth.muted ? '🔇' : '🔊';
  }, 'icon');
  /** An on/off button labelled with its state, reading and flipping it on the synth. */
  const toggle = (label: string, isOn: () => boolean, flip: () => void) => {
    const text = () => `${label}: ${isOn() ? 'on' : 'off'}`;
    return button(text(), (b) => {
      flip();
      b.textContent = text();
    }, 'toggle');
  };
  const cap = toggle('Voice cap', () => synth.capOn, () => (synth.capOn = !synth.capOn));
  const vary = toggle('Pitch variation', () => synth.jitter > 0, () => (synth.jitter = synth.jitter > 0 ? 0 : SFX.pitchJitter));
  ctl.append(mute, volLabel, cap, vary);
  root.append(ctl);

  const demos = section('In context', root);
  demos.append(
    button('▶ A wave (12s)', (b) => runScript(waveDemo(), b), 'demo'),
    button('▶ Command ship (13s)', (b) => runScript(bossDemo(), b), 'demo'),
    button('▶ Two seats rapid fire (4s)', (b) => runScript(rapidFire(), b), 'demo'),
    button('■ Stop', () => stopDemo?.(), 'demo'),
  );

  for (const g of GROUPS) {
    const grid = section(g.title, root);
    for (const [name, label] of g.sounds) grid.append(button(label, () => synth.play(name)));
  }
}

build();
