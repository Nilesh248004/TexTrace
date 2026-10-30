import { describe, expect, it } from 'vitest';
import { draftConclusion, isBlank, sameDraft, sentence, toHtml, type DraftInput } from '../../client/src/lib/conclusionDraft';

const complaint = { complaintNo: '21/2026', customerName: 'PD Textiles', typeLabel: 'Hairiness', lotNo: '101' };
const full: DraftInput = {
  complaint,
  result: {
    summary: { headline: 'RF 6 ran outside its master' },
    rootCauses: [
      { title: 'RF 6 (ring frame): spindle speed and traveller age outside the master', explanation: 'Spindle speed 19,800 rpm vs master 18,200; traveller 29 days old vs 14.', confidence: 72, machineId: 'RF-6' },
      { title: 'Short-fibre index of mix M-001', explanation: 'SFI 9.4% vs 8.0% limit.', confidence: 41, machineId: null },
    ],
    ruledOut: ['Other ring frames within limits.', 'Packing colour correct'],
    recallScope: { lots: [{ lotNo: '102' }, { lotNo: '110' }, { lotNo: '111' }], customers: [{ name: 'PD Textiles' }, { name: 'Ganga Garments' }] },
    actions: { corrective: [{ text: 'Replace the traveller on RF 6 now' }, { text: 'Hold unshipped stock of lots 102, 110 and 111.' }], preventive: [{ text: 'Raise a traveller-age alert at 80% of life' }] },
  },
};

describe('draftConclusion', () => {
  const d = draftConclusion(full);

  it('fills every field the QA head has to sign, from the analysis only', () => {
    for (const v of Object.values(d)) expect(v.trim().length).toBeGreaterThan(20);
    expect(d.rootCause).toBe(full.result.rootCauses[0].title);
    expect(d.correctiveAction).toBe('Replace the traveller on RF 6 now. Hold unshipped stock of lots 102, 110 and 111.');
    expect(d.preventiveAction).toBe('Raise a traveller-age alert at 80% of life.');
    expect(d.conclusion).toContain('72% confidence');
    expect(d.conclusion).toContain('most likely');
    expect(d.conclusion).toContain('Lots in the same scope: 102, 110 and 111 (customers: PD Textiles and Ganga Garments)');
    expect(d.conclusion).toContain('ruled out: Other ring frames within limits; Packing colour correct');
    expect(d.conclusion.split('\n\n').length).toBeGreaterThanOrEqual(3); // readable paragraphs, not one block
  });

  it('writes a customer reply that names the customer, lot and complaint and promises nothing the analysis does not support', () => {
    expect(d.customerReply.startsWith('Dear PD Textiles,\n\n')).toBe(true);
    expect(d.customerReply).toContain('hairiness on lot 101 (complaint 21/2026)');
    expect(d.customerReply).toContain('found RF 6 (ring frame): spindle speed'); // keeps machine IDs, lowercases ordinary words only
    expect(d.customerReply).toContain('What we are doing: Replace the traveller on RF 6 now.');
    expect(d.customerReply).toContain('To prevent a repeat: Raise a traveller-age alert at 80% of life.');
    expect(d.customerReply).not.toMatch(/credit|refund|replacement|free of charge/i);
    expect(JSON.stringify(d)).not.toMatch(/undefined|null|NaN/);
  });

  it('says "possibly" when confidence is low', () => {
    const low = draftConclusion({ ...full, result: { ...full.result, rootCauses: [{ ...full.result.rootCauses[0], confidence: 41 }] } });
    expect(low.conclusion).toContain('possibly');
  });

  it('collapses a repeated "ruled out" phrase into one sentence', () => {
    const rep = draftConclusion({ ...full, result: { ...full.result, ruledOut: ['Tenacity (RKM) is within master and in line with the reference lots.', 'Twist (TPI) is within master and in line with the reference lots.'] } });
    expect(rep.conclusion).toContain('Checked and ruled out (within master and in line with the reference lots): Tenacity (RKM), Twist (TPI).');
    expect(rep.conclusion.match(/in line with the reference lots/g)).toHaveLength(1);
  });

  it('handles an analysis with nothing outside the master', () => {
    const none = draftConclusion({ complaint, result: { summary: { headline: 'Everything within master' }, rootCauses: [], recallScope: { lots: [], customers: [] }, actions: { corrective: [], preventive: [] } } });
    expect(none.rootCause).toContain('No parameter outside the master');
    expect(none.correctiveAction).toContain('Ask the customer for samples');
    expect(none.customerReply).toContain('within limits');
    expect(none.customerReply).toContain('send us a sample');
    expect(JSON.stringify(none)).not.toMatch(/undefined|null|NaN/);
  });
});

describe('helpers', () => {
  it('sentence() trims, single-spaces and adds a full stop once', () => {
    expect(sentence('  Fix   it ')).toBe('Fix it.');
    expect(sentence('Already done.')).toBe('Already done.');
    expect(sentence('  ')).toBe('');
  });
  it('isBlank / sameDraft tell untouched forms from edited ones', () => {
    const d = draftConclusion(full);
    expect(isBlank({ rootCause: '', correctiveAction: ' ', preventiveAction: '', conclusion: '', customerReply: '' })).toBe(true);
    expect(isBlank(d)).toBe(false);
    expect(sameDraft(d, { ...d })).toBe(true);
    expect(sameDraft(d, { ...d, rootCause: 'edited' })).toBe(false);
  });
  it('toHtml escapes markup and keeps paragraphs', () => {
    expect(toHtml('A < B & C\n\nSecond paragraph')).toBe('<p>A &lt; B &amp; C</p><p>Second paragraph</p>');
    expect(toHtml('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });
});
