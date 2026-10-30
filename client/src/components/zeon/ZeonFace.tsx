// Zeon's face: the blue bolt orb that winks, smiles and then laughs. `play` runs that greeting once (when the panel opens) and then holds
// a friendly grin; without it the face is simply a still smile. Drawn as SVG and animated by setting attributes, so it needs no images.
import { useEffect, useId, useRef } from 'react';

export const cl = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ss = (x: number) => x * x * (3 - 2 * x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function kf(t: number, pts: [number, number][]): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1]; const [t1, v1] = pts[i]; return lerp(v0, v1, ss((t - t0) / (t1 - t0))); }
  return pts[pts.length - 1][1];
}
const arc = (x: number, y: number, c: number) => `M${x - 8} ${y + 4} Q${x} ${y + 4 - 14 * c} ${x + 8} ${y + 4}`;
const F = 3.4; const L0 = 2.3; const TOTAL = 4.13;
const HOLD = 5; // a time after the laugh has faded: a relaxed open smile

type Els = Record<string, HTMLElement | SVGElement>;

/** Draws the face for time `T0` seconds into the greeting. */
function draw(els: Els, T0: number, bobbing: boolean): void {
  const $ = (k: string) => els[k] as SVGElement & HTMLElement;
  const D = 0.5; let t = T0 - D;
  if (t > 0) { const H = 0.55; const O = 0.88; t = t < H ? t * (O / H) : t + (O - H); }
  const oR = kf(t, [[-9, 1], [-0.16, 1], [-0.03, 0.1], [0.05, 0], [0.88, 0], [0.98, 0.5], [1.12, 1.1], [1.28, 1], [1.55, 1], [1.62, 0.04], [1.72, 1], [1.92, 1], [2.22, 0], [9, 0]]);
  const oL = kf(t, [[-9, 1], [-0.1, 1], [0.05, 0.9], [1.0, 0.9], [1.3, 1], [1.55, 1], [1.62, 0.04], [1.72, 1], [1.92, 1], [2.22, 0], [9, 0]]);
  const amp = kf(t, [[0, 0], [2.2, 0], [2.45, 1], [3.4, 1], [3.96, 0.12]]);
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * F * (t - L0) - Math.PI / 2);
  const cR = cl(kf(t, [[-9, 0.1], [-0.1, 0.1], [0.06, 0.5], [0.45, 0.62], [0.88, 0.55], [1.0, 0.18], [1.6, 0.1], [1.92, 0.1], [2.3, 0.95], [9, 0.95]]) + 0.1 * amp * pulse);
  const cL = cl(kf(t, [[0, 0.1], [1.6, 0.15], [1.92, 0.15], [2.3, 0.95], [9, 0.95]]) + 0.1 * amp * pulse);
  const s = kf(t, [[-9, 0.35], [-0.1, 0.38], [0.1, 0.45], [0.9, 0.5], [1.2, 0.62], [1.8, 0.75], [2.3, 1], [9, 1]]);
  const asym = kf(t, [[-9, 0], [-0.12, 0], [0.1, 1], [0.9, 1], [1.25, 0], [9, 0]]);
  let m = kf(t, [[0, 0], [1.78, 0], [2.0, 0.5], [2.3, 0.72], [9, 0.72]]);
  m = cl(m + 0.26 * amp * pulse + (t > 3.5 ? 0.08 * ss((t - 3.5) / 0.46) : 0));

  const eye = (g: string, go: string, a: string, x: number, y: number, o: number, c: number) => {
    const oo = Math.max(0.04, o);
    $(g).setAttribute('transform', `translate(${x} ${y + 3.5 * (1 - Math.min(1, oo))})`);
    $(go).setAttribute('transform', `scale(1 ${oo})`); $(go).style.opacity = String(cl((o - 0.1) / 0.06));
    $(a).setAttribute('d', arc(x, y + 2, c)); $(a).style.opacity = String(cl((0.15 - o) / 0.06));
  };
  eye('eL', 'eLo', 'aL', 44, 60, oL, cL); eye('eR', 'eRo', 'aR', 80, 60, oR, cR);
  for (const k of ['chL', 'chR']) { $(k).setAttribute('rx', String(8 + 2 * s)); $(k).setAttribute('ry', String(4.6 + 1.2 * s + (k === 'chR' ? 1.2 * (1 - oR) * (t < 1.5 ? 1 : 0) : 0))); }
  $('chL').setAttribute('opacity', String(0.28 + 0.35 * s)); $('chR').setAttribute('opacity', String(0.28 + 0.35 * s + 0.1 * (1 - oR)));

  const xL = 41 - 2.5 * s; const xR = 83 + 2.5 * s; const yc = 79 - 3.2 * s; const yL = yc + 1.5 * asym; const yR = yc - 5 * asym;
  const ctrl = lerp(yc + 22 * (0.75 + 0.25 * s), yc + 0.6, Math.pow(m, 0.7));
  const upper = `M${xL} ${yL} Q62 ${ctrl} ${xR} ${yR}`;
  const yMid = 0.25 * yL + 0.5 * ctrl + 0.25 * yR; const yb = yMid + 31 * m;
  const lower = ` C${xR} ${yR + (yb - yR) * 0.72} ${xR - 11} ${yb} 62 ${yb} C${xL + 11} ${yb} ${xL} ${yL + (yb - yL) * 0.72} ${xL} ${yL} Z`;
  const open = cl(m * 7); const mm = cl(m * 1.6);
  $('lip').setAttribute('d', upper);
  $('mf').setAttribute('d', upper + lower); $('mf').style.opacity = String(open); $('mcp').setAttribute('d', upper + lower);
  const top = Math.min(yL, yR, yMid);
  $('teeth').setAttribute('y', String(top - 4)); $('teeth').setAttribute('height', String(yMid - top + 4 + 10 * mm)); $('teeth').style.opacity = String(open);
  $('tongue').setAttribute('cy', String(yb + 1)); $('tongue').setAttribute('ry', String(10 * cl(m * 1.3))); $('tongue').style.opacity = String(open);
  $('tongueH').setAttribute('cy', String(yb - 2)); $('tongueH').setAttribute('ry', String(3 * cl(m * 1.3))); $('tongueH').style.opacity = String(open);

  const u1 = cl((t - 0.3) / 0.5); const u2 = cl((t - 0.55) / 0.4);
  $('sp').setAttribute('transform', `translate(100 46) rotate(${45 * u1}) scale(${Math.sin(Math.PI * u1)})`); $('sp').setAttribute('opacity', u1 > 0 && u1 < 1 ? '1' : '0');
  $('sp2').setAttribute('transform', `translate(92 38) rotate(${-30 * u2}) scale(${Math.sin(Math.PI * u2)})`); $('sp2').setAttribute('opacity', u2 > 0 && u2 < 1 ? '0.9' : '0');

  const pop = Math.sin(Math.PI * cl((t - 0.4) / 0.45));
  const bk = 1.25 * (1 + 0.12 * pop + 0.14 * amp * pulse); const br = 8 * amp * Math.sin(Math.PI * F * (t - L0));
  $('bl').setAttribute('transform', `translate(101 21) rotate(${br}) scale(${bk})`);

  const ph = (2 * Math.PI * T0) / TOTAL;
  const tilt = kf(t, [[-9, 0], [-0.15, 0], [0.3, -4], [0.88, -4.5], [1.3, 0], [9, 0]]) + Math.sin(2 * Math.PI * F * 0.5 * (t - L0)) * 2.2 * amp;
  const nod = kf(t, [[-9, 0], [-0.1, 0], [0.25, 3], [0.88, 3], [1.25, 0], [9, 0]]);
  const bob = (bobbing ? Math.sin(ph) * -3 : 0) - 7 * amp * pulse + nod;
  const ent = kf(T0, [[0, 0.72], [0.2, 1.07], [0.34, 0.98], [0.46, 1], [99, 1]]);
  $('st').style.transform = `translateY(${bob}px) rotate(${tilt}deg) scale(${(1 + 0.022 * amp * pulse) * ent})`;
  const hh = cl((bob + 12) / 20);
  $('sh').style.transform = `scale(${(0.62 + 0.38 * hh) * ent})`; $('sh').style.opacity = String(0.5 + 0.5 * hh);
}

export function ZeonFace({ size = 120, play = false }: { size?: number; play?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = root.current; if (!host) return;
    const els: Els = {}; host.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { els[e.dataset.k as string] = e; });
    const still = play === false || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (still) { draw(els, HOLD, false); return; }
    let raf = 0; let start = 0;
    const frame = (now: number) => {
      start ||= now; const T0 = (now - start) / 1000;
      if (T0 >= HOLD) { draw(els, HOLD, false); return; } // greeting finished: rest on the grin
      draw(els, T0, true); raf = requestAnimationFrame(frame);
    };
    draw(els, 0, true); raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [play]);

  const id = (n: string) => `${uid}${n}`; const ref = (n: string) => `url(#${uid}${n})`;
  return <div ref={root} className="zeon-face" style={{ width: size, height: size }} aria-hidden="true">
    <div className="zeon-face-box" style={{ transform: `scale(${size / 360})` }}>
      <div className="zeon-face-sh" data-k="sh" />
      <div className="zeon-face-st" data-k="st">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
          <defs>
            <radialGradient id={id('body')} cx="30%" cy="22%" r="95%"><stop offset="0" stopColor="#9cc0ff" /><stop offset=".34" stopColor="#4f7df3" /><stop offset=".68" stopColor="#3a45d3" /><stop offset="1" stopColor="#241f9e" /></radialGradient>
            <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stopColor="#150f78" stopOpacity="0" /><stop offset="1" stopColor="#150f78" stopOpacity=".5" /></linearGradient>
            <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".78" /><stop offset="1" stopColor="#fff" stopOpacity=".02" /></linearGradient>
            <radialGradient id={id('bounce')}><stop offset="0" stopColor="#8cc8ff" stopOpacity=".6" /><stop offset="1" stopColor="#8cc8ff" stopOpacity="0" /></radialGradient>
            <linearGradient id={id('bolt')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fa8ff" /><stop offset="1" stopColor="#3a45d3" /></linearGradient>
            <filter id={id('glow')} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7" /></filter>
            <filter id={id('soft')}><feGaussianBlur stdDeviation="1.2" /></filter>
            <filter id={id('bglow')} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2" /></filter>
            <clipPath id={id('mc')}><path data-k="mcp" d="" /></clipPath>
          </defs>
          <circle cx="62" cy="72" r="50" fill="#4f7df3" opacity=".55" filter={ref('glow')} />
          <circle cx="62" cy="68" r="50" fill={ref('body')} />
          <circle cx="62" cy="68" r="50" fill={ref('shade')} />
          <circle cx="62" cy="68" r="49.5" fill="none" stroke="#fff" strokeOpacity=".25" />
          <ellipse cx="62" cy="103" rx="26" ry="9" fill={ref('bounce')} />
          <path d="M30 44 C34 26 50 20 62 20 C76 20 90 28 94 44 C84 36 74 34 62 34 C50 34 40 36 30 44 Z" fill={ref('gloss')} filter={ref('soft')} />
          <ellipse data-k="chL" cx="34" cy="84" rx="8.5" ry="5" fill="#d3e1ff" />
          <ellipse data-k="chR" cx="90" cy="84" rx="8.5" ry="5" fill="#d3e1ff" />
          {(['L', 'R'] as const).map((side) => <g key={side} data-k={`e${side}`}><g data-k={`e${side}o`}><ellipse rx="6.6" ry="9" fill="#0e1352" /><ellipse cx="2" cy="-3.6" rx="2.6" ry="3" fill="#fff" /><circle cx="-2" cy="4" r="1.3" fill="#fff" opacity=".8" /></g></g>)}
          <path data-k="aL" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" />
          <path data-k="aR" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" />
          <path data-k="mf" fill="#0e1352" stroke="#0e1352" strokeWidth="2.4" strokeLinejoin="round" />
          <g clipPath={ref('mc')}><rect data-k="teeth" x="34" y="70" width="56" height="10" rx="4" fill="#fff" /><ellipse data-k="tongue" cx="62" cy="106" rx="14" ry="10" fill="#6f9bff" /><ellipse data-k="tongueH" cx="62" cy="103" rx="8" ry="3" fill="#a9c6ff" opacity=".7" /></g>
          <path data-k="lip" fill="none" stroke="#0e1352" strokeWidth="4.8" strokeLinecap="round" />
          <path data-k="sp" d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4Z" fill="#fff" opacity="0" />
          <path data-k="sp2" d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6Z" fill="#fff" opacity="0" />
          <g data-k="bl"><g transform="translate(-12 -12)">
            <path d="M13.2 2.6 4.6 13.4c-.4.5 0 1.2.6 1.2h5.2l-1 6.2c-.1.8.9 1.2 1.4.6l8.6-10.9c.4-.5 0-1.2-.6-1.2h-5.1l1-6.1c.1-.8-.9-1.2-1.5-.6Z" fill="#6f9bff" filter={ref('bglow')} />
            <path d="M13.2 2.6 4.6 13.4c-.4.5 0 1.2.6 1.2h5.2l-1 6.2c-.1.8.9 1.2 1.4.6l8.6-10.9c.4-.5 0-1.2-.6-1.2h-5.1l1-6.1c.1-.8-.9-1.2-1.5-.6Z" fill={ref('bolt')} stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
          </g></g>
        </svg>
      </div>
    </div>
  </div>;
}
