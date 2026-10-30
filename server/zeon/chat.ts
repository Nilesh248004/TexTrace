// One Zeon turn: the model answers, may call tools (read-only lookups for this person's role), and we loop until it has a final reply.
// The model call itself is injected (`ModelCall`, see model.ts) so the whole loop can be tested without a network or an API key.
import { config } from '../config';
import { ROLE_LABEL, type Role } from '@shared/permissions';
import type { ZeonAction, ZeonContext, ZeonMessage } from '@shared/zeon';
import { dynamicSystem, stableSystem } from './knowledge';
import type { ModelCall, Turn } from './model';
import { runTool, toolsFor } from './tools';

export interface ZeonTurn {
  user: { name: string; role: Role; customerName?: string | null };
  messages: ZeonMessage[];
  context: ZeonContext;
  base: string; // loopback URL of this server, so lookups run through the normal API (and its role checks)
  auth: string; // the person's own Authorization header
  nowIso: string;
}

export async function runZeon(turn: ZeonTurn, model: ModelCall): Promise<{ reply: string; actions: ZeonAction[] }> {
  const actions: ZeonAction[] = [];
  const { role } = turn.user;
  const tools = toolsFor(role).map(({ name, description, input_schema }) => ({ name, description, parameters: input_schema as Record<string, unknown> }));
  const system = `${stableSystem(role)}\n\n${dynamicSystem(turn.user, turn.context, turn.nowIso)}`;
  const turns: Turn[] = turn.messages.map((m): Turn => (m.role === 'user' ? { role: 'user', text: m.content } : { role: 'model', text: m.content }));
  const ctx = { role, base: turn.base, auth: turn.auth, actions };

  for (let step = 0; step < config.zeon.maxSteps; step++) {
    const reply = await model({ system, tools, turns: turns.slice() }); // a snapshot: each call sees exactly the conversation so far
    if (reply.outcome === 'blocked') return { reply: 'I can\'t help with that one. I can help with TexTrace: lots, runs, tests, complaints, dispatches and how to use the screens.', actions };
    if (reply.outcome !== 'tool_calls') {
      if (reply.text) return { reply: reply.text.slice(0, 4000), actions };
      return { reply: reply.outcome === 'too_long' ? 'That answer got too long for me to finish. Could you ask it in a narrower way?' : 'I did not manage to put an answer together. Could you rephrase that?', actions };
    }
    // keep the model's turn exactly as returned, then answer every tool call together
    turns.push({ role: 'model', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
    const results = await Promise.all(reply.toolCalls.map(async (c) => {
      const out = await runTool(role, c.name, c.args, ctx);
      return { id: c.id, name: c.name, output: out.text, isError: out.isError };
    }));
    turns.push({ role: 'tool', results });
  }
  return { reply: `I couldn't finish that lookup in a few steps (I was speaking as ${ROLE_LABEL[role]}). Could you ask it more narrowly, for example about one lot or one complaint?`, actions };
}
