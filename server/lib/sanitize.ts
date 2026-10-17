// Allowlist HTML sanitizer for the complaint conclusion rich text (tiptap output).
//
// - Allowed tags: p br strong b em i u s ul ol li h3 h4 blockquote code pre (h1/h2 -> h3, h5/h6 -> h4).
// - Every attribute is stripped (no class/style/href/on* survives).
// - script/style (and other active/embedded containers) are removed together with their content.
// - Any other tag is dropped but its text content is kept. Comments, doctypes and processing instructions are removed.
// - Entities are preserved (`&amp;`, `&#8211;`, `&nbsp;` ...); a bare `&`, `<` or `>` in text is escaped.
// - Output is well-formed: unmatched closing tags are dropped and unclosed tags are closed at the end.
// Dependency-free, single pass, deterministic.

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'code', 'pre']);
const RENAME: Record<string, string> = { h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4' };
const VOID = new Set(['br']);
/** Removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title', 'head',
  'svg', 'math', 'select', 'xmp', 'noembed', 'noframes', 'frameset', 'applet', 'canvas', 'video', 'audio',
]);
const ENTITY_RE = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
const TAG_START_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/;

/** Index of the `>` that ends the tag starting at `from` (quote-aware), or -1. */
function findTagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

export function sanitizeHtml(html: string): string {
  const s = String(html ?? '');
  const n = s.length;
  let out = '';
  const stack: string[] = [];
  let i = 0;

  while (i < n) {
    const c = s[i];
    if (c === '<') {
      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (s[i + 1] === '!' || s[i + 1] === '?') {
        const end = s.indexOf('>', i + 2);
        i = end < 0 ? n : end + 1;
        continue;
      }
      const m = TAG_START_RE.exec(s.slice(i, i + 64));
      if (!m) {
        out += '&lt;';
        i++;
        continue;
      }
      const closing = m[1] === '/';
      const rawName = m[2].toLowerCase();
      const end = findTagEnd(s, i + m[0].length);
      if (end < 0) break; // unterminated tag: drop the remainder (never emit a partial tag)
      const selfClosing = s[end - 1] === '/';
      i = end + 1;

      if (DROP_WITH_CONTENT.has(rawName)) {
        if (!closing && !selfClosing) {
          const close = new RegExp(`</${rawName}\\s*>`, 'i').exec(s.slice(i));
          i = close ? i + close.index + close[0].length : n;
        }
        continue;
      }
      const name = RENAME[rawName] ?? rawName;
      if (!ALLOWED.has(name)) continue; // drop the tag, keep its content
      if (VOID.has(name)) {
        if (!closing) out += `<${name}>`;
        continue;
      }
      if (!closing) {
        out += `<${name}>`;
        stack.push(name);
        continue;
      }
      const idx = stack.lastIndexOf(name);
      if (idx < 0) continue; // unmatched closing tag
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }
    if (c === '>') {
      out += '&gt;';
      i++;
      continue;
    }
    if (c === '&') {
      const m = ENTITY_RE.exec(s.slice(i, i + 40));
      if (m) {
        out += m[0];
        i += m[0].length;
      } else {
        out += '&amp;';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', deg: '°',
  times: '×', plusmn: '±', micro: 'µ', middot: '·', bull: '•', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  le: '≤', ge: '≥', minus: '−', rarr: '→', larr: '←', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (all, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return all;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return all;
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

const BLOCK_BREAK_RE = /<\s*(br)\s*\/?>|<\/\s*(p|li|h[1-6]|blockquote|pre|div|ul|ol|tr)\s*>/gi;

/** Plain text of an HTML fragment (sanitized first): block ends become line breaks, entities decoded, whitespace tidied. */
export function htmlToText(html: string): string {
  const clean = sanitizeHtml(html);
  const withBreaks = clean.replace(BLOCK_BREAK_RE, '\n').replace(/<li>/gi, '• ');
  const noTags = withBreaks.replace(/<[^>]*>/g, '');
  return decodeEntities(noTags)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
    .join('\n')
    .trim();
}
