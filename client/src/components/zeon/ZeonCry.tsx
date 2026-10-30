// Zeon's sad faces. mode 'stare' (the page's first look): it keeps alternating between looking around wide-eyed and a flat, unimpressed stare, with no tears.
// mode 'cry': only the loud cry: eyes squeezed shut, mouth wide open, tears streaming, bawling in a steady loop. Same technique as ZeonFace.
import { useEffect, useId, useRef } from 'react';
import { kf, cl, ss } from './ZeonFace';

const F = 3.6; const C0 = 3.05; const D = 0.42;
const SETTLED = 4.97; // from here on every track is constant, so the loop below can repeat without a visible jump
// the stare loops between two moments of the sequence: eyes wide open and looking ahead (LOOK_AT), and eyes rolled with the brows settled into a flat stare (STARE_AT)
const LOOK_AT = 0.55; const STARE_AT = 1.92; const STARE_PERIOD = 3.6;
const stareTime = (clock: number): number => { const ph = (clock % STARE_PERIOD) / STARE_PERIOD; const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; return LOOK_AT + (STARE_AT - LOOK_AT) * ss(cl((tri - 0.15) / 0.7)); };
const LOOP = 6 / F; // six sobs; also exactly three tear drops' worth of travel

type Els = Record<string, HTMLElement | SVGElement>;

function draw(els: Els, T0: number, clock: number, loud?: number): void {
  const $ = (k: string) => els[k] as SVGElement & HTMLElement;
  const t = T0 - D;
  const brow = (el: SVGElement, x: number, y: number, rot: number, arch: number) => { el.setAttribute('d', `M-8 0 Q0 ${-arch} 8 0`); el.setAttribute('transform', `translate(${x} ${y}) rotate(${rot})`); };

  const rr = kf(t, [[-9, 0], [0.1, 0], [0.35, 1], [1.05, 1], [1.4, 0.2], [9, 0.2]]);
  const phi = (kf(t, [[-9, 200], [0.35, 200], [1.05, -25], [9, -25]]) * Math.PI) / 180;
  const ox = 3.6 * rr * Math.cos(phi); const oy = -4.8 * rr * Math.sin(phi);
  const wet = kf(t, [[-9, 0], [2.0, 0], [2.45, 1], [2.8, 0.5], [9, 0.3]]);
  const lidL = kf(t, [[-9, 0.04], [0.12, 0.04], [0.32, 0.4], [1.0, 0.4], [1.3, 0.3], [1.85, 0.3], [1.93, 0.9], [2.03, 0.3], [2.45, 0.3], [2.62, 0.7], [2.85, 1], [9, 1]]);
  const lidR = kf(t, [[-9, 0.04], [0.12, 0.04], [0.32, 0.4], [1.0, 0.4], [1.3, 0.1], [1.85, 0.1], [1.93, 0.9], [2.03, 0.1], [2.45, 0.1], [2.62, 0.7], [2.85, 1], [9, 1]]);
  const tiltL = kf(t, [[-9, 0], [1.0, 0], [1.3, 2.6], [2.45, 2.6], [2.7, 0], [9, 0]]);

  const eye = (P: 'L' | 'R', cx: number, lid: number, tilt: number) => {
    const top = 60 - 10.5 - 1.5; const yb = top + lid * 24;
    const y1 = yb + (P === 'L' ? -tilt : tilt); const y2 = yb + (P === 'L' ? tilt : -tilt); const ym = (y1 + y2) / 2 + 2.2;
    $(`lid${P}`).setAttribute('d', `M${cx - 11} ${top} L${cx + 11} ${top} L${cx + 11} ${y2} Q${cx} ${ym} ${cx - 11} ${y1} Z`);
    $(`lide${P}`).setAttribute('d', `M${cx - 11} ${y1} Q${cx} ${ym} ${cx + 11} ${y2}`);
    $(`p${P}`).setAttribute('transform', `translate(${cx + ox} ${60 + oy})`);
    $(`ph${P}`).setAttribute('r', String(1.9 + 1.3 * wet));
    $(`eye${P}`).style.opacity = String(cl((1 - lid) / 0.06));
  };
  eye('L', 44, lidL, tiltL); eye('R', 80, lidR, 0);

  const sad = kf(t, [[-9, 0], [2.4, 0], [2.8, 1], [9, 1]]);
  brow($('bL') as SVGElement, 44 + sad * 1.5, kf(t, [[-9, 44], [0.12, 44], [0.35, 45.5], [1.3, 46.5], [2.45, 46.5], [2.8, 41]]), kf(t, [[-9, 0], [0.35, 3], [1.3, 13], [2.45, 13], [2.8, -30]]), kf(t, [[-9, 1.5], [2.4, 1.5], [2.8, 0.8]]));
  brow($('bR') as SVGElement, 80 - sad * 1.5, kf(t, [[-9, 44], [0.12, 44], [0.35, 41], [1.0, 41], [1.3, 34], [2.45, 34], [2.8, 41]]), kf(t, [[-9, 0], [0.35, -4], [1.3, -9], [2.45, -9], [2.8, 30]]), kf(t, [[-9, 1.5], [0.35, 2], [1.3, 5.5], [2.45, 5.5], [2.8, 0.8]]));

  const cv = cl((lidL - 0.94) / 0.05);
  const amp = loud !== undefined ? loud : kf(t, [[-9, 0], [C0, 0], [C0 + 0.3, 1], [4.2, 1], [4.55, 0.25]]); // loud: bawling at full strength
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * F * (t - C0) - Math.PI / 2);
  const j = amp * pulse * 0.95;
  $('cvL').setAttribute('d', `M38 ${54 + j} L49 ${61 + j} L38 ${68 + j}`); $('cvR').setAttribute('d', `M86 ${54 + j} L75 ${61 + j} L86 ${68 + j}`);
  $('cvL').style.opacity = String(cv); $('cvR').style.opacity = String(cv);

  const fl = kf(t, [[-9, 0.22], [2.5, 0.22], [2.9, 0.5], [9, 0.5]]);
  for (const P of ['L', 'R']) { $(`ch${P}`).setAttribute('opacity', String(fl)); $(`ch${P}`).setAttribute('ry', String(4.6 + 2.4 * sad)); $(`ch${P}`).setAttribute('rx', String(8.5 + 1.5 * sad)); }

  const xL = kf(t, [[-9, 45], [2.45, 45], [2.9, 38], [9, 38]]); const xR = kf(t, [[-9, 79], [2.45, 79], [2.9, 86], [9, 86]]);
  const yL = kf(t, [[-9, 87], [0.35, 88], [1.3, 88.5], [2.45, 88.5], [2.65, 90], [3.0, 93], [9, 93]]);
  const yR = kf(t, [[-9, 87], [0.35, 86], [1.3, 85.5], [2.45, 85.5], [2.65, 90], [3.0, 93], [9, 93]]);
  let ctrl = kf(t, [[-9, 87], [0.35, 86], [1.3, 86.5], [2.45, 86.5], [2.65, 79], [3.0, 68], [9, 68]]);
  let d = kf(t, [[-9, 0], [2.65, 0], [3.0, 25], [9, 25]]);
  d += 5 * amp * (pulse - 0.5) * 2; ctrl -= 2 * amp * pulse;
  const upper = `M${xL} ${yL} Q62 ${ctrl} ${xR} ${yR}`;
  const mid = 0.25 * yL + 0.5 * ctrl + 0.25 * yR; const yb = mid + Math.max(0, d);
  const lower = ` C${xR} ${yR + (yb - yR) * 0.72} ${xR - 12} ${yb} 62 ${yb} C${xL + 12} ${yb} ${xL} ${yL + (yb - yL) * 0.72} ${xL} ${yL} Z`;
  const open = cl(d / 3); const op = cl(d / 18);
  $('lip').setAttribute('d', upper); $('mf').setAttribute('d', upper + lower); $('mf').style.opacity = String(open); $('mcp').setAttribute('d', upper + lower);
  $('teeth').setAttribute('y', String(mid - 8)); $('teeth').setAttribute('height', String(8 + 10 * op)); $('teeth').style.opacity = String(open);
  $('tongue').setAttribute('cy', String(yb + 1)); $('tongue').setAttribute('ry', String(11 * op)); $('tongue').style.opacity = String(open);
  $('tongueH').setAttribute('cy', String(yb - 2)); $('tongueH').setAttribute('ry', String(3 * op)); $('tongueH').style.opacity = String(open);

  const ta = kf(t, [[-9, 0], [2.7, 0], [3.05, 1]]);
  (['L', 'R'] as const).forEach((P, si) => {
    const x0 = P === 'L' ? 40 : 84; const dir = P === 'L' ? -1 : 1; const len = 34 * ta; const s = $(`ts${P}`);
    s.setAttribute('d', `M${x0} 70 Q${x0 + dir * 2} ${70 + len / 2} ${x0 + dir * 3} ${70 + len}`); s.style.opacity = String(0.55 * ta);
    for (let k = 0; k < 3; k++) {
      const p = ((((t - 2.9) * 1.8 + k / 3 + si * 0.17) % 1) + 1) % 1;
      const g = $(`d${P}${k}`);
      g.setAttribute('transform', `translate(${x0 + dir * (3 + p * 6)} ${70 + p * 46}) scale(${0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, p * 1.6))})`);
      g.style.opacity = String(ta * Math.sin(Math.PI * p) ** 0.6);
    }
  });

  const zap = Math.sin(Math.PI * cl((t - 2.4) / 0.5));
  $('bl').setAttribute('transform', `translate(101 21) rotate(${10 * amp * Math.sin(Math.PI * F * (t - C0))}) scale(${1.25 * (1 + 0.3 * zap + 0.12 * amp * pulse)})`);

  const ph = (2 * Math.PI * clock) / 5.5;
  const tilt = kf(t, [[-9, 0], [0.35, 1.5], [1.0, 1.5], [1.35, 4.8], [2.45, 4.8], [2.8, 0], [9, 0]]) + Math.sin(2 * Math.PI * F * 0.5 * (t - C0)) * 2.4 * amp;
  const nod = kf(t, [[-9, 0], [0.3, 0], [0.75, -5], [1.25, -1], [1.35, 0], [2.45, 0], [2.85, 4], [9, 4]]);
  const bob = Math.sin(ph) * -1.8 + nod - 4.5 * amp * pulse;
  const ent = kf(T0, [[0, 0.72], [0.2, 1.07], [0.34, 0.98], [0.46, 1], [99, 1]]);
  $('st').style.transform = `translateY(${bob}px) rotate(${tilt}deg) scale(${(1 + 0.025 * amp * pulse) * ent})`;
  const hh = cl((bob + 12) / 20);
  $('sh').style.transform = `scale(${(0.62 + 0.38 * hh) * ent})`; $('sh').style.opacity = String(0.5 + 0.5 * hh);
}

const Drop = ({ k }: { k: string }) => <g data-k={k} opacity="0">
  <path d="M0 -6 Q4.2 0 4.2 2.6 A4.2 4.2 0 1 1 -4.2 2.6 Q-4.2 0 0 -6Z" fill="#d6e9ff" stroke="#8fb8ff" strokeWidth="1" /><circle cx="-1.4" cy="2" r="1.2" fill="#fff" />
</g>;

export function ZeonCry({ size = 120, mode = 'cry' }: { size?: number; mode?: 'stare' | 'cry' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = root.current; if (!host) return;
    const els: Els = {}; host.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { els[e.dataset.k as string] = e; });
    const stare = mode === 'stare';
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(els, stare ? STARE_AT : SETTLED, 0, stare ? 0 : 1); return; }
    let raf = 0; let start = 0;
    const frame = (now: number) => {
      start ||= now; const clock = (now - start) / 1000;
      if (stare) draw(els, stareTime(clock), clock, 0); // look, stare, look, stare: keeps going
      else draw(els, SETTLED + (clock % LOOP), clock, 1);
      raf = requestAnimationFrame(frame);
    };
    draw(els, stare ? stareTime(0) : SETTLED, 0, stare ? 0 : 1); raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const id = (n: string) => `${uid}${n}`; const ref = (n: string) => `url(#${uid}${n})`;
  const eye = (P: 'L' | 'R', cx: number) => <g data-k={`eye${P}`}>
    <ellipse cx={cx} cy="60" rx="9" ry="10.5" fill="#f3f7ff" stroke="#0e1352" strokeWidth="2" />
    <g clipPath={ref(`ec${P}`)}>
      <g data-k={`p${P}`}><circle r="5.2" fill="#0e1352" /><circle data-k={`ph${P}`} cx="1.9" cy="-2" r="1.9" fill="#fff" /><circle cx="-2" cy="2.4" r="1" fill="#fff" opacity=".7" /></g>
      <path data-k={`lid${P}`} fill={ref('bodyU')} />
      <path data-k={`lide${P}`} fill="none" stroke="#0e1352" strokeWidth="3.2" strokeLinecap="round" />
    </g>
  </g>;
  return <div ref={root} className="zeon-face" style={{ width: size, height: size }} aria-hidden="true">
    <div className="zeon-face-box" style={{ transform: `scale(${size / 390})`, width: 390, height: 390 }}>
      <div className="zeon-face-sh cry" data-k="sh" />
      <div className="zeon-face-st cry" data-k="st">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
          <defs>
            <radialGradient id={id('body')} cx="28%" cy="18%" r="90%"><stop offset="0" stopColor="#d8e7ff" /><stop offset=".16" stopColor="#8bb5ff" /><stop offset=".40" stopColor="#4f7df3" /><stop offset=".70" stopColor="#3545d4" /><stop offset="1" stopColor="#171678" /></radialGradient>
            <radialGradient id={id('bodyU')} gradientUnits="userSpaceOnUse" cx="42" cy="34" r="100"><stop offset="0" stopColor="#b9d2ff" /><stop offset=".38" stopColor="#547ff2" /><stop offset=".72" stopColor="#303cc5" /><stop offset="1" stopColor="#171678" /></radialGradient>
            <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stopColor="#150f78" stopOpacity="0" /><stop offset="1" stopColor="#150f78" stopOpacity=".5" /></linearGradient>
            <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".92" /><stop offset=".42" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <radialGradient id={id('bounce')}><stop offset="0" stopColor="#8cc8ff" stopOpacity=".6" /><stop offset="1" stopColor="#8cc8ff" stopOpacity="0" /></radialGradient>
            <linearGradient id={id('bolt')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fa8ff" /><stop offset="1" stopColor="#3a45d3" /></linearGradient>
            <filter id={id('glow')} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7" /></filter>
            <filter id={id('soft')}><feGaussianBlur stdDeviation="1.2" /></filter>
            <filter id={id('bglow')} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2" /></filter>
            <clipPath id={id('mc')}><path data-k="mcp" d="" /></clipPath>
            <clipPath id={id('ecL')}><ellipse cx="44" cy="60" rx="9" ry="10.5" /></clipPath>
            <clipPath id={id('ecR')}><ellipse cx="80" cy="60" rx="9" ry="10.5" /></clipPath>
          </defs>
          <circle cx="62" cy="72" r="50" fill="#4f7df3" opacity=".55" filter={ref('glow')} />
          <circle cx="62" cy="68" r="50" fill={ref('body')} />
          <circle cx="62" cy="68" r="50" fill={ref('shade')} />
          <circle cx="62" cy="68" r="49.5" fill="none" stroke="#fff" strokeOpacity=".34" strokeWidth=".8" />
          <ellipse cx="62" cy="103" rx="26" ry="9" fill={ref('bounce')} />
          <path d="M30 44 C34 26 50 20 62 20 C76 20 90 28 94 44 C84 36 74 34 62 34 C50 34 40 36 30 44 Z" fill={ref('gloss')} filter={ref('soft')} />
          <ellipse cx="47" cy="39" rx="22" ry="9" fill="#fff" opacity=".12" filter={ref('soft')} transform="rotate(-24 47 39)" />
          <ellipse data-k="chL" cx="33" cy="84" rx="8.5" ry="5" fill="#d3e1ff" />
          <ellipse data-k="chR" cx="91" cy="84" rx="8.5" ry="5" fill="#d3e1ff" />
          <path data-k="tsL" fill="none" stroke="#d6e9ff" strokeWidth="5.5" strokeLinecap="round" opacity="0" />
          <path data-k="tsR" fill="none" stroke="#d6e9ff" strokeWidth="5.5" strokeLinecap="round" opacity="0" />
          {eye('L', 44)}{eye('R', 80)}
          <path data-k="cvL" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" opacity="0" />
          <path data-k="cvR" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" opacity="0" />
          <path data-k="bL" fill="none" stroke="#0e1352" strokeWidth="4.4" strokeLinecap="round" />
          <path data-k="bR" fill="none" stroke="#0e1352" strokeWidth="4.4" strokeLinecap="round" />
          <path data-k="mf" fill="#0e1352" stroke="#0e1352" strokeWidth="2.4" strokeLinejoin="round" />
          <g clipPath={ref('mc')}><rect data-k="teeth" x="30" y="70" width="64" height="10" rx="4" fill="#fff" /><ellipse data-k="tongue" cx="62" cy="106" rx="16" ry="10" fill="#6f9bff" /><ellipse data-k="tongueH" cx="62" cy="103" rx="9" ry="3" fill="#a9c6ff" opacity=".7" /></g>
          <path data-k="lip" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" />
          {['dL0', 'dL1', 'dL2', 'dR0', 'dR1', 'dR2'].map((k) => <Drop key={k} k={k} />)}
          <g data-k="bl"><g transform="translate(-12 -12)">
            <path d="M13.2 2.6 4.6 13.4c-.4.5 0 1.2.6 1.2h5.2l-1 6.2c-.1.8.9 1.2 1.4.6l8.6-10.9c.4-.5 0-1.2-.6-1.2h-5.1l1-6.1c.1-.8-.9-1.2-1.5-.6Z" fill="#b9d3ff" filter={ref('bglow')} />
            <path d="M13.2 2.6 4.6 13.4c-.4.5 0 1.2.6 1.2h5.2l-1 6.2c-.1.8.9 1.2 1.4.6l8.6-10.9c.4-.5 0-1.2-.6-1.2h-5.1l1-6.1c.1-.8-.9-1.2-1.5-.6Z" fill={ref('bolt')} stroke="#f8fbff" strokeWidth="1.5" strokeLinejoin="round" />
          </g></g>
        </svg>
      </div>
    </div>
  </div>;
}
