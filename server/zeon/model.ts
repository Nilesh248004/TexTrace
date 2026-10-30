// What Zeon needs from "the AI model", independent of which company provides it. The conversation loop (chat.ts) only speaks this
// vocabulary; gemini.ts translates it to and from the Gemini API. Tests plug in a scripted ModelCall instead.

export interface ModelTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ToolOutput { id: string; name: string; output: string; isError: boolean }

export type Turn =
  | { role: 'user'; text: string }
  /** `raw` is the provider's own copy of this turn, replayed untouched on the next call (some providers require that during tool use). */
  | { role: 'model'; text: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolOutput[] };

export interface ModelRequest { system: string; tools: ModelTool[]; turns: Turn[] }

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  /** answer = finished; tool_calls = wants lookups; blocked = declined for safety; too_long = ran out of room; empty = nothing usable */
  outcome: 'answer' | 'tool_calls' | 'blocked' | 'too_long' | 'empty';
  raw?: unknown;
}

export type ModelCall = (request: ModelRequest) => Promise<ModelReply>;
