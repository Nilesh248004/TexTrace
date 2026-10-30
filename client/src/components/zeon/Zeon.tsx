// Zeon: the floating assistant. Text and voice (the browser's own speech tools), English only.
// Zeon answers and suggests; it never submits anything. A suggested page opens on a click, and a prepared form opens only after the
// person confirms, and still has to be sent with the form's own button.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Mic, RotateCcw, Send, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { ROLE_LABEL } from '@shared/permissions';
import type { ZeonAction, ZeonChatResponse, ZeonMessage } from '@shared/zeon';
import { ApiError, request } from '../../lib/api';
import { useSession, useTraces } from '../../lib/store';
import { blocks, inline, plainForSpeech, speechChunks, suggestionsFor } from '../../lib/zeonUi';
import { ZeonCry } from './ZeonCry';
import { ZeonFace } from './ZeonFace';
import './zeon.css';

interface Msg { id: number; role: 'user' | 'assistant'; text: string; actions?: ZeonAction[]; error?: boolean }
interface RecognitionLike { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null }
type RecognitionCtor = new () => RecognitionLike;

const recognitionCtor = (): RecognitionCtor | null => (typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition ?? null));
const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const SPEECH_SPEED = 1.1; // how fast Zeon talks (1 = normal)
const canVoice = (): boolean => typeof window !== 'undefined' && (typeof Audio !== 'undefined' || canSpeak());

/** The most natural-sounding English voice this browser has (the built-in fallback; the server's Gemini voice is used first). */
function bestVoice(): SpeechSynthesisVoice | undefined {
  const english = window.speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/samantha|aria|jenny|sonia|neerja|libby|serena|karen|moira/i.test(v.name) ? 2 : 0) + (/^en[-_]IN/i.test(v.lang) ? 1 : 0);
  return english.sort((a, b) => rank(b) - rank(a))[0];
}

// remembered per browser; every access is guarded because storage can be blocked
const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; } };
const write = (key: string, value: unknown): void => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } };

const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it in the browser\'s address bar and try again.',
  'service-not-allowed': 'The microphone is blocked. Allow it in the browser\'s address bar and try again.',
  'no-speech': 'I did not hear anything. Try again a little closer to the microphone.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input needs an internet connection.',
};

function Reply({ text }: { text: string }): JSX.Element {
  return <>{blocks(text).map((b, i) => b.kind === 'ul'
    ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it).map((p, k) => (typeof p === 'string' ? p : <strong key={k}>{p.bold}</strong>))}</li>)}</ul>
    : <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 ? <br /> : null}{inline(l).map((p, k) => (typeof p === 'string' ? p : <strong key={k}>{p.bold}</strong>))}</span>)}</p>)}</>;
}

export default function Zeon(): JSX.Element | null {
  const user = useSession((s) => s.user);
  const loc = useLocation(); const nav = useNavigate();
  const notes = useTraces((s) => s.notes);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [speak, setSpeak] = useState<boolean>(() => read('zeon.speak', false));
  const [burst, setBurst] = useState(0);
  // the icon's mood: crying by default (and again whenever Zeon is closed); smiling while the pointer is over it or while Zeon is open
  const [hover, setHover] = useState(false);
  const tiltRef = useRef<HTMLSpanElement | null>(null);
  const [nudge, setNudge] = useState('');
  const [handled, setHandled] = useState<Record<string, 'done' | 'skipped'>>({});
  const seq = useRef(0); const rec = useRef<RecognitionLike | null>(null); const lastError = useRef<{ label: string; reason: string; at: string; ts: number } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null); const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const seenNote = useRef(0);
  const Listen = useMemo(recognitionCtor, []);
  const role = user?.role;
  const route = `${loc.pathname}${loc.search}`;
  const suggestions = useMemo(() => suggestionsFor(role, route), [role, route]);

  // ---- voice: Gemini speaks the answer (natural, with feeling); the browser's own voice is the fallback
  const voice = useRef<{ token: number; audio: HTMLAudioElement | null; url: string | null }>({ token: 0, audio: null, url: null });
  const stopVoice = () => {
    const v = voice.current; v.token++;
    if (v.audio) { v.audio.pause(); v.audio = null; }
    if (v.url) { URL.revokeObjectURL(v.url); v.url = null; }
    if (canSpeak()) window.speechSynthesis.cancel();
  };

  // tell the page the panel is open, so the ledger confirmations can step aside
  useEffect(() => { document.documentElement.classList.toggle('zeon-open', open); return () => document.documentElement.classList.remove('zeon-open'); }, [open]);
  useEffect(() => { write('zeon.speak', speak); if (!speak) stopVoice(); }, [speak]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // closing the panel silences Zeon and stops the microphone; an answer that arrives after closing is not read out
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; if (!open) { rec.current?.abort(); stopVoice(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { rec.current?.abort(); stopVoice(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a refused action is the moment people most need help: remember it, and offer to explain
  useEffect(() => {
    const fresh = notes.filter((n) => n.id > seenNote.current && !n.trace.accepted);
    if (notes.length) seenNote.current = Math.max(seenNote.current, ...notes.map((n) => n.id));
    const n = fresh[fresh.length - 1];
    if (!n) return;
    lastError.current = { label: n.label.replace(/^Rejected:\s*/, ''), reason: n.trace.reason ?? 'The action was refused.', at: new Date().toISOString(), ts: Date.now() };
    if (!open) { setNudge('That action was refused. Want me to explain why?'); const t = setTimeout(() => setNudge(''), 14_000); return () => clearTimeout(t); }
  }, [notes, open]);

  const greeting = useMemo(() => {
    const first = user?.name.split(' ')[0] ?? 'there';
    return role === 'BUYER'
      ? `Hi ${first}, I'm Zeon. I can tell you where your yarn is, how your lots measured, and help you report a problem.`
      : `Hi ${first}, I'm Zeon. Ask me about lots, results, complaints or how to do something in TexTrace. I'll answer for your role (${role ? ROLE_LABEL[role] : ''}).`;
  }, [user, role]);

  const say = useCallback(async (text: string) => {
    if (!speak || !canVoice() || !openRef.current) return;
    stopVoice();
    const token = voice.current.token; const words = plainForSpeech(text);
    const fallback = () => {
      if (!canSpeak() || voice.current.token !== token || !openRef.current) return;
      const u = new SpeechSynthesisUtterance(words); u.lang = 'en-IN'; u.rate = SPEECH_SPEED; u.pitch = 1.03;
      const v = bestVoice(); if (v) { u.voice = v; u.lang = v.lang; }
      window.speechSynthesis.speak(u);
    };
    // every piece is requested at once; the first is short, so it comes back fast and starts playing while the others are still being made
    const pieces = speechChunks(words);
    const fetched = pieces.map((piece) => request<{ configured: boolean; mime?: string; audio?: string }>('POST', '/api/zeon/speak', { text: piece }).then((r) => r.data, () => null));
    let started = false;
    try {
      for (const [i, pending] of fetched.entries()) {
        const data = await pending;
        if (voice.current.token !== token || !openRef.current) return; // closed, muted or replaced while the voice was being made
        if (!data?.configured || !data.audio || typeof Audio === 'undefined') { if (i === 0) return fallback(); return; }
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: data.mime ?? 'audio/wav' }));
        const audio = new Audio(url); audio.playbackRate = SPEECH_SPEED; audio.preservesPitch = true;
        if (voice.current.url) URL.revokeObjectURL(voice.current.url);
        voice.current.audio = audio; voice.current.url = url;
        started = true;
        await new Promise<void>((done, fail) => { audio.onended = () => done(); audio.onerror = () => fail(new Error('audio')); audio.play().catch(fail); });
        if (voice.current.token !== token) return;
      }
    } catch { if (voice.current.token === token && !started) fallback(); }
  }, [speak]);

  const send = useCallback(async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    stopVoice();
    setNudge(''); setVoiceNote(''); setInput('');
    const mine: Msg = { id: ++seq.current, role: 'user', text };
    const history: ZeonMessage[] = [...msgs, mine].filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, mine]); setBusy(true);
    const err = lastError.current && Date.now() - lastError.current.ts < 10 * 60_000 ? { label: lastError.current.label, reason: lastError.current.reason, at: lastError.current.at } : null;
    const title = document.querySelector('.page h1, .pt-page h1, main h1')?.textContent?.trim().slice(0, 120);
    try {
      const { data } = await request<ZeonChatResponse>('POST', '/api/zeon/chat', { messages: history, context: { route, title, lastError: err } });
      setMsgs((m) => [...m, { id: ++seq.current, role: 'assistant', text: data.reply, actions: data.actions }]);
      void say(data.reply);
    } catch (e) {
      setMsgs((m) => [...m, { id: ++seq.current, role: 'assistant', error: true, text: e instanceof ApiError && e.status === 429 ? e.message : 'I could not reach the server just now. Please try again.' }]);
    } finally { setBusy(false); }
  }, [input, busy, msgs, route, say]);

  const openFromNudge = () => { setOpen(true); setNudge(''); void send('Why was that action refused, and what should I do?'); };

  // ---- voice
  const toggleListen = () => {
    if (!Listen) return;
    if (listening) { rec.current?.stop(); return; }
    stopVoice();
    setVoiceNote('');
    const r = new Listen(); rec.current = r; r.lang = 'en-IN'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => {
      let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput(t);
      if (e.results[e.results.length - 1].isFinal) { r.stop(); void send(t); }
    };
    r.onerror = (e) => { setListening(false); setVoiceNote(VOICE_ERRORS[e.error] ?? 'Voice input did not work. You can type your question instead.'); };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); } catch { setListening(false); }
  };

  // ---- the icon: fixed in the corner; it tilts toward the pointer and a click opens or closes the panel with a small spark burst
  const tilt = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); const el = tiltRef.current; if (!el) return;
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 26}deg`); el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 26}deg`);
  };
  const untilt = () => { tiltRef.current?.style.setProperty('--rx', '0deg'); tiltRef.current?.style.setProperty('--ry', '0deg'); };
  const toggle = () => { setOpen((o) => !o); setBurst((n) => n + 1); window.setTimeout(() => setBurst(0), 750); };

  const act = (m: Msg, i: number, a: ZeonAction) => {
    if (a.type === 'open_form') setHandled((h) => ({ ...h, [`${m.id}:${i}`]: 'done' }));
    nav(a.path);
  };
  const skip = (m: Msg, i: number) => setHandled((h) => ({ ...h, [`${m.id}:${i}`]: 'skipped' }));

  if (!user) return null;
  const empty = msgs.length === 0;
  return <div className={`zeon no-print${open ? ' open' : ''}`} data-testid="zeon">
    {open ? <section className="zeon-panel" role="dialog" aria-label="Zeon assistant" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <header className="zeon-head">
        <span className="zeon-orb sm" aria-hidden="true"><Zap size={15} /></span>
        <span className="zeon-title"><b>Zeon</b><small>Answering as {role ? ROLE_LABEL[role] : ''}</small></span>
        <button type="button" className="zeon-ico" onClick={() => setSpeak((v) => !v)} aria-pressed={speak} aria-label={speak ? 'Stop reading answers aloud' : 'Read answers aloud'} title={speak ? 'Reading answers aloud' : 'Read answers aloud'} disabled={!canVoice()} data-testid="zeon-speak">{speak ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <button type="button" className="zeon-ico" onClick={() => { setMsgs([]); setHandled({}); lastError.current = null; }} aria-label="Start a new conversation" title="New conversation" disabled={empty}><RotateCcw size={15} /></button>
        <button type="button" className="zeon-ico" onClick={() => setOpen(false)} aria-label="Close Zeon" data-testid="zeon-close"><X size={17} /></button>
      </header>
      <div className="zeon-body" aria-live="polite">
        <div className="zeon-msg bot"><Reply text={greeting} /></div>
        {empty ? <div className="zeon-chips" role="group" aria-label="Suggested questions">{suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)}>{s}</button>)}</div> : null}
        {msgs.map((m) => <div key={m.id} className={`zeon-msg ${m.role === 'user' ? 'me' : 'bot'}${m.error ? ' err' : ''}`} data-testid={m.role === 'user' ? 'zeon-user-msg' : 'zeon-bot-msg'}>
          {m.role === 'user' ? m.text : <Reply text={m.text} />}
          {m.actions?.map((a, i) => {
            const state = handled[`${m.id}:${i}`];
            return a.type === 'navigate'
              ? <button key={i} type="button" className="zeon-act" onClick={() => act(m, i, a)} data-testid="zeon-navigate">{a.label} <ArrowRight size={14} /></button>
              : <div key={i} className={`zeon-confirm${state ? ` ${state}` : ''}`} data-testid="zeon-confirm">
                <div className="zeon-confirm-text"><b>Prepare the complaint form?</b><span>{a.summary}</span><small>You'll review it and send it yourself.</small></div>
                {state === 'done' ? <span className="zeon-state"><Check size={14} /> Opened</span> : state === 'skipped' ? <span className="zeon-state">Not now</span>
                  : <div className="zeon-confirm-btns"><button type="button" className="zeon-act primary" onClick={() => act(m, i, a)} data-testid="zeon-open-form">Open the form</button><button type="button" className="zeon-act" onClick={() => skip(m, i)}>Not now</button></div>}
              </div>;
          })}
        </div>)}
        {busy ? <div className="zeon-msg bot typing" role="status" aria-label="Zeon is thinking"><i /><i /><i /></div> : null}
        <div ref={endRef} />
      </div>
      <form className="zeon-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {voiceNote ? <div className="zeon-voice-note" role="status">{voiceNote}</div> : null}
        <div className={`zeon-field${listening ? ' listening' : ''}`}>
          <textarea ref={inputRef} rows={1} value={input} maxLength={1500} placeholder={listening ? 'Listening…' : 'Ask Zeon anything about TexTrace'} aria-label="Message to Zeon" data-testid="zeon-input"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          {Listen ? <button type="button" className={`zeon-ico mic${listening ? ' on' : ''}`} onClick={toggleListen} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Speak your question'} title={listening ? 'Stop listening' : 'Speak your question'} data-testid="zeon-mic"><Mic size={17} /></button> : null}
          <button type="submit" className="zeon-send" disabled={busy || !input.trim()} aria-label="Send" data-testid="zeon-send"><Send size={16} /></button>
        </div>
        {!Listen ? <small className="zeon-hint">Voice input works in Chrome and Edge.</small> : null}
      </form>
    </section> : null}
    {nudge && !open ? <button type="button" className="zeon-nudge" onClick={openFromNudge} data-testid="zeon-nudge">{nudge}</button> : null}
    <button type="button" className={`zeon-fab${busy ? ' thinking' : ''}${listening ? ' listening' : ''}${nudge && !open ? ' alert' : ''}`} aria-label="Ask Zeon" aria-expanded={open} title="Ask Zeon" data-testid="zeon-fab"
      onClick={toggle} onPointerMove={tilt} onPointerLeave={() => { untilt(); setHover(false); }} onPointerEnter={() => setHover(true)}>
      <span className="zeon-aura" /><span className="zeon-ring" /><span className="zeon-ring r2" />
      <span className="zeon-orbit"><i className="zeon-spark s1" /><i className="zeon-spark s2" /><i className="zeon-spark s3" /></span>
      <span className="zeon-orbit rev"><i className="zeon-spark s1" /><i className="zeon-spark s2" /></span>
      <span className="zeon-shadow" />
      <span className="zeon-float"><span className="zeon-tilt" ref={tiltRef}><span className="zeon-mood" aria-hidden="true">{hover || open ? <ZeonFace key="happy" size={104} play /> : <ZeonCry key="sad" size={104} />}</span>
      </span></span>
      {burst ? Array.from({ length: 10 }, (_, i) => { const a = (Math.PI * 2 * i) / 10 + (i % 3) * 0.13; const d = 55 + (i % 4) * 8; return <i key={i} className="zeon-burst" style={{ '--tx': `${Math.cos(a) * d}px`, '--ty': `${Math.sin(a) * d}px` } as React.CSSProperties} />; }) : null}
    </button>
  </div>;
}
