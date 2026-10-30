// Small pure helpers behind the Zeon widget (kept apart from the component so they can be tested).
import type { Role } from '@shared/permissions';

/** The lot number on screen, from either the staff or the portal URL: /lots/LOT-101 or /portal/lots/101. */
export function lotFromRoute(route: string): string | null {
  const m = /^\/(?:portal\/)?lots\/(?:LOT-)?(\d{1,6})(?:[/?#]|$)/i.exec(route);
  return m ? m[1] : null;
}

/** The complaint on screen: /complaints/CMP-21-2026 or /portal/complaints/CMP-21-2026 → "21/2026". */
export function complaintFromRoute(route: string): string | null {
  const m = /^\/(?:portal\/)?complaints\/CMP-(\d{1,4})-(\d{4})(?:[/?#]|$)/i.exec(route);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Starter questions that fit who is asking and what they are looking at. */
export function suggestionsFor(role: Role | null | undefined, route: string): string[] {
  const lot = lotFromRoute(route); const complaint = complaintFromRoute(route);
  if (role === 'BUYER') {
    return [
      lot ? `Is lot ${lot} within spec?` : 'Where is my latest shipment?',
      complaint ? `What is the status of complaint ${complaint}?` : 'Are my lots within spec?',
      'I want to report a problem with a lot',
    ];
  }
  const first = lot ? `Summarise lot ${lot}` : complaint ? `Explain complaint ${complaint}` : 'What needs attention today?';
  const second = route.startsWith('/complaints') ? 'How do I close a complaint?' : route.startsWith('/dispatch') ? 'Why can a dispatch be blocked?' : route.startsWith('/production') ? 'How do I log a production run?' : route.startsWith('/quality') ? 'How do I record a lab test?' : 'What do red, yellow and green mean?';
  return [first, second, 'What can my role do here?'];
}

/** What the reply sounds like when read aloud: no markdown marks, bullets as sentences. */
export function plainForSpeech(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[-•]\s+/gm, '').replace(/\s*\n+\s*/g, '. ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim();
}

export type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] };
/** Splits a reply into paragraphs and bullet lists (the only formatting Zeon uses). Rendering happens in React, never as raw HTML. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const chunk of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    const bullets = lines.filter((l) => /^\s*[-•]\s+/.test(l));
    if (bullets.length === lines.length) out.push({ kind: 'ul', items: lines.map((l) => l.replace(/^\s*[-•]\s+/, '')) });
    else out.push({ kind: 'p', lines });
  }
  return out;
}

/** "a **b** c" → ["a ", {bold:"b"}, " c"] */
export function inline(text: string): (string | { bold: string })[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? { bold: part.slice(2, -2) } : part));
}
