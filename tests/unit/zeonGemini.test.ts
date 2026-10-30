// The Gemini side of Zeon: how our neutral turns and tools are written for Gemini, how its replies are read, and how failures are handled.
import { describe, expect, it } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { config } from '../../server/config';
import { friendlyError, geminiModel, readReply, thinkingFor, thinkingLevelFor, toGeminiContents, toGeminiTools, type GenAiLike } from '../../server/zeon/gemini';
import type { ModelRequest } from '../../server/zeon/model';

const res = (r: unknown) => r as GenerateContentResponse;
const request = (turns: ModelRequest['turns'] = [{ role: 'user', text: 'hi' }]): ModelRequest => ({ system: 'SYS', tools: [{ name: 'get_lot', description: 'd', parameters: { type: 'object', properties: { lot: { type: 'string' } }, required: ['lot'], additionalProperties: false } }], turns });
const apiError = (status: number, message = 'x') => Object.assign(new Error(message), { status });

describe('Zeon on Gemini', () => {
  it('describes tools as function declarations', () => {
    const [t] = toGeminiTools(request().tools);
    expect(t.functionDeclarations[0]).toEqual({ name: 'get_lot', description: 'd', parametersJsonSchema: { type: 'object', properties: { lot: { type: 'string' } }, required: ['lot'] } });
    expect(toGeminiTools([])).toEqual([]);
  });

  it('writes turns as Gemini contents, replaying the model\'s own turn and batching tool answers', () => {
    const sealed = { role: 'model', parts: [{ functionCall: { name: 'get_lot', args: { lot: '1' } }, thoughtSignature: 'sig' }] };
    const out = toGeminiContents([
      { role: 'user', text: 'q' }, { role: 'model', text: 'earlier answer' },
      { role: 'user', text: 'again' }, { role: 'model', text: '', toolCalls: [{ id: 'call_0', name: 'get_lot', args: { lot: '1' } }], raw: sealed },
      { role: 'tool', results: [{ id: 'call_0', name: 'get_lot', output: '{"lot":{"lotNo":"1"}}', isError: false }, { id: 'abc', name: 'alerts', output: '[1,2]', isError: false }, { id: 'z', name: 'x', output: '{"error":"Not found"}', isError: true }] },
    ]);
    expect(out[0]).toEqual({ role: 'user', parts: [{ text: 'q' }] });
    expect(out[1]).toEqual({ role: 'model', parts: [{ text: 'earlier answer' }] });
    expect(out[3]).toBe(sealed); // thought signature kept
    expect(out[4].role).toBe('user');
    expect(out[4].parts).toEqual([
      { functionResponse: { name: 'get_lot', response: { lot: { lotNo: '1' } } } }, // our own placeholder id is not sent
      { functionResponse: { id: 'abc', name: 'alerts', response: { result: [1, 2] } } },
      { functionResponse: { id: 'z', name: 'x', response: { error: 'Not found' } } },
    ]);
  });

  it('reads answers, tool calls, blocks and cut-offs', () => {
    expect(readReply(res({ candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: ' Hello ' }] }, finishReason: 'STOP' }] }))).toMatchObject({ text: 'Hello', outcome: 'answer' });
    const calls = readReply(res({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_lot', args: { lot: '1' } } }, { functionCall: { id: 'k', name: 'alerts' } }] } }] }));
    expect(calls.outcome).toBe('tool_calls'); expect(calls.toolCalls).toEqual([{ id: 'call_0', name: 'get_lot', args: { lot: '1' } }, { id: 'k', name: 'alerts', args: {} }]); expect(calls.raw).toBeTruthy();
    expect(readReply(res({ promptFeedback: { blockReason: 'SAFETY' } })).outcome).toBe('blocked');
    expect(readReply(res({ candidates: [{ finishReason: 'SAFETY' }] })).outcome).toBe('blocked');
    expect(readReply(res({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] })).outcome).toBe('too_long');
    expect(readReply(res({ candidates: [] })).outcome).toBe('empty');
  });

  it('uses a thinking budget on 2.5 models and a level on newer ones', () => {
    expect(thinkingFor('gemini-2.5-flash', 'low')).toEqual({ thinkingBudget: 256 }); expect(thinkingFor('gemini-2.5-flash-lite', 'low')).toEqual({ thinkingBudget: 0 }); expect(thinkingFor('gemini-3.8-flash', 'low')).toEqual({ thinkingLevel: 'MINIMAL' });
  });

  it('maps effort to a thinking level', () => { expect(thinkingLevelFor('low')).toBe('MINIMAL'); expect(thinkingLevelFor('max')).toBe('HIGH'); expect(thinkingLevelFor('weird')).toBe('MINIMAL'); });

  describe('the call', () => {
    const ok = res({ candidates: [{ content: { role: 'model', parts: [{ text: 'fine' }] }, finishReason: 'STOP' }] });
    const fake = (...steps: (GenerateContentResponse | Error)[]) => { const calls: Record<string, unknown>[] = []; const client: GenAiLike = { models: { generateContent: async (p) => { calls.push(p); const s = steps.shift(); if (!s) throw new Error('exhausted'); if (s instanceof Error) throw s; return s; } } }; return { client, calls }; };

    it('sends the system prompt, tools, thinking level and output limit', async () => {
      const { client, calls } = fake(ok);
      expect((await geminiModel(client)(request())).text).toBe('fine');
      expect(calls[0]).toMatchObject({ model: config.zeon.model, config: { systemInstruction: 'SYS', thinkingConfig: thinkingFor(config.zeon.model, config.zeon.effort) } });
      expect(JSON.stringify(calls[0])).not.toContain(config.gemini.apiKey || 'no-key-set');
    });

    it('falls back to another model when the first is overloaded, but not once tools have run', async () => {
      const a = fake(apiError(503), ok);
      expect((await geminiModel(a.client)(request())).text).toBe('fine'); expect(a.calls.map((c) => c.model)).toEqual([config.zeon.model, config.zeon.fallbackModels[0]]);
      const b = fake(apiError(504), ok); // mid-lookup there is only one model to use, so it is retried once instead
      const mid = request([{ role: 'user', text: 'q' }, { role: 'model', text: '', raw: {} }, { role: 'tool', results: [] }]);
      expect((await geminiModel(b.client)(mid)).text).toBe('fine'); expect(b.calls.map((c) => c.model)).toEqual([config.zeon.model, config.zeon.model]);
      const c = fake(apiError(504), apiError(504));
      await expect(geminiModel(c.client)(mid)).rejects.toMatchObject({ status: 504 }); expect(c.calls).toHaveLength(2);
    });

    it('skips a model that is not available to the key (404) and tries the next', async () => {
      const m = fake(apiError(404, 'no longer available to new users'), ok);
      expect((await geminiModel(m.client)(request())).text).toBe('fine'); expect(m.calls.map((c) => c.model)).toEqual([config.zeon.model, config.zeon.fallbackModels[0]]);
    });

    it('retries without a thinking level when the model rejects it, and does not retry real errors', async () => {
      const t = fake(apiError(400, 'Thinking level is not supported'), ok);
      await geminiModel(t.client)(request()); expect(t.calls[1].config).not.toHaveProperty('thinkingConfig');
      const bad = fake(apiError(401), ok);
      await expect(geminiModel(bad.client)(request())).rejects.toMatchObject({ status: 401 }); expect(bad.calls).toHaveLength(1);
    });
  });

  it('turns failures into calm messages that never include details', () => {
    expect(friendlyError(apiError(429))).toMatch(/busy/);
    expect(friendlyError(apiError(403, 'key AIza-secret'))).toMatch(/access key is not accepted/); expect(friendlyError(apiError(403, 'key AIza-secret'))).not.toContain('secret');
    expect(friendlyError(apiError(400, 'API key not valid'))).toMatch(/access key/);
    expect(friendlyError(apiError(504))).toMatch(/too long/);
    expect(friendlyError(new Error('request timed out'))).toMatch(/too long/);
    expect(friendlyError(new Error('boom'))).toMatch(/not available/);
  });
});
