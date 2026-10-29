import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Lock, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { STAGES, STAGE_INFO, type Stage } from '@shared/params';
import type { AccessoriesMeta, ColorMeta, CountMixMeta, MasterVersionDTO, RecipeComponent } from '@shared/domain';
import { useMut } from '../../lib/api';
import { Card, CardBody, CardHead, Field, Notice } from '../ui';
import { errMsg, useCan } from './common';
import './masters.css';

// ------------------------------------------------------------------ validation (mirrors the contract so the messages arrive early and friendly)
export function countMixProblems(m: CountMixMeta): string[] {
  const out: string[] = [];
  if (!Array.isArray(m.route) || m.route.length < 6) out.push('The process route needs at least six stages.');
  if (!m.recipe?.length) out.push('A mix recipe is required.');
  const total = (m.recipe ?? []).reduce((s, r) => s + Number(r.pct), 0);
  if (Math.abs(total - 100) >= 0.01) out.push(`The recipe adds up to ${total.toFixed(1)}% — it must be exactly 100%.`);
  (m.recipe ?? []).forEach((r) => { if (!r.label?.trim()) out.push('Every recipe component needs a name.'); if (!(r.minPct <= r.pct && r.pct <= r.maxPct)) out.push(`${r.label || 'A component'}: min % ≤ target % ≤ max % is required.`); });
  if (!(Number(m.targetRealizationPct) > 0 && Number(m.targetRealizationPct) <= 100)) out.push('Target realization must be between 0 and 100%.');
  if (!(Number(m.targetWastePct) >= 0)) out.push('Target waste cannot be negative.');
  return [...new Set(out)];
}
const ACC_FIELDS: { key: keyof AccessoriesMeta; label: string; hint: string }[] = [
  { key: 'coneType', label: 'Cone / tube type', hint: 'e.g. Plastic cone 4°20′' }, { key: 'cartonType', label: 'Carton type', hint: 'e.g. 5-ply export carton, 50 kg class' },
  { key: 'polybag', label: 'Polybag', hint: 'Material, micron, separators' }, { key: 'strapping', label: 'Strapping', hint: 'e.g. PP strap, 2 straps' },
  { key: 'labelTemplate', label: 'Label template', hint: 'e.g. LBL-40CH-V1' }, { key: 'palletWrap', label: 'Pallet wrap', hint: 'Layers and cartons per pallet' },
  { key: 'travellerType', label: 'Traveller type', hint: 'Make and profile' }, { key: 'travellerNo', label: 'Traveller number', hint: 'e.g. 4/0' }, { key: 'clearerClass', label: 'Clearer class', hint: 'Yarn clearer setting' },
];
export function accessoriesProblems(m: AccessoriesMeta): string[] {
  const out = ACC_FIELDS.filter((f) => !String(m[f.key] ?? '').trim()).map((f) => `${f.label} is required.`);
  if (m.packageType !== 'CONE' && m.packageType !== 'CHEESE') out.push('Choose the package type.');
  return out;
}
export function colorProblems(m: ColorMeta): string[] {
  const out: string[] = [];
  if (!m.colorName?.trim() || !m.tip?.trim() || !m.code?.trim()) out.push('Colour name, tip description and code are required.');
  if (!/^#[0-9a-fA-F]{6}$/.test(m.hex ?? '')) out.push('The colour must be a #rrggbb value.');
  return out;
}

// ------------------------------------------------------------------ shell: draft state + save
function MetaShell<T extends object>({ version, editable, title, sub, problems, children }: {
  version: MasterVersionDTO; editable: boolean; title: string; sub: string; problems: (m: T) => string[]; children: (m: T, set: (p: Partial<T>) => void, can: boolean) => ReactNode;
}): JSX.Element {
  const perm = useCan('Master.upsertMeta');
  const server = version.meta as unknown as T;
  const [draft, setDraft] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const save = useMut<{ meta: T }, unknown>('PUT', `/api/masters/versions/${version.id}/meta`, `Edit ${title.toLowerCase()} of ${version.id}`);
  useEffect(() => { setDraft(null); }, [JSON.stringify(version.meta)]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = draft ?? server;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server);
  const issues = problems(m);
  const can = editable && perm.can;
  const set = (p: Partial<T>) => { setDone(null); setError(null); setDraft({ ...m, ...p }); };
  const onSave = async () => { setError(null); try { await save.mutateAsync({ meta: m }); setDone('Saved on the ledger.'); } catch (e) { setError(errMsg(e)); } };
  return <Card><CardHead title={title} sub={sub} right={!editable ? <span className="pill gray"><Lock size={11} /> read-only</span> : undefined} />
    <CardBody className="stack" >
      <div data-testid="meta-editor" className="stack">{children(m, set, can)}</div>
      {issues.length && (dirty || editable) ? <Notice tone="warn"><ul style={{ margin: 0, paddingLeft: 16 }}>{issues.map((x) => <li key={x}>{x}</li>)}</ul></Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}{done && !dirty ? <Notice tone="ok">{done}</Notice> : null}
      {editable ? <div className="row"><span className="grow" />{dirty ? <button className="btn ghost sm" onClick={() => setDraft(null)}>Discard</button> : null}<button className="btn primary" disabled={!can || !dirty || issues.length > 0 || save.isPending} title={perm.why} onClick={() => void onSave()} data-testid="meta-save"><Save size={14} /> {save.isPending ? 'Saving…' : 'Save'}</button></div> : null}
    </CardBody></Card>;
}

const numIn = (v: number, on: (n: number) => void, disabled: boolean, label: string, step = 0.1, width = 78) => <input className="input sm" style={{ width }} type="number" step={step} value={Number.isFinite(v) ? v : ''} disabled={disabled} aria-label={label} onChange={(e) => on(e.target.value === '' ? Number.NaN : Number(e.target.value))} />;

// ------------------------------------------------------------------ Count & Mix: route + recipe + targets
export function CountMixEditor({ version, usesComber, editable }: { version: MasterVersionDTO; usesComber: boolean; editable: boolean }): JSX.Element {
  return <MetaShell<CountMixMeta> version={version} editable={editable} title="Process route and mix recipe" sub="The stages every lot of this count goes through, the cotton blend (must total 100%) and the waste / realization targets lots are judged against." problems={countMixProblems}>
    {(m, set, can) => {
      const total = (m.recipe ?? []).reduce((s, r) => s + (Number(r.pct) || 0), 0); const okTotal = Math.abs(total - 100) < 0.01;
      const setRow = (i: number, p: Partial<RecipeComponent>) => set({ recipe: m.recipe.map((r, idx) => (idx === i ? { ...r, ...p } : r)) });
      const toggle = (s: Stage) => { const has = m.route.includes(s); const route = STAGES.filter((x) => (x === s ? !has : m.route.includes(x))); set({ route, usesComber: route.includes('COMB') }); };
      return <>
        <div><div className="muted small" style={{ marginBottom: 6, fontWeight: 600 }}>Process route</div><div className="row" style={{ gap: 6 }} data-testid="route-chips">{STAGES.map((s) => { const on = m.route?.includes(s); const locked = s === 'COMB'; return <button key={s} className="me-chip" aria-pressed={!!on} disabled={!can || locked} onClick={() => toggle(s)} title={locked ? 'The comber is fixed per count (set when the count is created)' : STAGE_INFO[s].plain}>{locked ? <Lock size={10} /> : null}{STAGE_INFO[s].short}</button>; })}</div></div>
        <div className="tbl-wrap"><table className="me-recipe" data-testid="recipe-table"><thead><tr><th>Component</th><th>Source</th><th>Variety</th><th>Target %</th><th>Min %</th><th>Max %</th><th /></tr></thead><tbody>
          {m.recipe.map((r, i) => <tr key={r.key + i}>
            <td><input className="input sm" style={{ minWidth: 170 }} value={r.label} disabled={!can} aria-label="Component name" onChange={(e) => setRow(i, { label: e.target.value })} /></td>
            <td><select className="select sm" value={r.source} disabled={!can} aria-label="Source" onChange={(e) => setRow(i, { source: e.target.value as 'BALE' | 'WASTE' })}><option value="BALE">Bale</option><option value="WASTE">Recycled waste</option></select></td>
            <td><input className="input sm" value={r.variety ?? ''} disabled={!can || r.source === 'WASTE'} placeholder={r.source === 'WASTE' ? '—' : 'Cotton variety'} aria-label="Variety" onChange={(e) => setRow(i, { variety: e.target.value })} /></td>
            <td>{numIn(r.pct, (n) => setRow(i, { pct: n }), !can, 'Target %')}</td><td>{numIn(r.minPct, (n) => setRow(i, { minPct: n }), !can, 'Minimum %')}</td><td>{numIn(r.maxPct, (n) => setRow(i, { maxPct: n }), !can, 'Maximum %')}</td>
            <td><button className="btn ghost sm icon" disabled={!can || m.recipe.length <= 1} aria-label="Remove component" title="Remove component" onClick={() => set({ recipe: m.recipe.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button></td>
          </tr>)}
        </tbody><tfoot><tr><td colSpan={3}><button className="btn sm" disabled={!can} onClick={() => set({ recipe: [...m.recipe, { key: `COMP${m.recipe.length + 1}`, label: '', source: 'BALE', variety: '', pct: 0, minPct: 0, maxPct: 0 }] })} data-testid="recipe-add"><Plus size={13} /> Add component</button></td>
          <td colSpan={4}><span className="me-total" data-testid="recipe-total" style={{ color: `hsl(var(${okTotal ? '--ok-foreground' : '--bad-foreground'}))` }}>{okTotal ? <CheckCircle2 size={14} /> : <XCircle size={14} />}Running total {total.toFixed(1)}% {okTotal ? '— adds up to 100%' : '— must be 100%'}</span></td></tr></tfoot></table></div>
        <div className="grid g3">
          <Field label="Target waste %" hint="Share of cotton lost as waste across the whole process">{numIn(m.targetWastePct, (n) => set({ targetWastePct: n }), !can, 'Target waste', 0.1, 120)}</Field>
          <Field label="Target realization %" hint="Yarn packed ÷ cotton fed at the blow room">{numIn(m.targetRealizationPct, (n) => set({ targetRealizationPct: n }), !can, 'Target realization', 0.1, 120)}</Field>
          <Field label="Notes"><input className="input" value={m.notes ?? ''} disabled={!can} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" /></Field>
        </div>
      </>;
    }}
  </MetaShell>;
}

// ------------------------------------------------------------------ Accessories: packing specification
export function AccessoriesEditor({ version, editable }: { version: MasterVersionDTO; editable: boolean }): JSX.Element {
  return <MetaShell<AccessoriesMeta> version={version} editable={editable} title="Packing specification" sub="What a packed carton of this count must look like — checked at packing, shown on the lot passport and the dispatch label." problems={accessoriesProblems}>
    {(m, set, can) => <div className="grid g3">
      <Field label="Package type"><select className="select" value={m.packageType} disabled={!can} onChange={(e) => set({ packageType: e.target.value as 'CONE' | 'CHEESE' })} aria-label="Package type"><option value="CONE">Cone</option><option value="CHEESE">Cheese</option></select></Field>
      {ACC_FIELDS.map((f) => <Field key={f.key} label={f.label} hint={f.hint}><input className={`input ${String(m[f.key] ?? '').trim() ? '' : 'bad'}`} value={String(m[f.key] ?? '')} disabled={!can} aria-label={f.label} onChange={(e) => set({ [f.key]: e.target.value } as Partial<AccessoriesMeta>)} /></Field>)}
      <Field label="QR label on cartons" hint="Product-passport QR printed on every carton"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!m.qrLabel} disabled={!can} onChange={(e) => set({ qrLabel: e.target.checked })} /> Print the passport QR code</label></Field>
    </div>}
  </MetaShell>;
}

// ------------------------------------------------------------------ Color code: tip colour of the count
export function ColorEditor({ version, editable }: { version: MasterVersionDTO; editable: boolean }): JSX.Element {
  return <MetaShell<ColorMeta> version={version} editable={editable} title="Cone tip colour" sub="The colour identifying this count. Packing compares the cones actually packed against it." problems={colorProblems}>
    {(m, set, can) => <div className="row top" style={{ gap: 22, flexWrap: 'wrap' }}>
      <div className="stack tight" style={{ alignItems: 'center' }}><span className="me-swatch-big" style={{ background: /^#[0-9a-fA-F]{6}$/.test(m.hex) ? m.hex : 'transparent' }} data-testid="color-swatch" aria-label={`${m.colorName} swatch`} /><span className="muted small">{m.tip || 'Tip description'}</span></div>
      <div className="grid g2 grow" style={{ minWidth: 320 }}>
        <Field label="Colour name"><input className="input" value={m.colorName ?? ''} disabled={!can} onChange={(e) => set({ colorName: e.target.value })} aria-label="Colour name" /></Field>
        <Field label="Colour code" hint="Printed on labels, e.g. GR-40"><input className="input" value={m.code ?? ''} disabled={!can} onChange={(e) => set({ code: e.target.value })} aria-label="Colour code" /></Field>
        <Field label="Colour"><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="color" value={/^#[0-9a-fA-F]{6}$/.test(m.hex) ? m.hex : '#999999'} disabled={!can} onChange={(e) => set({ hex: e.target.value })} aria-label="Colour picker" style={{ width: 44, height: 34, padding: 2, border: '1px solid hsl(var(--input))', borderRadius: 8, background: 'transparent' }} /><input className="input mono" value={m.hex ?? ''} disabled={!can} onChange={(e) => set({ hex: e.target.value })} aria-label="Colour hex" /></div></Field>
        <Field label="Tip description" hint="What the cone looks like, e.g. Green tip cone"><input className="input" value={m.tip ?? ''} disabled={!can} onChange={(e) => set({ tip: e.target.value })} aria-label="Tip description" /></Field>
      </div>
    </div>}
  </MetaShell>;
}
