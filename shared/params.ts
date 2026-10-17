// Domain registry shared by server and client: departments, stage order, parameters.
// This file is the single source of truth for parameter keys, labels, units and applicability.

export const DEPARTMENTS = ['RM', 'BR', 'CARD', 'DF', 'FF', 'RF', 'AW', 'PACK'] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Production stage order (bale -> cone). ProcessEvent contract enforces this order. */
export const STAGE_ORDER: Department[] = ['RM', 'BR', 'CARD', 'DF', 'FF', 'RF', 'AW', 'PACK'];

/** Departments that appear as rows in the Lot > QUALITY tab, in mentor-specified order (extendable). */
export const QUALITY_DEPARTMENTS: Department[] = ['AW', 'RF', 'FF', 'DF', 'CARD'];

/** Departments that have machine-wise / day-wise test data (heatmap). */
export const MACHINE_TEST_DEPARTMENTS: Department[] = ['CARD', 'DF', 'FF', 'RF', 'AW'];

export const DEPARTMENT_INFO: Record<Department, { code: Department; label: string; short: string; machinePrefix: string }> = {
  RM: { code: 'RM', label: 'Raw Material (Bale Mix)', short: 'RM', machinePrefix: 'Mix' },
  BR: { code: 'BR', label: 'Blowroom', short: 'BR', machinePrefix: 'BR Line' },
  CARD: { code: 'CARD', label: 'Carding', short: 'CD', machinePrefix: 'Card' },
  DF: { code: 'DF', label: 'Draw Frame', short: 'DF', machinePrefix: 'DF' },
  FF: { code: 'FF', label: 'Fly Frame (Simplex)', short: 'FF', machinePrefix: 'FF' },
  RF: { code: 'RF', label: 'Ring Frame', short: 'RF', machinePrefix: 'RF M/c' },
  AW: { code: 'AW', label: 'Autoconer', short: 'AW', machinePrefix: 'AW' },
  PACK: { code: 'PACK', label: 'Packing', short: 'PK', machinePrefix: 'Pack' },
};

export const SHIFTS = ['A', 'B', 'C'] as const;
export type Shift = (typeof SHIFTS)[number];

export type ParamCategory = 'FIBRE' | 'PROCESS' | 'QUALITY';
export type ParamGroup =
  | 'Fibre'
  | 'Machine setting'
  | 'Process'
  | 'Evenness'
  | 'Imperfections'
  | 'Hairiness'
  | 'Strength'
  | 'Length variation'
  | 'Count';

export interface ParamDef {
  key: string;
  label: string;
  short: string; // column header
  unit: string;
  category: ParamCategory;
  group: ParamGroup;
  decimals: number;
  departments: Department[]; // where this parameter is meaningful
}

// NOTE: keys are UPPER_SNAKE and are used verbatim in JSON `values` / `params` objects and in standards.
export const PARAMS: ParamDef[] = [
  // ---- Fibre (RM / bale HVI) ----
  { key: 'MIC', label: 'Micronaire', short: 'Mic', unit: 'µg/in', category: 'FIBRE', group: 'Fibre', decimals: 2, departments: ['RM'] },
  { key: 'UHML', label: 'Upper Half Mean Length', short: 'UHML', unit: 'mm', category: 'FIBRE', group: 'Fibre', decimals: 1, departments: ['RM'] },
  { key: 'UI', label: 'Uniformity Index', short: 'UI', unit: '%', category: 'FIBRE', group: 'Fibre', decimals: 1, departments: ['RM'] },
  { key: 'STR', label: 'Fibre Strength', short: 'Str', unit: 'g/tex', category: 'FIBRE', group: 'Fibre', decimals: 1, departments: ['RM'] },
  { key: 'SFI', label: 'Short Fibre Index', short: 'SFI', unit: '%', category: 'FIBRE', group: 'Fibre', decimals: 1, departments: ['RM'] },
  { key: 'TRASH', label: 'Trash Content', short: 'Trash', unit: '%', category: 'FIBRE', group: 'Fibre', decimals: 2, departments: ['RM'] },
  { key: 'MOIST', label: 'Moisture', short: 'Moist', unit: '%', category: 'FIBRE', group: 'Fibre', decimals: 1, departments: ['RM'] },

  // ---- Process / machine settings ----
  { key: 'BEATER_RPM', label: 'Beater Speed', short: 'Beater', unit: 'rpm', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['BR'] },
  { key: 'WASTE_PCT', label: 'Waste', short: 'Waste', unit: '%', category: 'PROCESS', group: 'Process', decimals: 2, departments: ['BR', 'CARD'] },
  { key: 'CYL_RPM', label: 'Cylinder Speed', short: 'Cyl', unit: 'rpm', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['CARD'] },
  { key: 'LICKER_RPM', label: 'Licker-in Speed', short: 'Licker', unit: 'rpm', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['CARD'] },
  { key: 'FLAT_SPEED', label: 'Flat Speed', short: 'Flats', unit: 'mm/min', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['CARD'] },
  { key: 'DEL_SPEED', label: 'Delivery Speed', short: 'Del', unit: 'm/min', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['CARD', 'DF'] },
  { key: 'BREAK_DRAFT', label: 'Break Draft', short: 'BD', unit: '', category: 'PROCESS', group: 'Machine setting', decimals: 2, departments: ['DF', 'FF', 'RF'] },
  { key: 'TOTAL_DRAFT', label: 'Total Draft', short: 'TD', unit: '', category: 'PROCESS', group: 'Machine setting', decimals: 2, departments: ['DF', 'RF'] },
  { key: 'DOUBLINGS', label: 'Doublings', short: 'Dbl', unit: 'ends', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['DF'] },
  { key: 'FLYER_RPM', label: 'Flyer Speed', short: 'Flyer', unit: 'rpm', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['FF'] },
  { key: 'TPI', label: 'Twist per Inch', short: 'TPI', unit: 'tpi', category: 'PROCESS', group: 'Machine setting', decimals: 2, departments: ['FF', 'RF'] },
  { key: 'SPINDLE_RPM', label: 'Spindle Speed', short: 'Spindle', unit: 'rpm', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['RF'] },
  { key: 'SPACER_MM', label: 'Spacer', short: 'Spacer', unit: 'mm', category: 'PROCESS', group: 'Machine setting', decimals: 2, departments: ['RF'] },
  { key: 'TOP_ARM_KG', label: 'Top Arm Pressure', short: 'TopArm', unit: 'kg', category: 'PROCESS', group: 'Machine setting', decimals: 1, departments: ['RF'] },
  { key: 'WIND_SPEED', label: 'Winding Speed', short: 'Wind', unit: 'm/min', category: 'PROCESS', group: 'Machine setting', decimals: 0, departments: ['AW'] },
  { key: 'SPLICE_STR', label: 'Splice Strength', short: 'Splice', unit: '%', category: 'PROCESS', group: 'Process', decimals: 1, departments: ['AW'] },
  { key: 'CUTS_100KM', label: 'Clearer Cuts', short: 'Cuts', unit: '/100km', category: 'PROCESS', group: 'Process', decimals: 0, departments: ['AW'] },

  // ---- Quality (test results) ----
  { key: 'HANK', label: 'Hank', short: 'Hank', unit: 'Ne', category: 'QUALITY', group: 'Count', decimals: 3, departments: ['CARD', 'DF', 'FF'] },
  { key: 'U', label: 'U%', short: 'U%', unit: '%', category: 'QUALITY', group: 'Evenness', decimals: 2, departments: ['CARD', 'DF', 'FF', 'RF', 'AW'] },
  { key: 'CV', label: 'CVm%', short: 'CV%', unit: '%', category: 'QUALITY', group: 'Evenness', decimals: 2, departments: ['CARD', 'DF', 'FF', 'RF', 'AW'] },
  { key: 'NEPS_G', label: 'Card Web Neps', short: 'Neps/g', unit: '/g', category: 'QUALITY', group: 'Imperfections', decimals: 0, departments: ['CARD'] },
  { key: 'THIN', label: 'Thin places (-50%)', short: 'Thin', unit: '/km', category: 'QUALITY', group: 'Imperfections', decimals: 0, departments: ['RF', 'AW'] },
  { key: 'THICK', label: 'Thick places (+50%)', short: 'Thick', unit: '/km', category: 'QUALITY', group: 'Imperfections', decimals: 0, departments: ['RF', 'AW'] },
  { key: 'NEPS', label: 'Neps (+200%)', short: 'Neps', unit: '/km', category: 'QUALITY', group: 'Imperfections', decimals: 0, departments: ['RF', 'AW'] },
  { key: 'IPI', label: 'Total IPI', short: 'IPI', unit: '/km', category: 'QUALITY', group: 'Imperfections', decimals: 0, departments: ['RF', 'AW'] },
  { key: 'H', label: 'Hairiness', short: 'H', unit: '', category: 'QUALITY', group: 'Hairiness', decimals: 2, departments: ['RF', 'AW'] },
  { key: 'CSP', label: 'Count Strength Product', short: 'CSP', unit: '', category: 'QUALITY', group: 'Strength', decimals: 0, departments: ['RF', 'AW'] },
  { key: 'RKM', label: 'Tenacity (RKM)', short: 'RKM', unit: 'cN/tex', category: 'QUALITY', group: 'Strength', decimals: 2, departments: ['RF', 'AW'] },
  { key: 'ELONG', label: 'Elongation', short: 'Elong', unit: '%', category: 'QUALITY', group: 'Strength', decimals: 2, departments: ['RF', 'AW'] },
  { key: 'CV1M', label: 'CV (1 m)', short: 'CV1m', unit: '%', category: 'QUALITY', group: 'Length variation', decimals: 2, departments: ['DF', 'AW'] },
  { key: 'CV3M', label: 'CV (3 m)', short: 'CV3m', unit: '%', category: 'QUALITY', group: 'Length variation', decimals: 2, departments: ['DF', 'AW'] },
  { key: 'CV10M', label: 'CV (10 m)', short: 'CV10m', unit: '%', category: 'QUALITY', group: 'Length variation', decimals: 2, departments: ['AW'] },
  { key: 'COUNT', label: 'Actual Count', short: 'Count', unit: 'Ne', category: 'QUALITY', group: 'Count', decimals: 2, departments: ['RF', 'AW'] },
  { key: 'COUNT_CV', label: 'Count CV%', short: 'CntCV', unit: '%', category: 'QUALITY', group: 'Count', decimals: 2, departments: ['RF', 'AW'] },
];

export type ParamKey = string;

export const PARAM_MAP: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export function paramDef(key: string): ParamDef | undefined {
  return PARAM_MAP[key];
}

export function paramsFor(department: Department, category?: ParamCategory): ParamDef[] {
  return PARAMS.filter((p) => p.departments.includes(department) && (!category || p.category === category));
}

/** Default visible columns for the Lot > QUALITY table (configurable in Settings: `qualityColumns`). */
export const DEFAULT_QUALITY_COLUMNS: string[] = [
  'U', 'CV', 'THIN', 'THICK', 'NEPS', 'IPI', 'H', 'CSP', 'RKM', 'ELONG', 'CV1M', 'CV3M', 'CV10M',
];

/** Parameters selectable on the U% heatmap. */
export const HEATMAP_PARAMS: string[] = ['U', 'CV', 'IPI', 'H', 'THIN', 'THICK', 'NEPS'];

export function formatParamValue(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const d = PARAM_MAP[key]?.decimals ?? 2;
  return value.toFixed(d);
}

export function machineLabel(department: Department, machineNo: number): string {
  return `${DEPARTMENT_INFO[department].machinePrefix} ${machineNo}`;
}

export function machineId(department: Department, machineNo: number): string {
  return `${department}-${machineNo}`;
}
