import { useEffect, useState } from 'react';
import { ExternalLink, FileText, ImageIcon, Paperclip } from 'lucide-react';
import { useSession } from '../../lib/store';

/** Attachments are served behind the bearer token, so images are fetched with the token and shown from a blob URL. */
export function useBlobUrl(path: string | null, enabled = true): { url: string | null; error: string | null; loading: boolean } {
  const token = useSession((s) => s.token);
  const [state, setState] = useState<{ url: string | null; error: string | null; loading: boolean }>({ url: null, error: null, loading: !!path });
  useEffect(() => {
    if (!path || !token || !enabled) { setState({ url: null, error: null, loading: false }); return; }
    let url: string | null = null; let live = true;
    setState({ url: null, error: null, loading: true });
    fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => { if (!r.ok) throw new Error(`Could not load the file (${r.status})`); const b = await r.blob(); url = URL.createObjectURL(b); if (live) setState({ url, error: null, loading: false }); })
      .catch((e: unknown) => { if (live) setState({ url: null, error: e instanceof Error ? e.message : 'Could not load the file', loading: false }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [path, token, enabled]);
  return state;
}

/** Open an authenticated file in a new tab (a blank tab is opened first so pop-up blockers allow it). */
export async function openAttachment(path: string): Promise<void> {
  const w = window.open('about:blank', '_blank');
  try {
    const token = useSession.getState().token;
    const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) throw new Error(`Could not open the file (${r.status})`);
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { if (w) w.close(); throw e; }
}

export function AttachmentCard({ doc }: { doc: { id: string; filename: string; mimeType: string; url: string } }): JSX.Element {
  const isImage = doc.mimeType.startsWith('image/');
  const blob = useBlobUrl(doc.url, isImage);
  const [err, setErr] = useState('');
  return <div className="pt-attach" data-testid="portal-attachment">
    {isImage && blob.url ? <img src={blob.url} alt={doc.filename} /> : <span className="pt-drop" style={{ padding: 0, border: 0, background: 'none', cursor: 'default' }}><span className="ico">{isImage ? <ImageIcon size={24} /> : <FileText size={24} />}</span></span>}
    <div className="grow"><b><Paperclip size={15} style={{ verticalAlign: -2 }} /> {doc.filename}</b><div className="muted small">{doc.mimeType === 'application/pdf' ? 'PDF document' : isImage ? 'Photo' : doc.mimeType} · safely stored and fingerprinted on the mill's ledger</div>{err ? <div className="small" style={{ color: 'hsl(var(--bad-foreground))' }}>{err}</div> : null}{blob.error ? <div className="small" style={{ color: 'hsl(var(--bad-foreground))' }}>{blob.error}</div> : null}</div>
    <button type="button" className="btn" onClick={() => void openAttachment(doc.url).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not open the file'))}><ExternalLink size={16} /> Open</button>
  </div>;
}
