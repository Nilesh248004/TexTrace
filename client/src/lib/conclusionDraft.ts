// Turns a finished AI analysis into a ready-to-review QA conclusion. Nothing here is invented: every sentence is built from the
// analysis result (ranked causes, ruled-out checks, recall scope, corrective / preventive actions) and the complaint itself.
// The QA head reads it, edits whatever needs editing, and signs.

export interface DraftInput {
  complaint: { complaintNo: string; customerName: string; typeLabel: string; lotNo: string };
  result: {
    summary?: { headline?: string };
    rootCauses: { title: string; explanation: string; confidence: number; machineId?: string | null }[];
    ruledOut?: string[];
    recallScope: { lots: { lotNo: string }[]; customers: { name: string }[]; totalKgAtRisk?: number };
    actions: { corrective: { text: string }[]; preventive: { text: string }[] };
  };
}

export interface ConclusionDraft { rootCause: string; correctiveAction: string; preventiveAction: string; conclusion: string; customerReply: string }

/** One clean sentence: trimmed, single-spaced, ending in a full stop. */
export const sentence = (t: string): string => {
  const s = t.replace(/\s+/g, ' ').trim();
  return !s ? '' : /[.!?]$/.test(s) ? s : `${s}.`;
};
const joinSentences = (items: string[]): string => items.map(sentence).filter(Boolean).join(' ');
/** Starts a sentence mid-way ("found cotton mix…") without breaking IDs and acronyms ("RF 6", "M-006"). */
const lowerFirst = (t: string): string => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const strip = (t: string): string => t.replace(/[.\s]+$/, '');
const RULED_OUT_SUFFIX = / is within master and in line with the reference lots\.?$/;
/** "A is within master and in line…; B is within master and in line…" → one sentence instead of a repeated phrase. */
function ruledOutSentence(items: string[]): string {
  const top = items.slice(0, 3);
  if (!top.length) return '';
  if (top.every((r) => RULED_OUT_SUFFIX.test(r))) return sentence(`Checked and ruled out (within master and in line with the reference lots): ${top.map((r) => r.replace(RULED_OUT_SUFFIX, '')).join(', ')}`);
  return sentence(`Checked and ruled out: ${top.map(strip).join('; ')}`);
}
const list = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function draftConclusion({ complaint, result }: DraftInput): ConclusionDraft {
  const top = result.rootCauses[0] ?? null;
  const confidence = top ? Math.round(top.confidence) : 0;
  const certainty = !top ? '' : confidence >= 60 ? 'most likely' : 'possibly';
  const corrective = result.actions.corrective.map((a) => a.text);
  const preventive = result.actions.preventive.map((a) => a.text);
  const lots = result.recallScope.lots.map((l) => l.lotNo);
  const customers = result.recallScope.customers.map((c) => c.name);
  const issue = complaint.typeLabel.toLowerCase();

  const rootCause = top
    ? top.title
    : `No parameter outside the master was found for lot ${complaint.lotNo}; the records do not point to a mill-side cause`;

  const correctiveAction = corrective.length
    ? joinSentences(corrective)
    : 'No corrective action is required from the mill records. Ask the customer for samples of the affected cones or fabric and test them against the master.';

  const preventiveAction = preventive.length
    ? joinSentences(preventive)
    : 'Keep monitoring this lens at the next QA review; no new control is needed from this investigation.';

  const conclusion = [
    joinSentences([
      `Complaint ${complaint.complaintNo} (${complaint.typeLabel}) on lot ${complaint.lotNo} was investigated by comparing the lot with the master and with recent good lots`,
      top ? `The cause is ${certainty} ${top.title} (${confidence}% confidence)` : result.summary?.headline || 'Every reading checked was within its master',
    ]),
    top ? sentence(top.explanation) : '',
    ruledOutSentence(result.ruledOut ?? []),
    lots.length ? sentence(`Lots in the same scope: ${list(lots)}${customers.length ? ` (customers: ${list(customers)})` : ''}`) : '',
  ].filter(Boolean).join('\n\n');

  const customerReply = [
    `Dear ${complaint.customerName},`,
    joinSentences([
      `Thank you for reporting ${issue} on lot ${complaint.lotNo} (complaint ${complaint.complaintNo})`,
      top ? `We compared the lot with our masters and with recent good lots, and found ${lowerFirst(strip(top.title))}` : 'We compared the lot with our masters and with recent good lots and found every recorded reading within limits',
    ]),
    [
      corrective.length ? sentence(`What we are doing: ${strip(corrective[0])}`) : 'Please send us a sample of the affected cones or fabric so we can test it against the master.',
      preventive.length ? sentence(`To prevent a repeat: ${strip(preventive[0])}`) : '',
    ].filter(Boolean).join(' '),
    'Please contact us if any other cones from this lot show the same problem.',
  ].join('\n\n');

  return { rootCause, correctiveAction, preventiveAction, conclusion, customerReply };
}

/** True when the user has not typed anything yet (so a draft may be applied without overwriting their words). */
export const isBlank = (f: ConclusionDraft): boolean => Object.values(f).every((v) => !v.trim());
export const sameDraft = (a: ConclusionDraft, b: ConclusionDraft): boolean => (Object.keys(a) as (keyof ConclusionDraft)[]).every((k) => a[k] === b[k]);
/** Plain text from the form → paragraphs of escaped HTML (the server sanitises again). */
export const toHtml = (text: string): string =>
  text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('');
