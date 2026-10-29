import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileText, Loader2, Paperclip, Send, Upload, X } from 'lucide-react';
import { COMPLAINT_TYPES, COMPLAINT_TYPE_LABEL, type ComplaintType } from '@shared/params';
import { request, useGet, useMut } from '../lib/api';
import { fmtD } from '../lib/fmt';
import { Notice } from '../components/ui';
import { LotSearch } from '../components/portal/LotSearch';
import { PCard, PHead } from '../components/portal/ui';
import { TYPE_UI, typeTitle } from '../components/portal/complaintTypes';
import type { LotSearchHit } from '../components/portal/types';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf';
const bare = (s: string) => s.trim().replace(/^lot[\s-]*/i, '');
interface Done { id: string; no: string; lotNo: string; type: ComplaintType; withFile: boolean; fileSkipped: boolean }

/** Report a problem: lot → type of problem → what you noticed → optional photo or PDF. */
export default function PortalReport(): JSX.Element {
  const [sp] = useSearchParams();
  const initialLot = bare(sp.get('lot') ?? '');
  const initialType = (COMPLAINT_TYPES as readonly string[]).includes(sp.get('type') ?? '') ? (sp.get('type') as ComplaintType) : null;
  const [lotText, setLotText] = useState(initialLot ? `Lot ${initialLot}` : '');
  const [lot, setLot] = useState<LotSearchHit | null>(null);
  const [type, setType] = useState<ComplaintType | null>(initialType);
  const [desc, setDesc] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileIssue, setFileIssue] = useState('');
  const [uploadIssue, setUploadIssue] = useState('');
  const [skipFile, setSkipFile] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitMut = useMut<{ lotNo: string; type: ComplaintType; description: string; documentId: string | null }, { id: string; complaint_no: string }>('POST', '/api/portal/complaints', 'Report a problem');

  // ?lot=101 → resolve the lot among the customer's own deliveries
  const pre = useGet<LotSearchHit[]>(initialLot ? `/api/portal/lot-search?q=${encodeURIComponent(initialLot)}` : null);
  const exact = pre.data?.find((h) => h.lotNo === initialLot);
  useEffect(() => { if (exact && !lot) { setLot(exact); setLotText(`Lot ${exact.lotNo}`); } }, [exact]); // eslint-disable-line react-hooks/exhaustive-deps
  const prefillMiss = !!initialLot && !!pre.data && !exact && !lot;

  const thumb = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb); }, [thumb]);

  const chooseFile = (f: File | undefined) => {
    setFileIssue(''); setUploadIssue(''); setSkipFile(false);
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) { setFileIssue('Please choose a photo (PNG, JPG, WebP, GIF) or a PDF.'); return; }
    if (f.size > MAX_BYTES) { setFileIssue('That file is bigger than 8 MB. Please choose a smaller photo or PDF.'); return; }
    setFile(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); chooseFile(e.dataTransfer.files?.[0]); };

  const lotNo = lot?.lotNo ?? bare(lotText);
  const missing = [!lotNo && 'the lot number', !type && 'the kind of problem', desc.trim().length < 10 && 'a short description (at least 10 characters)'].filter(Boolean) as string[];

  const submit = async () => {
    if (missing.length || !type) return;
    setBusy(true); setError('');
    let documentId: string | null = null;
    try {
      if (file && !skipFile) {
        try { const form = new FormData(); form.append('file', file); documentId = (await request<{ id: string }>('POST', '/api/documents', form)).data.id; }
        catch (e) { setUploadIssue(e instanceof Error ? e.message : 'The file could not be uploaded.'); return; }
      }
      const row = await submitMut.mutateAsync({ lotNo, type, description: desc.trim(), documentId });
      setDone({ id: row.id, no: row.complaint_no, lotNo, type, withFile: !!documentId, fileSkipped: !!file && skipFile });
    } catch (e) { setError(e instanceof Error ? e.message : 'Your report could not be sent. Please try again.'); }
    finally { setBusy(false); }
  };
  const reset = () => { setDone(null); setLot(null); setLotText(''); setType(null); setDesc(''); setFile(null); setSkipFile(false); setUploadIssue(''); setError(''); };

  if (done) return <div className="pt-page" data-testid="portal-report-done">
    <PCard><div className="pt-confirm stack" style={{ alignItems: 'center', gap: 14 }}>
      <span className="big"><CheckCircle2 size={38} /></span>
      <h1 className="pt-h1">Thank you — we have received your report</h1>
      <div className="pt-lead" style={{ margin: 0 }}>Your complaint number is</div>
      <div className="no" data-testid="report-complaint-no">{done.no}</div>
      <div className="muted">Lot {done.lotNo} · {typeTitle(done.type)}{done.withFile ? ' · photo/PDF attached' : ''}</div>
      {done.fileSkipped ? <Notice tone="warn">Your report was sent without the attachment. You can reply to your contact at the mill with the photo.</Notice> : null}
      <div className="pt-next">
        <div><b>1. Received</b>It is now written on the mill's ledger, so it cannot be lost or changed.</div>
        <div><b>2. Investigation</b>Our quality team compares the lot's test results and machine records.</div>
        <div><b>3. Our answer</b>You will see what we found, and our reply, right here when we close it.</div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        <Link to={`/portal/complaints/${done.id}`} className="btn primary lg" data-testid="report-track">Track this complaint</Link>
        <button className="btn lg" onClick={reset}>Report another problem</button>
      </div>
    </div></PCard>
  </div>;

  return <div className="pt-page" data-testid="portal-report">
    <PHead eyebrow="We are here to help" title="Report a problem" lead="Tell us which lot, what kind of problem and what you noticed. Our quality team starts investigating as soon as we receive it." />

    <PCard title={<><span className="pt-step-no">1</span> Which lot is it about?</>} lead="Type the lot number printed on your carton label or invoice, and choose it from the list.">
      <LotSearch value={lotText} onChange={(v) => { setLotText(v); if (lot && v !== `Lot ${lot.lotNo}`) setLot(null); }} onPick={(h) => { setLot(h); setLotText(`Lot ${h.lotNo}`); }} testId="report-lot" placeholder="Type your lot number, e.g. 104" />
      {lot ? <div className="pt-picked" data-testid="report-lot-picked"><CheckCircle2 size={22} /><div className="grow"><b>Lot {lot.lotNo}</b> · {lot.countDisplay}<div style={{ fontSize: 14.5 }}>Sent to you on {fmtD(lot.dispatchedAt)} (dispatch {lot.dispatchNo})</div></div></div> : null}
      {prefillMiss ? <Notice tone="warn">We could not find lot {initialLot} among your deliveries. Please check the number, or type another one above.</Notice> : null}
    </PCard>

    <PCard title={<><span className="pt-step-no">2</span> What kind of problem is it?</>} lead="Pick the one that fits best. If you are not sure, choose “Other” and describe it below.">
      <div className="pt-types" role="group" aria-label="Kind of problem">
        {COMPLAINT_TYPES.map((t) => { const u = TYPE_UI[t]; return <button type="button" key={t} className="pt-type" aria-pressed={type === t} onClick={() => setType(t)} data-testid={`report-type-${t}`} title={COMPLAINT_TYPE_LABEL[t]}>
          <span className="ico"><u.Icon size={22} /></span><span className="grow"><b>{u.title}</b><small>{u.hint}</small></span><CheckCircle2 className="tick" size={22} />
        </button>; })}
      </div>
    </PCard>

    <PCard title={<><span className="pt-step-no">3</span> Tell us what you noticed</>} lead="For example: how many cones or rolls are affected, where you saw it (knitting, dyeing, testing), and when it started.">
      <div className="field"><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe the problem in your own words…" data-testid="report-description" aria-label="Description of the problem" maxLength={2000} />
        <span className="hint">{desc.trim().length < 10 ? `A few more words please — at least 10 characters (${desc.trim().length} so far).` : `${desc.trim().length} characters — thank you, that helps.`}</span></div>
    </PCard>

    <PCard title={<><span className="pt-step-no">4</span> Add a photo or PDF <span className="muted" style={{ fontWeight: 500, fontSize: 16 }}>(optional)</span></>} lead="A picture of the fabric, cone or label makes the investigation faster. Photos (PNG, JPG, WebP) or PDF, up to 8 MB.">
      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="report-file" />
      {file ? <div className="pt-attach">{thumb ? <img src={thumb} alt="Preview of your photo" className="pt-thumb" /> : <span className="pt-drop" style={{ padding: 0, border: 0, background: 'none', cursor: 'default' }}><span className="ico"><FileText size={24} /></span></span>}
        <div className="grow"><b><Paperclip size={15} style={{ verticalAlign: -2 }} /> {file.name}</b><div className="muted small">{(file.size / 1024).toLocaleString('en-IN', { maximumFractionDigits: 0 })} KB — will be sent with your report</div></div>
        <button type="button" className="btn" onClick={() => { setFile(null); setUploadIssue(''); setSkipFile(false); }}><X size={16} /> Remove</button></div>
        : <div className={`pt-drop ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <span className="ico"><Upload size={24} /></span><div className="grow"><b>Choose a photo or PDF</b><div className="muted">or drag it here</div></div><span className="btn">Browse files</span></div>}
      {fileIssue ? <Notice tone="bad">{fileIssue}</Notice> : null}
      {uploadIssue ? <Notice tone="warn"><div>We could not attach your file ({uploadIssue}). You can send your report without it, or try again.</div><div className="row" style={{ marginTop: 8 }}><button type="button" className="btn sm" onClick={() => { setSkipFile(true); setUploadIssue(''); }}>Send without the file</button></div></Notice> : null}
      {skipFile ? <Notice tone="info">Your report will be sent without the attachment.</Notice> : null}
    </PCard>

    {error ? <Notice tone="bad"><b>We could not send your report.</b> {error}</Notice> : null}
    <div className="row" style={{ gap: 16 }}>
      <button className="btn primary lg" onClick={() => void submit()} disabled={busy || missing.length > 0} data-testid="report-submit">{busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />} {busy ? 'Sending…' : 'Send my report'}</button>
      {missing.length ? <span className="muted">Still needed: {missing.join(', ')}.</span> : <span className="muted">Your report goes straight to our quality team.</span>}
    </div>
  </div>;
}
