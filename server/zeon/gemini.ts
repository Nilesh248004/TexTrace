// Zeon's model: Google Gemini, through the same `@google/genai` library and Gemini_API_KEY the PDF import already uses.
// Everything provider-specific lives here as small pure functions (easy to test) plus one function that makes the call.
import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from '@google/genai';
import { config } from '../config';
import type { ModelCall, ModelReply, ModelRequest, ModelTool, ToolCall, Turn } from './model';

/** Just the part of the client Zeon uses, so tests can hand in a fake. */
export interface GenAiLike { models: { generateContent: (params: Record<string, unknown>) => Promise<GenerateContentResponse> } }

const THINKING: Record<string, 'LOW' | 'MEDIUM' | 'HIGH'> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', xhigh: 'HIGH', max: 'HIGH' };
export const thinkingLevelFor = (effort: string): 'LOW' | 'MEDIUM' | 'HIGH' => THINKING[effort] ?? 'LOW';
/** Gemini 2.5 models take a thinking budget (tokens); Gemini 3 models take a named level. Looking things up needs little thinking, which keeps answers quick. */
const BUDGET: Record<string, number> = { low: 256, medium: 1024, high: 4096 };
export const thinkingFor = (model: string, effort: string): Record<string, unknown> =>
  /gemini-2\.5/.test(model) ? { thinkingBudget: /lite/.test(model) ? 0 : (BUDGET[effort] ?? 256) } : { thinkingLevel: thinkingLevelFor(effort) };
const MAX_OUTPUT_TOKENS = 2048;
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);

/** Gemini takes JSON Schema for function parameters; `additionalProperties` is not part of the accepted subset, and our tools validate their own input anyway. */
export function toGeminiTools(tools: ModelTool[]): { functionDeclarations: { name: string; description: string; parametersJsonSchema: Record<string, unknown> }[] }[] {
  if (!tools.length) return [];
  return [{ functionDeclarations: tools.map((t) => { const { additionalProperties: _drop, ...schema } = t.parameters; void _drop; return { name: t.name, description: t.description, parametersJsonSchema: schema }; }) }];
}

/** A tool's JSON text → the object Gemini wants in `functionResponse.response`. */
function responseObject(output: string, isError: boolean): Record<string, unknown> {
  let value: unknown = output;
  try { value = JSON.parse(output); } catch { /* keep the text */ }
  if (isError) return { error: value && typeof value === 'object' && 'error' in (value as object) ? (value as { error: unknown }).error : value };
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { result: value };
}

export function toGeminiContents(turns: Turn[]): Content[] {
  return turns.map((t): Content => {
    if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
    if (t.role === 'model') {
      if (t.raw) return t.raw as Content; // the model's own turn, thought signatures included: Gemini 3 needs them back during function calling
      const parts: Part[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const c of t.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
      return { role: 'model', parts: parts.length ? parts : [{ text: '' }] };
    }
    // all answers to one turn's tool calls go back together, in the order they were asked
    return { role: 'user', parts: t.results.map((r) => ({ functionResponse: { ...(r.id.startsWith('call_') ? {} : { id: r.id }), name: r.name, response: responseObject(r.output, r.isError) } })) };
  });
}

export function readReply(response: GenerateContentResponse): ModelReply {
  if (response.promptFeedback?.blockReason) return { text: '', toolCalls: [], outcome: 'blocked' };
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string).join('').trim();
  const toolCalls: ToolCall[] = parts.filter((p) => p.functionCall?.name).map((p, i) => ({ id: p.functionCall?.id ?? `call_${i}`, name: String(p.functionCall?.name), args: (p.functionCall?.args ?? {}) as Record<string, unknown> }));
  const raw = candidate?.content;
  if (toolCalls.length) return { text, toolCalls, outcome: 'tool_calls', raw };
  const reason = String(candidate?.finishReason ?? '');
  if (BLOCKED.has(reason) && !text) return { text: '', toolCalls: [], outcome: 'blocked' };
  if (reason === 'MAX_TOKENS' && !text) return { text: '', toolCalls: [], outcome: 'too_long' };
  return text ? { text, toolCalls: [], outcome: 'answer', raw } : { text: '', toolCalls: [], outcome: 'empty' };
}

// 404 = this model name is not available to the key (retired or not enabled): another model may still work
const transient = (e: unknown): boolean => [404, 408, 429, 500, 502, 503, 504].includes(Number((e as { status?: unknown } | null)?.status));
const thinkingRejected = (e: unknown): boolean => Number((e as { status?: unknown } | null)?.status) === 400 && /think/i.test(String((e as Error | null)?.message ?? ''));

/** The real model call. `client` can be replaced in tests. */
export function geminiModel(client: GenAiLike = new GoogleGenAI({ apiKey: config.gemini.apiKey, httpOptions: { timeout: config.zeon.timeoutMs, retryOptions: { attempts: 1 } } }) as unknown as GenAiLike): ModelCall {
  return async (req: ModelRequest): Promise<ModelReply> => {
    const midLoop = req.turns.some((t) => t.role === 'tool');
    // a different model cannot be trusted to accept another model's thought signatures, so we only fall back before any tool has run
    const models = midLoop ? [config.zeon.model] : [...new Set([config.zeon.model, ...config.zeon.fallbackModels])];
    let thinking = true;
    let lastError: unknown;
    for (const [i, model] of models.entries()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await client.models.generateContent({
            model,
            contents: toGeminiContents(req.turns),
            config: {
              systemInstruction: req.system,
              tools: toGeminiTools(req.tools),
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              ...(thinking ? { thinkingConfig: thinkingFor(model, config.zeon.effort) } : {}),
            },
          });
          return readReply(response);
        } catch (error) {
          lastError = error;
          if (thinking && thinkingRejected(error)) { thinking = false; continue; } // this model has no thinking level: ask again without it
          if (!transient(error) || i === models.length - 1) throw error;
          break; // transient: move on to the next model
        }
      }
    }
    throw lastError;
  };
}

/** A calm, honest message for whatever went wrong; details stay in the server log and never include the key. */
export function friendlyError(error: unknown): string {
  const status = Number((error as { status?: unknown } | null)?.status);
  const message = String((error as Error | null)?.message ?? '');
  if (status === 429) return 'Zeon is busy right now. Please try again in a minute.';
  if (status === 401 || status === 403 || (status === 400 && /api key|permission|credential/i.test(message))) return 'Zeon cannot reach its AI service because the server\'s access key is not accepted. Please tell the mill administrator.';
  if (status === 408 || status === 504 || /timeout|timed out|abort/i.test(message) || (error as Error | null)?.name === 'AbortError') return 'Zeon took too long to answer. Please try again, or ask a shorter question.';
  return 'Zeon is not available at the moment. Please try again shortly.';
}
