// Zeon's spoken voice: the delivery chosen for the content, the WAV wrapping, and the /api/zeon/speak endpoint.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openDb, type DB } from '../../server/db';
import { SimulatedLedger } from '../../server/ledger/simulated';
import { seedDatabase } from '../../server/seed/loader';
import { createApp } from '../../server/app';
import { createRuntime } from '../../server/contracts/runtime';
import { initClock } from '../../server/lib/clock';
import { config } from '../../server/config';
import { deliveryFor, geminiSpeech, wavFromPcm } from '../../server/zeon/speech';

describe('Zeon speech', () => {
  it('picks a delivery that matches what is being said', () => {
    expect(deliveryFor('Sorry, I couldn\'t find that lot.')).toMatch(/reassuring/);
    expect(deliveryFor('Good news: lot 101 passed every test.')).toMatch(/cheerful/);
    expect(deliveryFor('Two readings are outside the limits, so please check.')).toMatch(/concern/);
    expect(deliveryFor('Which lot do you mean?')).toMatch(/curious/);
    expect(deliveryFor('Lot 101 is a 40s CH lot made on line 3.')).toMatch(/conversational/);
  });

  it('wraps raw audio as a playable WAV', () => {
    const wav = wavFromPcm(Buffer.alloc(480), 24000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000); expect(wav.readUInt32LE(40)).toBe(480); expect(wav.length).toBe(524);
  });

  it('asks Gemini for audio in the configured voice, with the delivery in the instruction', async () => {
    const calls: Record<string, unknown>[] = [];
    const say = geminiSpeech({ models: { generateContent: async (p) => { calls.push(p); return { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(100).toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }; } } });
    const wav = await say('Sorry, that failed.');
    expect(wav.length).toBe(144);
    expect(calls[0]).toMatchObject({ model: config.zeon.ttsModel, config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.zeon.ttsVoice } } } } });
    expect(JSON.stringify(calls[0].contents)).toMatch(/reassuring.*Sorry, that failed\./);
    await expect(geminiSpeech({ models: { generateContent: async () => ({ candidates: [] }) } })('x')).rejects.toThrow(/no audio/);
  });

  describe('the endpoint', () => {
    let db: DB; let app: Express; let token = ''; let bare: Express;
    beforeAll(async () => {
      db = openDb(':memory:'); const ledger = new SimulatedLedger(db); await ledger.init(); await seedDatabase(db, ledger); await initClock(db);
      app = createApp(db, ledger, createRuntime(db, ledger), { zeonSpeech: async (t) => Buffer.from(`wav:${t}`) });
      bare = createApp(db, ledger, createRuntime(db, ledger));
      token = (await request(app).post('/api/auth/login').send({ username: 'qa' }).expect(200)).body.data.token as string;
    }, 120_000);
    afterAll(async () => { await db?.close(); });
    it('needs a sign-in and some text, and returns the audio', async () => {
      await request(app).post('/api/zeon/speak').send({ text: 'hi' }).expect(401);
      expect((await request(app).post('/api/zeon/speak').set('Authorization', `Bearer ${token}`).send({ text: '  ' })).status).toBe(422);
      const r = await request(app).post('/api/zeon/speak').set('Authorization', `Bearer ${token}`).send({ text: 'Hello there' }).expect(200);
      expect(r.body.data).toMatchObject({ configured: true, mime: 'audio/wav' }); expect(Buffer.from(r.body.data.audio, 'base64').toString()).toBe('wav:Hello there');
    });
    it('tells the browser to use its own voice when there is no key', async () => {
      if (config.gemini.enabled) return;
      const r = await request(bare).post('/api/zeon/speak').set('Authorization', `Bearer ${token}`).send({ text: 'Hello' }).expect(200);
      expect(r.body.data).toEqual({ configured: false });
    });
  });
});
