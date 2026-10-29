import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Card, CardBody, PageHead } from '../components/ui';
import { useSession } from '../lib/store';

type PdfValidation = {
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
};

type ImportJob = {
  structured?: Record<string, unknown> | null;
  validation?: PdfValidation | null;
  modelName?: string | null;
  extractedAt?: string | null;

  id: string;
  fileName: string;
  sha256: string;
  pages: number;
  bytes: number;
  status: 'PREVIEW' | 'REVIEWED';
  uploadedAt: string;
  reviewedAt?: string | null;
  text?: string;
  lineCount?: number;
  headings?: string[];
  truncated?: boolean;
};

type ImportPreview = {
  jobId: string;
  fileName: string;
  generatedAt: string;
  dryRun: boolean;
  productionWrites: boolean;
  importActionAvailable: boolean;
  readiness: 'BLOCKED' | 'NEEDS_REVIEW' | 'READY_FOR_APPROVAL';
  summary: { recordCount: number; blockerCount: number; warningCount: number };
  categories: Array<{ key: string; label: string; total: number; ready: number; blocked: number; needsReview: number }>;
  issues: Array<{ level: 'BLOCKER' | 'WARNING'; category: string; sourceId: string; message: string }>;
  issuesTruncated: boolean;
  notes: string[];
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string; code?: string };
};

async function api<T>(
  url: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });
  const body = await response.json() as Envelope<T>;

  if (!response.ok || !body.ok || body.data === undefined) {
    throw new Error(body.error?.message || `Request failed (${response.status})`);
  }
  return body.data;
}

export default function PdfImport(): JSX.Element {
  const { token } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [current, setCurrent] = useState<ImportJob | null>(null);
  const [structuredDraft, setStructuredDraft] = useState('');
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const refreshJobs = useCallback(async () => {
    try {
      const rows = await api<ImportJob[]>('/api/pdf-import/jobs', token);
      setJobs(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load import history');
    }
  }, [token]);

  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  async function uploadPdf(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a PDF file first.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('The PDF must be 8 MB or smaller.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<ImportJob>(
        '/api/pdf-import/preview',
        token,
        { method: 'POST', body: form },
      );
      setCurrent(result);
      setNotice('PDF extracted and saved as a review draft. No production records have been changed.');
      setFile(null);
      const input = document.getElementById('pdf-import-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function openJob(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const job = await api<ImportJob>(`/api/pdf-import/jobs/${encodeURIComponent(id)}`, token);
      setCurrent(job);
      setStructuredDraft(job.structured ? JSON.stringify(job.structured, null, 2) : '');
      setImportPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open import');
    } finally {
      setBusy(false);
    }
  }

  async function extractStructured() {
    if (!current) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const job = await api<ImportJob>(
        `/api/pdf-import/${encodeURIComponent(current.id)}/extract`,
        token,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      setCurrent(job);
      setStructuredDraft(JSON.stringify(job.structured ?? {}, null, 2));
      setImportPreview(null);
      setNotice('Structured extraction completed. Review every field and validation warning before proceeding.');
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Structured extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveStructuredDraft() {
    if (!current) return;
    let structured: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(structuredDraft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The JSON root must be an object.');
      }
      structured = parsed as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const job = await api<ImportJob>(
        `/api/pdf-import/${encodeURIComponent(current.id)}/structure`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ structured }),
        },
      );
      setCurrent(job);
      setStructuredDraft(JSON.stringify(job.structured ?? {}, null, 2));
      setImportPreview(null);
      setNotice('Structured draft saved and revalidated. No production records were changed.');
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save structured draft');
    } finally {
      setBusy(false);
    }
  }

  async function markReviewed() {
    if (!current) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const job = await api<ImportJob>(
        `/api/pdf-import/${encodeURIComponent(current.id)}/review`,
        token,
        { method: 'POST' },
      );
      setCurrent(job);
      setNotice('Review status saved. Extracted data is still staged; business tables have not been changed.');
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save review status');
    } finally {
      setBusy(false);
    }
  }

  async function prepareImportPreview() {
    if (!current) return;
    setBusy(true);
    setError('');
    setNotice('');
    setImportPreview(null);
    try {
      const result = await api<ImportPreview>(
        `/api/pdf-import/${encodeURIComponent(current.id)}/import-preview`,
        token,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      setImportPreview(result);
      setNotice('Read-only import preview completed. No production records were changed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare import preview');
    } finally {
      setBusy(false);
    }
  }

  function downloadText() {
    if (!current?.text) return;
    const blob = new Blob([current.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.fileName.replace(/\.pdf$/i, '')}-extracted.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return <div className="page">
    <PageHead eyebrow="DATA MANAGEMENT" title="PDF Import" />
    <Card>
      <CardBody>
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>Upload historical factory records</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Upload a text-based PDF containing lot, bale, mix, production, packing,
              quality, order or dispatch information.
            </p>
          </div>
          <form onSubmit={uploadPdf} className="stack" style={{ gap: 12 }}>
            <label htmlFor="pdf-import-file"><b>Select PDF file</b></label>
            <input
              id="pdf-import-file"
              className="input"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {file && <div className="small muted">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>}
            <div>
              <button className="btn primary" type="submit" disabled={busy || !file}>
                {busy ? <Loader2 size={16} /> : <Upload size={16} />}
                {busy ? 'Processing…' : 'Upload and extract PDF'}
              </button>
            </div>
          </form>
        </div>
      </CardBody>
    </Card>

    {error && <Card><CardBody>
      <div className="row" style={{ gap: 8, color: 'hsl(var(--bad-foreground))' }}>
        <AlertCircle size={18} /><span>{error}</span>
      </div>
    </CardBody></Card>}

    {notice && <Card><CardBody>
      <div className="row" style={{ gap: 8, color: 'hsl(var(--good-foreground))' }}>
        <CheckCircle2 size={18} /><span>{notice}</span>
      </div>
    </CardBody></Card>}

    {current && <Card>
      <CardBody>
        <div className="row between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <FileText size={20} />
              <h3 style={{ margin: 0 }}>{current.fileName}</h3>
            </div>
            <p className="muted small">
              {current.pages} page(s) · {current.lineCount ?? 0} lines · Import ID: {current.id}
            </p>
          </div>
          <span className={`pill ${current.status === 'REVIEWED' ? 'green' : 'blue'}`}>
            {current.status}
          </span>
        </div>

        {current.headings?.length ? <>
          <h4>Possible section headings</h4>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {current.headings.map((heading, i) =>
              <span className="pill gray" key={`${heading}-${i}`}>{heading}</span>
            )}
          </div>
        </> : null}

        {current.truncated && <p className="small muted">
          Preview is limited to the first 250,000 characters. The original extracted text was longer.
        </p>}

        <h4>Structured records and validation</h4>
        <p className="muted small">
          {current.structured
            ? `Extraction model: ${current.modelName ?? 'recorded'} · ${current.validation?.errors.length ?? 0} error(s) · ${current.validation?.warnings.length ?? 0} warning(s)`
            : 'Extract the PDF text into editable record fields. If AI is not configured on the server, structured extraction will be unavailable.'}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" type="button" onClick={() => void extractStructured()} disabled={busy || !current.text}>
            {busy ? <Loader2 size={16} /> : <FileText size={16} />}
            Extract structured data
          </button>
          {current.structured && <button className="btn" type="button" onClick={() => void saveStructuredDraft()} disabled={busy}>
            <CheckCircle2 size={16} /> Save corrections and revalidate
          </button>}
        </div>

        {current.validation && <>
          {current.validation.errors.length > 0 && <div style={{ marginTop: 12 }}>
            <b>Errors requiring correction</b>
            <ul>{current.validation.errors.map((item, i) => <li key={`e-${i}`} className="small">{item}</li>)}</ul>
          </div>}
          {current.validation.warnings.length > 0 && <div style={{ marginTop: 12 }}>
            <b>Warnings to review</b>
            <ul>{current.validation.warnings.map((item, i) => <li key={`w-${i}`} className="small">{item}</li>)}</ul>
          </div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {Object.entries(current.validation.counts).map(([key, count]) =>
              <span className="pill gray" key={key}>{key}: {count}</span>
            )}
          </div>
        </>}

        {current.structured && <>
          <label htmlFor="pdf-structured-json"><b>Editable structured JSON</b></label>
          <textarea
            id="pdf-structured-json"
            className="input"
            rows={16}
            value={structuredDraft}
            onChange={(e) => setStructuredDraft(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', whiteSpace: 'pre' }}
          />
          <p className="muted small">
            Save corrections to rerun deterministic validation. This only updates the review draft, not the production tables.
          </p>
        </>}

        <h4>Extracted text preview</h4>
        <textarea
          className="input"
          readOnly
          rows={18}
          value={current.text ?? 'No extracted text is available.'}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', whiteSpace: 'pre' }}
          aria-label="Extracted PDF text"
        />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn" type="button" onClick={downloadText} disabled={!current.text}>
            <FileText size={16} /> Download extracted text
          </button>
          {current.structured && <button className="btn" type="button" onClick={() => void prepareImportPreview()} disabled={busy}>
            {busy ? <Loader2 size={16} /> : <RefreshCw size={16} />} Check import readiness
          </button>}
          {current.status !== 'REVIEWED' && <button className="btn primary" type="button" onClick={() => void markReviewed()} disabled={busy}>
            <CheckCircle2 size={16} /> Mark review complete
          </button>}
        </div>
      </CardBody>
    </Card>}

    {importPreview && <Card>
      <CardBody>
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>Import readiness report</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Read-only dry run for {importPreview.fileName}. Generated {new Date(importPreview.generatedAt).toLocaleString()}.
            </p>
          </div>
          <span className={`pill ${importPreview.readiness === 'BLOCKED' ? 'red' : importPreview.readiness === 'NEEDS_REVIEW' ? 'blue' : 'green'}`}>
            {importPreview.readiness.replaceAll('_', ' ')}
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="pill gray">Records: {importPreview.summary.recordCount}</span>
          <span className="pill red">Blockers: {importPreview.summary.blockerCount}</span>
          <span className="pill blue">Warnings: {importPreview.summary.warningCount}</span>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="table">
            <thead><tr><th>Record type</th><th>Total</th><th>Ready</th><th>Blocked</th><th>Needs review</th></tr></thead>
            <tbody>{importPreview.categories.map((category) => <tr key={category.key}>
              <td>{category.label}</td><td>{category.total}</td><td>{category.ready}</td><td>{category.blocked}</td><td>{category.needsReview}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <h4>Issues to resolve</h4>
        {!importPreview.issues.length ? <p className="small">No row-level issues were found in this dry run.</p> :
          <div className="stack" style={{ gap: 8 }}>
            {importPreview.issues.map((issue, index) => <div key={`${issue.level}-${issue.category}-${issue.sourceId}-${index}`} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 10 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className={`pill ${issue.level === 'BLOCKER' ? 'red' : 'blue'}`}>{issue.level}</span>
                <b>{issue.category}</b><span className="muted small">{issue.sourceId}</span>
              </div>
              <p className="small" style={{ margin: '6px 0 0' }}>{issue.message}</p>
            </div>)}
          </div>}
        {importPreview.issuesTruncated && <p className="muted small">Only the first 500 issues are shown. Refine the draft and run the preview again.</p>}
        <div style={{ marginTop: 12, padding: 12, border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
          <b>Safety status: dry run only</b>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Production writes: {importPreview.productionWrites ? 'enabled' : 'none'}. Actual import: {importPreview.importActionAvailable ? 'available' : 'not enabled yet'}.
            This report is a readiness check, not approval to import historical records.
          </p>
          <ul className="muted small">{importPreview.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        </div>
      </CardBody>
    </Card>}

    <Card>
      <CardBody>
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Recent PDF imports</h3>
          <button className="btn ghost" type="button" onClick={() => void refreshJobs()} disabled={busy}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        {!jobs.length ? <p className="muted small">No PDF import drafts yet.</p> :
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {jobs.map((job) => <div key={job.id} className="row between" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid hsl(var(--border))' }}>
              <div style={{ minWidth: 0 }}>
                <b>{job.fileName}</b>
                <div className="muted small">{job.pages} page(s) · {job.uploadedAt} · {job.status}</div>
              </div>
              <button className="btn ghost" type="button" onClick={() => void openJob(job.id)}>Open</button>
            </div>)}
          </div>}
      </CardBody>
    </Card>

    <Card>
      <CardBody>
        <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={18} />
          <div className="small">
            <b>Import safety</b>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              This version extracts text and stores a review draft in Neon. It does not yet
              insert lots, mixes, bale links or QA results into the production tables.
              Scanned image-only PDFs need OCR, which is not enabled in this version.
              Review the extracted content before using it as a source for production records.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  </div>;
}
