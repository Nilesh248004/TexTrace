// Zeon's voice: Gemini's text-to-speech reads the answer the way a person would, with a delivery that matches what is being said
// (reassuring for a refusal, upbeat for good news). Uses the same Gemini_API_KEY as the rest of Zeon.
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

export type SpeechCall = (text: string) => Promise<Buffer>; // a ready-to-play WAV file

/** How to say it, chosen from the content: the model is told the feeling, not just the words. */
export function deliveryFor(text: string): string {
  if (/\b(sorry|unable|couldn'?t|can'?t|cannot|not permitted|refused|failed|didn'?t work|not available|went wrong)\b/i.test(text)) return 'softly and reassuringly, like a kind colleague who is sorry it did not work out and is ready to help fix it';
  if (/\b(good news|all clear|looks good|passed|congrat|great|done|dispatched|closed|resolved|within (the )?limits?)\b/i.test(text)) return 'warmly and cheerfully, with a smile in the voice';
  if (/\b(urgent|breach|outside (the )?limits?|alert|attention|overdue|risk)\b/i.test(text)) return 'calmly but with clear concern, a little more serious and steady';
  if (/\?\s*$/.test(text.trim())) return 'curiously and invitingly, like asking a friend a question';
  return 'in a natural, friendly, conversational way, like a helpful colleague chatting, with relaxed pacing, natural pauses and a little expression';
}

/** Gemini returns raw 16-bit mono PCM; browsers need it wrapped as a WAV file. */
export function wavFromPcm(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface TtsClient { models: { generateContent: (p: Record<string, unknown>) => Promise<{ candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] }> } }

export function geminiSpeech(client: TtsClient = new GoogleGenAI({ apiKey: config.gemini.apiKey, httpOptions: { timeout: config.zeon.timeoutMs, retryOptions: { attempts: 1 } } }) as unknown as TtsClient): SpeechCall {
  return async (text) => {
    const response = await client.models.generateContent({
      model: config.zeon.ttsModel,
      contents: [{ role: 'user', parts: [{ text: `Say this ${deliveryFor(text)}: ${text}` }] }],
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.zeon.ttsVoice } } } },
    });
    const inline = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new Error('no audio returned');
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1]) || 24000;
    return wavFromPcm(Buffer.from(inline.data, 'base64'), rate);
  };
}
