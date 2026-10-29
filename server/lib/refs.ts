// Lookup tokens ("LOT-101 MIX-001 RF-6 …") stored with each audit-log row so the Developer Console can filter by lot,
// machine, bale, mix, complaint or dispatch without scanning the whole trace JSON.
const TOKEN = /\b(LOT-\d+|MIX-\d+|BALE-\d+|(?:BR|CARD|DFB|DFF|COMB|FF|RF|AW)-\d+|CMP-\d+-\d{4}|DSP-\d{4}-\d{4}|MV-[A-Z0-9]+-[A-Z_]+-\d+|ORD-\d{4}-\d+)\b/g;

export function extractRefs(...parts: unknown[]): string {
  const found = new Set<string>();
  for (const part of parts) {
    const text = typeof part === 'string' ? part : JSON.stringify(part ?? '');
    for (const m of text.matchAll(TOKEN)) found.add(m[1]);
    for (const m of text.matchAll(/\blot (\d{3})\b/gi)) found.add(`LOT-${m[1]}`);
  }
  return [...found].join(' ');
}
