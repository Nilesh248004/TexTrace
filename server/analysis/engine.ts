import type { AnalysisContext, AnalysisResult, Complaint, Deviation, Dispatch, Lot, RootCause, Standard, TestResult, ProductionEvent } from '@shared/types';
import { evaluate } from '@shared/quality';
import { STAGE_ORDER } from '@shared/params';

export interface AnalysisEvidence {
  lot: Pick<Lot, 'id'|'lotNo'|'lotCode'|'countId'>;
  tests: Pick<TestResult, 'id'|'department'|'sampleType'|'machineId'|'testDate'|'dayIndex'|'shift'|'values'>[];
  events: Pick<ProductionEvent, 'id'|'department'|'machineId'|'eventDate'|'dayIndex'|'params'|'notes'>[];
  standards: Pick<Standard, 'id'|'department'|'parameter'|'std'|'lower'|'upper'>[];
  complaint: Pick<Complaint, 'id'|'complaintNo'|'type'> | null;
  dispatches: Pick<Dispatch, 'id'|'dispatchNo'|'customerId'|'customerName'|'dispatchDate'|'quantityKg'|'lots'>[];
  context: AnalysisContext;
  comparisonLots: { id: string; lotNo: string }[];
  warnFraction: number;
}

const STAGE_LABEL: Record<string, string> = { RM: 'Raw material', BR: 'Blowroom', CARD: 'Carding', DF: 'Draw frame', FF: 'Fly frame', RF: 'Ring frame', AW: 'Autoconer', PACK: 'Packing' };

export function analyzeEvidence(input: AnalysisEvidence, generatedAt = new Date().toISOString()): AnalysisResult {
  const deviations: Deviation[] = [];
  const standardIndex = new Map(input.standards.map((standard) => [`${standard.department}:${standard.parameter}`, standard]));
  for (const test of input.tests) {
    for (const [parameter, value] of Object.entries(test.values)) {
      const standard = standardIndex.get(`${test.department}:${parameter}`);
      if (!standard) continue;
      const assessment = evaluate(value, { std: standard.std, lower: standard.lower, upper: standard.upper }, input.warnFraction);
      if (assessment.color === 'green' || assessment.color === 'none') continue;
      const event = input.events.find((item) => item.machineId === test.machineId && item.department === test.department && item.eventDate === test.testDate);
      const processValue = event?.params.BREAK_DRAFT;
      const significance = Math.min(100, Math.round((assessment.color === 'red' ? 74 : 42) + (processValue !== undefined && Math.abs(processValue - 1.18) > 0.05 ? 20 : 0)));
      deviations.push({
        rank: 0, scope: test.sampleType === 'MACHINE' ? 'MACHINE_DAY' : 'LOT', department: test.department,
        parameter, machineId: test.machineId, dayIndex: test.dayIndex, date: test.testDate, shift: test.shift,
        value, std: standard.std, lower: standard.lower, upper: standard.upper, color: assessment.color,
        deviationFromStd: value - standard.std, normalizedDeviation: assessment.normalized, zScore: null,
        comparisonMean: null, comparisonSd: null, significance,
        evidence: `${test.machineId ?? 'Lot sample'} · ${test.dayIndex ? `D${test.dayIndex}` : test.testDate}: ${parameter} ${value} vs standard ${standard.std} (limits ${standard.lower ?? '—'}–${standard.upper ?? '—'}), ${assessment.color.toUpperCase()}.`,
      });
    }
  }
  deviations.sort((a,b) => b.significance - a.significance);
  deviations.forEach((item,index) => { item.rank = index + 1; });
  const leading = deviations.find((item) => item.scope === 'MACHINE_DAY' && item.color === 'red') ?? deviations[0] ?? null;
  const leadingEvent = leading ? input.events.find((event) => event.machineId === leading.machineId && event.department === leading.department && event.eventDate === leading.date) : undefined;
  const processStandard = leadingEvent ? standardIndex.get(`${leadingEvent.department}:BREAK_DRAFT`) : undefined;
  const breakDraft = leadingEvent?.params.BREAK_DRAFT;
  const processFault = breakDraft !== undefined && processStandard !== undefined && evaluate(breakDraft, { std: processStandard.std, lower: processStandard.lower, upper: processStandard.upper }, input.warnFraction).color === 'red';
  const suspect = leading ? {
    department: leading.department, stageLabel: STAGE_LABEL[leading.department] ?? leading.department,
    machineId: leading.machineId, machineLabel: leading.machineId ? `${leading.department} M/c ${leading.machineId.split('-').at(-1)}` : null,
    dayIndex: leading.dayIndex, date: leading.date, shifts: [...new Set(deviations.filter((item) => item.machineId === leading.machineId && item.date === leading.date).map((item) => item.shift).filter((shift): shift is NonNullable<typeof shift> => shift !== null))],
    parameter: leading.parameter, value: leading.value, confidence: processFault ? 94 : leading.color === 'red' ? 78 : 55,
    evidence: [leading.evidence, ...(processFault ? [`BREAK_DRAFT ${breakDraft} is outside the ${processStandard?.lower}–${processStandard?.upper} standard band; maintenance note: ${leadingEvent?.notes || 'no note recorded'}.`] : [])],
  } : null;
  const rootCauses: RootCause[] = suspect ? [{
    id: processFault ? 'RF_BREAK_DRAFT' : `${suspect.department}_QUALITY_DEVIATION`, title: processFault ? 'Ring-frame break-draft setting' : `${suspect.stageLabel} quality deviation`,
    category: 'MACHINE_SETTING', department: suspect.department, machineId: suspect.machineId, confidence: suspect.confidence,
    evidence: [
      { text: leading?.evidence ?? '', values: { value: leading?.value ?? 0, standard: leading?.std ?? 0 }, dataRefs: leading ? [{ kind: 'test', id: input.tests.find((test) => test.machineId === leading.machineId && test.testDate === leading.date)?.id ?? '' }] : [] },
      ...(processFault && leadingEvent ? [{ text: `Break draft ${breakDraft} vs standard ${processStandard?.std}; ${leadingEvent.notes}`, values: { breakDraft: breakDraft ?? 0, standard: processStandard?.std ?? 0 }, dataRefs: [{ kind: 'event' as const, id: leadingEvent.id }] }] : []),
    ],
  }] : [];
  const recallDispatches = input.dispatches.flatMap((dispatch) => dispatch.lots.filter((lot) => lot.lotId === input.lot.id).map((lot) => ({
    dispatchId: dispatch.id, dispatchNo: dispatch.dispatchNo, customerId: dispatch.customerId, customerName: dispatch.customerName,
    lotNo: input.lot.lotNo, quantityKg: lot.quantityKg, dispatchDate: dispatch.dispatchDate, risk: 'HIGH' as const,
  })));
  const atRisk = recallDispatches.reduce((sum,item) => sum + item.quantityKg, 0);
  const parameter = leading?.parameter ?? null;
  const stage = suspect?.department ?? null;
  const headline = suspect && leading ? `${parameter === 'U' ? 'Evenness defect' : `${parameter} deviation`} localized to ${suspect.machineId} on D${suspect.dayIndex ?? '?'}` : 'No out-of-tolerance production evidence found';
  return {
    engineVersion: 'stat-1.0', generatedAt,
    lot: { ...input.lot }, complaint: input.complaint ? { ...input.complaint } : null,
    context: input.context, comparisonLots: input.comparisonLots,
    summary: { headline, overallColor: deviations.some((item) => item.color === 'red') ? 'red' : deviations.length ? 'yellow' : 'green', deviatingCount: deviations.length, topParameter: parameter, suspectedStage: stage, dataPoints: input.tests.reduce((sum,test) => sum + Object.keys(test.values).length,0) },
    deviations: deviations.slice(0,25), suspected: suspect, rootCauses, correlations: [],
    recallScope: { lots: [{ lotId: input.lot.id, lotNo: input.lot.lotNo, reason: 'Target lot contains the suspected machine-day quality deviation.', risk: 'HIGH' }], dispatches: recallDispatches, customers: [...new Map(recallDispatches.map((item) => [item.customerId, { customerId: item.customerId, name: item.customerName, quantityKg: recallDispatches.filter((dispatch) => dispatch.customerId === item.customerId).reduce((sum,dispatch) => sum + dispatch.quantityKg,0) }])).values()], totalKgAtRisk: atRisk, estimatedAffectedKg: null, basis: atRisk ? `${atRisk.toFixed(1)} kg from the target lot is associated with customer dispatches.` : 'No dispatches are associated with the target lot.' },
    actions: {
      corrective: rootCauses.length ? [{ id: 'CHECK_RF_DRAFT', text: 'Verify and reset the break-draft change gear, then confirm U% across three shifts.', owner: 'Ring Frame maintenance', priority: 'HIGH', relatedCauseId: rootCauses[0].id }] : [],
      preventive: rootCauses.length ? [{ id: 'SHIFT_SETTING_CHECK', text: 'Add drafting settings verification to the shift-start checklist.', owner: 'Production supervisor', priority: 'MEDIUM', relatedCauseId: rootCauses[0].id }] : [],
    },
    narrative: { source: 'template', headline, text: suspect?.evidence.join(' ') ?? 'No significant quality deviation was found in available evidence.', rootCauseExplanations: rootCauses.map((cause) => ({ causeId: cause.id, explanation: cause.evidence.map((item) => item.text).join(' ') })), cautions: ['Statistical analysis is advisory; QA conclusion and customer disposition require human review.'] },
  };
}