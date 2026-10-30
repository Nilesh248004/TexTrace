// POST /api/zeon/chat: the in-app assistant. Everyone signed in may ask (staff and customers); what Zeon can look up is decided per role.
import type { Role } from '@shared/permissions';
import type { ZeonChatResponse, ZeonMessage } from '@shared/zeon';
import { config } from '../config';
import { nowIso } from '../lib/clock';
import { runZeon } from '../zeon/chat';
import { friendlyError, geminiModel } from '../zeon/gemini';
import type { ModelCall } from '../zeon/model';
import { geminiSpeech, type SpeechCall } from '../zeon/speech';
import { fail, newRouter, ok, type ApiCtx, type AuthedRequest } from './common';

const MAX_MESSAGES = 14;
const MAX_CHARS = 1500;

/** A small sliding-window limiter per person (in memory: it only has to stop runaway use, not survive a restart). */
const hits = new Map<string, number[]>();
function allowed(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 86_400_000);
  const lastMinute = recent.filter((t) => now - t < 60_000).length;
  if (lastMinute >= config.zeon.perMinute || recent.length >= config.zeon.perDay) { hits.set(userId, recent); return false; }
  recent.push(now); hits.set(userId, recent); return true;
}
export const resetZeonLimits = (): void => hits.clear();

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

export function zeonRouter(c: ApiCtx, options: { llm?: ModelCall; speech?: SpeechCall } = {}) {
  const r = newRouter();
  let real: ModelCall | null = null;
  const model = (): ModelCall | null => options.llm ?? (config.gemini.enabled ? (real ??= geminiModel()) : null);

  let realSpeech: SpeechCall | null = null;
  const speech = (): SpeechCall | null => options.speech ?? (config.gemini.enabled ? (realSpeech ??= geminiSpeech()) : null);
  const spoken = new Map<string, number[]>();

  // POST /api/zeon/speak: the answer as natural speech (WAV, base64). The browser falls back to its own voice if this is unavailable.
  r.post('/zeon/speak', async (req: AuthedRequest, res) => {
    const text = clean((req.body as { text?: unknown } | undefined)?.text, 900);
    if (!text) return fail(res, 422, 'VALIDATION_FAILED', 'Nothing to say.');
    const say = speech();
    if (!say) return ok(res, { configured: false });
    const now = Date.now(); const recent = (spoken.get(req.actor!.id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= config.zeon.perMinute * 6) return fail(res, 429, 'RATE_LIMITED', 'Too many spoken answers; please wait a moment.');
    spoken.set(req.actor!.id, [...recent, now]);
    try { const wav = await say(text); ok(res, { configured: true, mime: 'audio/wav', audio: wav.toString('base64') }); }
    catch (error) { console.warn('[zeon] speech failed:', (error as { status?: number } | null)?.status ?? '', error instanceof Error ? error.message.replace(/AIza[\w-]+/g, '[key]').slice(0, 300) : ''); ok(res, { configured: false }); }
  });

  r.post('/zeon/chat', async (req: AuthedRequest, res) => {
    const actor = req.actor!;
    const body = (req.body ?? {}) as { messages?: unknown; context?: Record<string, unknown> };
    const raw = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    const messages: ZeonMessage[] = raw
      .map((m) => ({ role: (m as ZeonMessage)?.role, content: clean((m as ZeonMessage)?.content, MAX_CHARS) }))
      .filter((m): m is ZeonMessage => (m.role === 'user' || m.role === 'assistant') && !!m.content);
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== 'user') return fail(res, 422, 'VALIDATION_FAILED', 'Send a question for Zeon to answer.');

    const ctx = body.context ?? {};
    const route = clean(ctx.route, 200);
    const le = ctx.lastError as { label?: unknown; reason?: unknown; at?: unknown } | null | undefined;
    const context = {
      route: route.startsWith('/') ? route : '/', title: clean(ctx.title, 150) || undefined,
      lastError: le && clean(le.label, 200) ? { label: clean(le.label, 200), reason: clean(le.reason, 400), at: clean(le.at, 40) } : null,
    };

    const llm = model();
    if (!llm) {
      const off: ZeonChatResponse = { reply: 'Zeon is not switched on for this mill yet: the server needs its AI access key (Gemini_API_KEY) to be set. Until then I can\'t answer questions, but everything else in TexTrace works as usual.', actions: [], configured: false };
      return ok(res, off);
    }
    if (!allowed(actor.id)) return fail(res, 429, 'RATE_LIMITED', 'You are asking Zeon a lot of questions very quickly. Please wait a moment and try again.');

    const customerName = actor.customerId ? (await c.db.prepare('SELECT name FROM customers WHERE id=?').get<{ name: string }>(actor.customerId))?.name ?? null : null;
    try {
      const out = await runZeon({
        user: { name: actor.name, role: actor.role as Role, customerName }, messages, context,
        base: `http://127.0.0.1:${req.socket.localPort}`, auth: req.header('authorization') ?? '', nowIso: nowIso(),
      }, llm);
      const response: ZeonChatResponse = { ...out, configured: true };
      ok(res, response);
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const detail = error instanceof Error ? error.message.replace(/AIza[\w-]+/g, '[key]').slice(0, 400) : '';
      console.warn('[zeon] request failed:', error instanceof Error ? error.constructor.name : 'error', status ?? '', detail);
      ok(res, { reply: friendlyError(error), actions: [], configured: true } satisfies ZeonChatResponse);
    }
  });
  return r;
}
