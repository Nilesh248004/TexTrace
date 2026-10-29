// Optional LLM narrative on top of the deterministic analysis. Without ANTHROPIC_API_KEY the statistical result is shown as is.
// The model only gets the engine's JSON, must not add causes, and its output is rejected if it cites a number the engine did not
// produce — so the narrative can never introduce data.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import type { AnalysisResult, LlmMeta } from '@shared/domain';

const SYSTEM = [
  'You assist the QA head of a cotton spinning mill who is investigating a customer complaint.',
  'You receive the output of a deterministic statistical analysis (JSON). Write a short, plain-language narrative of it.',
  'Rules: use ONLY facts and numbers that appear in the JSON; never add causes, machines, lots, customers or numbers of your own; keep the ranking and confidence as given;',
  'say clearly when evidence is contributory rather than conclusive; the final decision belongs to the QA head.',
  'Reply with one JSON object only: {"headline": string (max 140 chars), "text": string (max 900 chars, 2-4 short paragraphs separated by \\n\\n), "cautions": string[] (1-3 items)}.',
].join(' ');

export const disabledMeta = (): LlmMeta => ({ enabled: false, status: 'disabled', provider: null, model: null, latencyMs: null, prompt: null, inputJson: null, outputJson: null, error: null, validation: null });

function compact(r: AnalysisResult) {
  return {
    lot: r.lot, complaint: r.complaint, headline: r.summary.headline, referenceLots: r.referenceLots.length,
    rootCauses: r.rootCauses.map((c) => ({ rank: c.rank, title: c.title, category: c.category, confidence: c.confidence, evidence: c.evidence.slice(0, 5).map((e) => e.text), contrast: c.contrast, affectedLots: c.affected.lots, dates: c.affected.dates, shifts: c.affected.shifts })),
    correlations: r.correlations, ruledOut: r.ruledOut.slice(0, 6),
    recall: { totalKgAtRisk: r.recallScope.totalKgAtRisk, customers: r.recallScope.customers, lots: r.recallScope.lots.map((l) => ({ lotNo: l.lotNo, risk: l.risk, customer: l.customerName, openComplaint: l.openComplaint, reason: l.reason })) },
    corrective: r.actions.corrective.map((a) => a.text), preventive: r.actions.preventive.map((a) => a.text),
  };
}

/** Numbers in `text` that are not present in the engine JSON (small ordinals are ignored). */
export function unknownNumbers(text: string, source: string): string[] {
  const allowed = new Set((source.match(/\d[\d,]*\.?\d*/g) ?? []).map((n) => n.replace(/,/g, '')));
  const bad: string[] = [];
  for (const m of text.match(/\d[\d,]*\.?\d*/g) ?? []) {
    const n = m.replace(/,/g, '').replace(/\.$/, '');
    if (Number(n) <= 10 && !n.includes('.')) continue;
    if (!allowed.has(n) && !source.includes(n)) bad.push(m);
  }
  return [...new Set(bad)];
}

export async function narrate(result: AnalysisResult): Promise<{ result: AnalysisResult; llm: LlmMeta }> {
  if (!config.ai.enabled) return { result, llm: disabledMeta() };
  const input = compact(result);
  const inputJson = JSON.stringify(input);
  const started = Date.now();
  const meta: LlmMeta = { enabled: true, status: 'failed', provider: 'anthropic', model: config.ai.model, latencyMs: null, prompt: SYSTEM, inputJson: input, outputJson: null, error: null, validation: null };
  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey, timeout: config.ai.timeoutMs, maxRetries: 1 });
    const params = {
      model: config.ai.model, max_tokens: 4000, system: SYSTEM, output_config: { effort: config.ai.effort },
      messages: [{ role: 'user' as const, content: `Analysis JSON:\n${inputJson}` }],
    };
    // Refusal fallback (server-side) is opt-in by default; AI_FALLBACKS=off disables it.
    const response = config.ai.fallbacks === 'default'
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never)
      : await client.messages.create(params as never);
    const msg = response as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
    meta.latencyMs = Date.now() - started;
    if (msg.stop_reason === 'refusal') { meta.status = 'failed'; meta.error = 'The model declined to write a narrative; the statistical result is shown instead.'; return { result, llm: meta }; }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    const json = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as { headline?: string; text?: string; cautions?: string[] };
    meta.outputJson = json;
    if (typeof json.headline !== 'string' || typeof json.text !== 'string' || !Array.isArray(json.cautions)) { meta.status = 'rejected'; meta.validation = 'Narrative JSON did not have headline, text and cautions.'; return { result, llm: meta }; }
    const bad = unknownNumbers(`${json.headline} ${json.text} ${json.cautions.join(' ')}`, inputJson);
    if (bad.length) { meta.status = 'rejected'; meta.validation = `Narrative cited numbers that are not in the analysis (${bad.slice(0, 6).join(', ')}) and was discarded.`; return { result, llm: meta }; }
    meta.status = 'ok'; meta.validation = 'Every number in the narrative appears in the statistical result.';
    return { result: { ...result, narrative: { source: 'llm', headline: json.headline, text: json.text, cautions: json.cautions } }, llm: meta };
  } catch (error) {
    meta.latencyMs = Date.now() - started;
    meta.error = error instanceof Error ? error.message.replace(config.ai.apiKey, '***') : 'Narrative request failed';
    return { result, llm: meta };
  }
}
