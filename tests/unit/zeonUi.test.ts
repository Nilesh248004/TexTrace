import { describe, expect, it } from 'vitest';
import { blocks, complaintFromRoute, inline, lotFromRoute, plainForSpeech, speechChunks, suggestionsFor } from '../../client/src/lib/zeonUi';

describe('Zeon interface helpers', () => {
  it('reads the lot and complaint on screen from staff and portal URLs', () => {
    expect(lotFromRoute('/lots/LOT-101')).toBe('101'); expect(lotFromRoute('/lots/101?x=1')).toBe('101'); expect(lotFromRoute('/portal/lots/114')).toBe('114');
    expect(lotFromRoute('/lots')).toBeNull(); expect(lotFromRoute('/dispatch/DSP-2026-0117')).toBeNull();
    expect(complaintFromRoute('/complaints/CMP-21-2026')).toBe('21/2026'); expect(complaintFromRoute('/portal/complaints/CMP-7-2026')).toBe('7/2026');
    expect(complaintFromRoute('/complaints/new')).toBeNull();
  });

  it('suggests questions that fit the role and the page', () => {
    expect(suggestionsFor('QA', '/')[0]).toBe('What needs attention today?');
    expect(suggestionsFor('QA', '/lots/LOT-101')[0]).toBe('Summarise lot 101');
    expect(suggestionsFor('QA', '/complaints/CMP-21-2026')).toEqual(['Explain complaint 21/2026', 'How do I close a complaint?', 'What can my role do here?']);
    expect(suggestionsFor('PRODUCTION', '/production')[1]).toBe('How do I log a production run?');
    const buyer = suggestionsFor('BUYER', '/portal');
    expect(buyer).toHaveLength(3); expect(buyer.join(' ')).not.toMatch(/attention today|my role/i); expect(buyer[2]).toBe('I want to report a problem with a lot');
    expect(suggestionsFor('BUYER', '/portal/lots/101')[0]).toBe('Is lot 101 within spec?');
  });

  it('turns a reply into spoken sentences without markdown', () => {
    expect(plainForSpeech('Lot **101** is out.\n\n- Left on 27 Oct\n- Vehicle TN-39')).toBe('Lot 101 is out. Left on 27 Oct. Vehicle TN-39');
  });

  it('splits a reply into paragraphs and bullet lists, and bold text, without any raw HTML', () => {
    expect(blocks('Intro **x**\n\n- a\n- b\n\nLast line\nsecond line')).toEqual([{ kind: 'p', lines: ['Intro **x**'] }, { kind: 'ul', items: ['a', 'b'] }, { kind: 'p', lines: ['Last line', 'second line'] }]);
    expect(inline('a **b** c')).toEqual(['a ', { bold: 'b' }, ' c']);
    expect(blocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'p', lines: ['<img src=x onerror=alert(1)>'] }]); // stays plain text: React escapes it on render
  });

  it('splits speech so the first piece is short and starts quickly', () => {
    const long = 'Lot 101 is a 40s CH lot. It was made on line 3 last week. Two readings were near the limit, so QA checked them again. Everything else looked normal, and the lot was dispatched to PD Textiles on Monday.';
    const parts = speechChunks(long);
    expect(parts[0].length).toBeLessThanOrEqual(110); expect(parts.length).toBeGreaterThan(1); expect(parts.join(' ')).toBe(long);
    expect(speechChunks('Hello there.')).toEqual(['Hello there.']); expect(speechChunks('')).toEqual([]);
    expect(speechChunks('No punctuation at all')).toEqual(['No punctuation at all']);
  });
});
