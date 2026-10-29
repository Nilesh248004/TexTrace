// Domain registry shared by server and client: process stages, parameters (the three groups), master types.
// Single source of truth for parameter keys, labels, units, plain-language descriptions and master templates.

// ------------------------------------------------------------------ stages
export const STAGES = ['BALE', 'BR', 'CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW', 'PACK', 'FG', 'DISP', 'DELIV'] as const;
export type Stage = (typeof STAGES)[number];
/** Scope of a master item: a process stage, or 'MIX' for the allowed fibre ranges of the blended mix. */
export type Scope = Stage | 'MIX';

export interface StageInfo {
  code: Stage;
  label: string;
  short: string;
  /** Prefix used in machine labels, e.g. 'RF' -> 'RF 6'. */
  machinePrefix: string;
  /** In-progress wording, e.g. 'In ring frame'. */
  here: string;
  /** Customer-friendly one-liner. */
  plain: string;
  /** Has machines, production parameters and lab tests. */
  machine: boolean;
}

export const STAGE_INFO: Record<Stage, StageInfo> = {
  BALE: { code: 'BALE', label: 'Bale store', short: 'Bale', machinePrefix: 'Bay', here: 'In bale store', plain: 'Raw cotton bales are stored, then issued to make the blend.', machine: false },
  BR: { code: 'BR', label: 'Blow room', short: 'Blow', machinePrefix: 'BR', here: 'In blow room', plain: 'Bales are opened, blended and cleaned of trash.', machine: true },
  CARD: { code: 'CARD', label: 'Carding', short: 'Card', machinePrefix: 'Card', here: 'In carding', plain: 'Fibres are separated and aligned into a soft rope (sliver).', machine: true },
  DFB: { code: 'DFB', label: 'Drawing – breaker', short: 'DF-B', machinePrefix: 'DF-B', here: 'In drawing (breaker)', plain: 'Slivers are combined and stretched to make them even.', machine: true },
  DFF: { code: 'DFF', label: 'Drawing – finisher', short: 'DF-F', machinePrefix: 'DF-F', here: 'In drawing (finisher)', plain: 'A second drawing pass further evens out the sliver.', machine: true },
  COMB: { code: 'COMB', label: 'Comber', short: 'Comb', machinePrefix: 'Comb', here: 'In comber', plain: 'Short fibres are combed out to make a finer, smoother yarn.', machine: true },
  FF: { code: 'FF', label: 'Fly frame (simplex)', short: 'Fly', machinePrefix: 'FF', here: 'In fly frame', plain: 'Sliver is thinned and given a slight twist (roving).', machine: true },
  RF: { code: 'RF', label: 'Ring frame', short: 'Ring', machinePrefix: 'RF', here: 'In ring frame', plain: 'Roving is drafted to its final thickness and twisted into yarn.', machine: true },
  AW: { code: 'AW', label: 'Autoconer (winding)', short: 'Wind', machinePrefix: 'AW', here: 'In winding', plain: 'Yarn is wound onto cones and faults are cleared.', machine: true },
  PACK: { code: 'PACK', label: 'Packing', short: 'Pack', machinePrefix: 'Pack', here: 'Packed', plain: 'Cones are weighed, labelled and boxed in cartons.', machine: false },
  FG: { code: 'FG', label: 'Finished-goods store', short: 'FG store', machinePrefix: 'Bay', here: 'In finished-goods store', plain: 'Packed cartons wait for dispatch.', machine: false },
  DISP: { code: 'DISP', label: 'Dispatch', short: 'Dispatch', machinePrefix: 'Gate', here: 'Dispatched', plain: 'Cartons are loaded and leave the mill.', machine: false },
  DELIV: { code: 'DELIV', label: 'Delivered', short: 'Delivered', machinePrefix: 'Customer', here: 'Delivered', plain: 'Cartons reach the customer.', machine: false },
};

/** Stages that have machines + lab tests. */
export const MACHINE_STAGES: Stage[] = STAGES.filter((s) => STAGE_INFO[s].machine);
/** Stages that appear in the quality / production / accessories tabs. */
export const PROCESS_STAGES: Stage[] = ['BR', 'CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW'];

export function routeFor(usesComber: boolean): Stage[] {
  return STAGES.filter((s) => usesComber || s !== 'COMB');
}

export const SHIFTS = ['A', 'B', 'C'] as const;
export type Shift = (typeof SHIFTS)[number];

/** Shift (A 06–14, B 14–22, C 22–06) for an ISO timestamp, in the mill's local time (IST, UTC+5:30). */
export function shiftOf(iso: string): Shift {
  const ist = new Date(Date.parse(iso) + 330 * 60_000);
  const h = ist.getUTCHours();
  return h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C';
}

// ------------------------------------------------------------------ masters
export const MASTER_TYPES = ['COUNT_MIX', 'QUALITY', 'PRODUCTION', 'ACCESSORIES', 'COLOR'] as const;
export type MasterType = (typeof MASTER_TYPES)[number];

export const MASTER_LABEL: Record<MasterType, string> = {
  COUNT_MIX: 'Count & Mix Master',
  QUALITY: 'Quality Master',
  PRODUCTION: 'Production Master',
  ACCESSORIES: 'Accessories Master',
  COLOR: 'Color Code Master',
};

export const MASTER_PLAIN: Record<MasterType, string> = {
  COUNT_MIX: 'Process route, cotton blend recipe, waste and realization targets for each count.',
  QUALITY: 'Lab-test targets and tolerances for every machine and department.',
  PRODUCTION: 'Machine settings, running parameters, yield and waste targets for every stage.',
  ACCESSORIES: 'Packing specification and life of shop-floor accessories (traveller, cots, aprons).',
  COLOR: 'Cone colour used to identify each count.',
};

export type MasterStatus = 'DRAFT' | 'QA_APPROVED' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';

// ------------------------------------------------------------------ parameters
export type ParamKind = 'FIBRE' | 'QUALITY' | 'PRODUCTION' | 'ACCESSORY';

export interface ParamDef {
  key: string;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  kind: ParamKind;
  stages: Stage[];
  /** Customer-friendly explanation (tooltips in the portal). */
  plain: string;
  /** true = recommended but not required for master completeness. */
  optional?: boolean;
  /** Higher is worse / better, used for wording. */
  better?: 'lower' | 'higher' | 'target';
}

export const MASTER_OF_KIND: Record<ParamKind, MasterType> = { FIBRE: 'QUALITY', QUALITY: 'QUALITY', PRODUCTION: 'PRODUCTION', ACCESSORY: 'ACCESSORIES' };

const P = (kind: ParamKind, key: string, label: string, short: string, unit: string, decimals: number, stages: Stage[], plain: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, short, unit, decimals, kind, stages, plain, ...extra });

const ALL_MACH: Stage[] = ['BR', 'CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW'];
const SLIVER: Stage[] = ['CARD', 'DFB', 'DFF'];
const DRAWING: Stage[] = ['DFB', 'DFF'];

export const PARAMS: ParamDef[] = [
  // ---------- fibre (blow room lab + MIX master)
  P('FIBRE', 'MIC', 'Micronaire', 'Mic', 'µg/in', 2, ['BR'], 'Fibre fineness. Too high = coarse, too low = immature fibres.', { better: 'target' }),
  P('FIBRE', 'UHML', 'Staple length (UHML)', 'UHML', 'mm', 1, ['BR'], 'Average length of the longer half of the fibres. Longer fibre = stronger, smoother yarn.', { better: 'higher' }),
  P('FIBRE', 'UI', 'Uniformity index', 'UI', '%', 1, ['BR'], 'How similar fibre lengths are. Higher is better.', { better: 'higher' }),
  P('FIBRE', 'STR', 'Fibre strength', 'Str', 'g/tex', 1, ['BR'], 'Strength of the cotton fibre.', { better: 'higher' }),
  P('FIBRE', 'SFI', 'Short fibre index', 'SFI', '%', 1, ['BR'], 'Share of very short fibres. Lower is better – short fibres stick out of the yarn as hairiness.', { better: 'lower' }),
  P('FIBRE', 'TRASH', 'Trash content', 'Trash', '%', 2, ['BR'], 'Leaf and dirt in the cotton.', { better: 'lower' }),
  P('FIBRE', 'MOIST', 'Moisture', 'Moist', '%', 1, ['BR'], 'Water content of the cotton.', { better: 'target' }),
  P('FIBRE', 'RD', 'Colour reflectance (Rd)', 'Rd', '', 1, ['BR'], 'Brightness of the cotton.', { better: 'higher' }),
  P('FIBRE', 'PLUS_B', 'Colour yellowness (+b)', '+b', '', 1, ['BR'], 'Yellowness of the cotton.', { better: 'lower' }),

  // ---------- quality (lab tests, every machine)
  P('QUALITY', 'CLEAN_EFF', 'Cleaning efficiency', 'Clean%', '%', 1, ['BR'], 'How much trash the blow room removed.', { better: 'higher' }),
  P('QUALITY', 'WASTE_TRASH', 'Trash in waste', 'WasteTr', '%', 1, ['BR'], 'Trash share of the waste removed – high means good cotton is not being thrown away.', { better: 'higher' }),
  P('QUALITY', 'NEPS_BEFORE', 'Neps before blow room', 'NepsIn', '/g', 0, ['BR'], 'Tiny fibre knots going into the blow room.', { better: 'lower' }),
  P('QUALITY', 'NEPS_AFTER', 'Neps after blow room', 'NepsOut', '/g', 0, ['BR'], 'Tiny fibre knots coming out of the blow room.', { better: 'lower' }),
  P('QUALITY', 'NEPS_IN', 'Neps before card', 'NepsIn', '/g', 0, ['CARD'], 'Fibre knots in the feed to the card.', { better: 'lower' }),
  P('QUALITY', 'NEPS_OUT', 'Neps after card', 'NepsOut', '/g', 0, ['CARD'], 'Fibre knots in the carded web.', { better: 'lower' }),
  P('QUALITY', 'NEP_REMOVAL', 'Nep removal efficiency', 'NepRem', '%', 1, ['CARD'], 'Share of neps the card removed.', { better: 'higher' }),
  P('QUALITY', 'TRASH_OUT', 'Trash after card', 'Trash', '%', 2, ['CARD'], 'Trash left in the sliver.', { better: 'lower' }),
  P('QUALITY', 'HANK', 'Hank', 'Hank', 'Ne', 3, ['CARD', 'DFB', 'DFF', 'FF'], 'Thickness of sliver / roving (higher hank = thinner).', { better: 'target' }),
  P('QUALITY', 'HANK_CV', 'Hank CV%', 'HankCV', '%', 2, ['DFB', 'DFF', 'FF'], 'Variation in thickness between lengths. Lower is better.', { better: 'lower' }),
  P('QUALITY', 'U', 'U% (evenness)', 'U%', '%', 2, ['CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW'], 'Evenness of the strand. Lower U% = more even, better-looking fabric.', { better: 'lower' }),
  P('QUALITY', 'CV', 'CVm%', 'CV%', '%', 2, ['CARD', 'DFB', 'DFF', 'FF', 'RF'], 'Mass variation. Lower is better.', { better: 'lower' }),
  P('QUALITY', 'CV1M', 'CV 1 m', 'CV1m', '%', 2, ['DFB', 'DFF'], 'Thickness variation over 1 m lengths.', { better: 'lower' }),
  P('QUALITY', 'CV3M', 'CV 3 m', 'CV3m', '%', 2, ['DFB', 'DFF'], 'Thickness variation over 3 m lengths.', { better: 'lower' }),
  P('QUALITY', 'CV10M', 'CV 10 m', 'CV10m', '%', 2, ['DFB', 'DFF'], 'Thickness variation over 10 m lengths.', { better: 'lower' }),
  P('QUALITY', 'A', 'A%', 'A%', '%', 2, SLIVER, 'Area irregularity of the sliver. Lower is better.', { better: 'lower' }),
  P('QUALITY', 'NOIL_PCT', 'Comber noil', 'Noil', '%', 1, ['COMB'], 'Share of short fibres combed out.', { better: 'target' }),
  P('QUALITY', 'LAP_NEPS', 'Lap neps', 'LapNeps', '/g', 0, ['COMB'], 'Fibre knots in the comber lap.', { better: 'lower' }),
  P('QUALITY', 'SLV_NEPS', 'Sliver neps', 'SlvNeps', '/g', 0, ['COMB'], 'Fibre knots in the combed sliver.', { better: 'lower' }),
  P('QUALITY', 'TPI', 'Twist (TPI)', 'TPI', 'tpi', 2, ['FF', 'RF'], 'Twists per inch – affects strength and feel.', { better: 'target' }),
  P('QUALITY', 'MOIST_ROV', 'Roving moisture', 'Moist', '%', 1, ['FF'], 'Water content of the roving.', { better: 'target' }),
  P('QUALITY', 'COUNT', 'Actual count', 'Count', 'Ne', 2, ['RF'], 'Yarn thickness (higher = finer). Should match the count ordered.', { better: 'target' }),
  P('QUALITY', 'COUNT_CV', 'Count CV%', 'CntCV', '%', 2, ['RF'], 'Variation of count between bobbins. Lower is better.', { better: 'lower' }),
  P('QUALITY', 'THIN', 'Thin places (−50%)', 'Thin', '/km', 0, ['RF', 'AW'], 'Weak thin spots per km of yarn.', { better: 'lower' }),
  P('QUALITY', 'THICK', 'Thick places (+50%)', 'Thick', '/km', 0, ['RF', 'AW'], 'Thick spots per km of yarn.', { better: 'lower' }),
  P('QUALITY', 'NEPS', 'Neps (+200%)', 'Neps', '/km', 0, ['RF', 'AW'], 'Small knots per km of yarn – visible as specks in fabric.', { better: 'lower' }),
  P('QUALITY', 'IPI', 'Total IPI', 'IPI', '/km', 0, ['RF'], 'Total imperfections per km (thin + thick + neps).', { better: 'lower' }),
  P('QUALITY', 'H', 'Hairiness H', 'H', '', 2, ['RF', 'AW'], 'Average length of fibres sticking out of the yarn. Lower H = smoother yarn.', { better: 'lower' }),
  P('QUALITY', 'S3', 'Hairiness S3', 'S3', '', 0, ['RF', 'AW'], 'Number of long protruding fibres (3 mm+) per 100 m. These cause fuzz and pilling.', { better: 'lower' }),
  P('QUALITY', 'RKM', 'Tenacity (RKM)', 'RKM', 'cN/tex', 2, ['RF'], 'Yarn strength relative to thickness. Higher is stronger.', { better: 'higher' }),
  P('QUALITY', 'CSP', 'Count strength product', 'CSP', '', 0, ['RF'], 'Overall strength index (count × lea strength).', { better: 'higher' }),
  P('QUALITY', 'ELONG', 'Elongation', 'Elong', '%', 2, ['RF'], 'How far the yarn stretches before it breaks.', { better: 'target' }),
  P('QUALITY', 'TPI_CV', 'TPI CV%', 'TPI CV', '%', 2, ['RF'], 'Variation of twist. Lower is better.', { better: 'lower' }),
  P('QUALITY', 'CUTS_NEP', 'Clearer cuts – neps', 'CutNep', '/100km', 1, ['AW'], 'Yarn cuts at the winder to remove neps, per 100 km.', { better: 'lower' }),
  P('QUALITY', 'CUTS_SHORT', 'Clearer cuts – short thick', 'CutS', '/100km', 1, ['AW'], 'Cuts to remove short thick places.', { better: 'lower' }),
  P('QUALITY', 'CUTS_LONG', 'Clearer cuts – long thick', 'CutL', '/100km', 1, ['AW'], 'Cuts to remove long thick places.', { better: 'lower' }),
  P('QUALITY', 'CUTS_THIN', 'Clearer cuts – thin', 'CutT', '/100km', 1, ['AW'], 'Cuts to remove thin places.', { better: 'lower' }),
  P('QUALITY', 'SPLICE_STR', 'Splice strength', 'Splice', '%', 1, ['AW'], 'Strength of the joint compared with the yarn.', { better: 'higher' }),
  P('QUALITY', 'SHADE_FAULTS', 'Shade faults', 'Shade', '/100km', 1, ['AW'], 'Cuts to remove colour-different yarn.', { better: 'lower' }),
  P('QUALITY', 'CONTAM_CUTS', 'Contamination cuts', 'Contam', '/100km', 1, ['AW'], 'Cuts to remove foreign fibres (plastic, jute, etc.).', { better: 'lower' }),

  // ---------- production: stage-level (every machine stage)
  P('PRODUCTION', 'YIELD_PCT', 'Stage yield', 'Yield', '%', 1, ALL_MACH, 'Share of the material fed that came out as good product.', { better: 'higher' }),
  P('PRODUCTION', 'WASTE_PCT', 'Waste', 'Waste', '%', 2, ALL_MACH, 'Share of material lost as waste at this stage.', { better: 'lower' }),
  P('PRODUCTION', 'EFF_PCT', 'Machine efficiency', 'Eff', '%', 1, ALL_MACH, 'Time the machine actually ran compared with the time it could have run.', { better: 'higher' }),
  P('PRODUCTION', 'UTIL_PCT', 'Utilization', 'Util', '%', 1, ALL_MACH, 'Share of the machine capacity that was used.', { better: 'higher' }),
  P('PRODUCTION', 'STOPPAGES', 'Stoppages per shift', 'Stops', '/shift', 0, ALL_MACH, 'Number of unplanned stops.', { better: 'lower' }),
  P('PRODUCTION', 'KWH_KG', 'Power consumption', 'kWh/kg', 'kWh/kg', 2, ALL_MACH, 'Electricity used per kg of product.', { better: 'lower', optional: true }),
  P('PRODUCTION', 'PROD_KG_SHIFT', 'Production per shift', 'Kg/shift', 'kg', 0, ALL_MACH, 'Output in one 8-hour shift.', { better: 'higher' }),
  P('PRODUCTION', 'RH_PCT', 'Humidity', 'RH', '%', 0, ['BR', 'CARD', 'FF', 'RF', 'AW'], 'Air humidity in the department.', { better: 'target' }),
  P('PRODUCTION', 'TEMP_C', 'Temperature', 'Temp', '°C', 1, ['BR', 'CARD', 'FF', 'RF', 'AW'], 'Air temperature in the department.', { better: 'target', optional: true }),
  // blow room
  P('PRODUCTION', 'BEATER_RPM', 'Beater speed', 'Beater', 'rpm', 0, ['BR'], 'Speed of the opening beater.', { better: 'target' }),
  P('PRODUCTION', 'FEED_RATE', 'Production rate', 'Rate', 'kg/h', 0, ['BR'], 'Blow room line throughput.', { better: 'target' }),
  // carding
  P('PRODUCTION', 'CARD_RATE', 'Card production rate', 'Rate', 'kg/h', 1, ['CARD'], 'Output per card per hour.', { better: 'target' }),
  P('PRODUCTION', 'DEL_SPEED', 'Delivery speed', 'Del', 'm/min', 0, ['CARD', 'DFB', 'DFF'], 'Speed at which sliver leaves the machine.', { better: 'target' }),
  P('PRODUCTION', 'CYL_RPM', 'Cylinder speed', 'Cyl', 'rpm', 0, ['CARD'], 'Card cylinder speed.', { better: 'target' }),
  P('PRODUCTION', 'LICKER_RPM', 'Licker-in speed', 'Licker', 'rpm', 0, ['CARD'], 'Speed of the licker-in.', { better: 'target' }),
  P('PRODUCTION', 'FLAT_SPEED', 'Flat speed', 'Flat', 'mm/min', 0, ['CARD'], 'Speed of the revolving flats.', { better: 'target' }),
  P('PRODUCTION', 'CYL_FLAT_GAUGE', 'Cylinder–flat gauge', 'Gauge', 'mm', 2, ['CARD'], 'Gap between cylinder and flats (roller/clothing setting).', { better: 'target' }),
  P('PRODUCTION', 'CARD_DRAFT', 'Card draft', 'Draft', '', 1, ['CARD'], 'Stretch applied in the card.', { better: 'target' }),
  P('PRODUCTION', 'FLAT_STRIP_PCT', 'Flat strips', 'Strips', '%', 2, ['CARD'], 'Waste removed with the flat strips.', { better: 'lower' }),
  // drawing
  P('PRODUCTION', 'TOTAL_DRAFT', 'Total draft', 'Draft', '', 2, ['DFB', 'DFF', 'FF', 'RF'], 'Total stretch applied at this stage.', { better: 'target' }),
  P('PRODUCTION', 'BREAK_DRAFT', 'Break draft', 'BD', '', 2, ['DFB', 'DFF', 'FF', 'RF'], 'Stretch in the break-draft zone.', { better: 'target' }),
  P('PRODUCTION', 'ROLLER_GAUGE', 'Roller gauge', 'Gauge', 'mm', 1, ['DFB', 'DFF', 'FF', 'RF'], 'Distance between drafting rollers.', { better: 'target' }),
  P('PRODUCTION', 'DOUBLINGS', 'Doublings', 'Dbl', 'ends', 0, DRAWING, 'Number of slivers fed together.', { better: 'target' }),
  P('PRODUCTION', 'HANK_SET', 'Hank setting', 'Hank', 'Ne', 3, ['DFB', 'DFF', 'FF'], 'Target thickness set on the machine.', { better: 'target' }),
  // comber
  P('PRODUCTION', 'NIPS_MIN', 'Nips per minute', 'Nips', 'npm', 0, ['COMB'], 'Comber speed.', { better: 'target' }),
  P('PRODUCTION', 'FEED_NIP', 'Feed per nip', 'Feed', 'mm', 2, ['COMB'], 'Length fed per combing cycle.', { better: 'target' }),
  P('PRODUCTION', 'COMB_RATE', 'Comber production rate', 'Rate', 'kg/h', 1, ['COMB'], 'Output per comber per hour.', { better: 'target' }),
  // fly frame + ring frame
  P('PRODUCTION', 'FLYER_RPM', 'Flyer speed', 'Flyer', 'rpm', 0, ['FF'], 'Speed of the flyers.', { better: 'target' }),
  P('PRODUCTION', 'TPI_SET', 'Twist setting (TPI)', 'TPI', 'tpi', 2, ['FF', 'RF'], 'Twist per inch set on the machine.', { better: 'target' }),
  P('PRODUCTION', 'SPINDLE_RPM', 'Spindle speed', 'Spindle', 'rpm', 0, ['RF'], 'Spindle speed. Running above the master raises hairiness and ends-down.', { better: 'target' }),
  P('PRODUCTION', 'RING_DIA', 'Ring diameter', 'Ring', 'mm', 1, ['RF'], 'Ring diameter fitted on the frame.', { better: 'target' }),
  P('PRODUCTION', 'BOBBIN_LEAD', 'Bobbin lead', 'Lead', 'mm', 1, ['RF'], 'Lead of bobbin over spindle.', { better: 'target', optional: true }),
  P('PRODUCTION', 'TOP_ARM_KG', 'Top arm pressure', 'TopArm', 'kg', 1, ['RF'], 'Weight loading on the drafting top rollers.', { better: 'target' }),
  P('PRODUCTION', 'BREAKS_100SH', 'Breaks per 100 spindle-hours', 'Breaks', '/100sh', 1, ['FF', 'RF'], 'Yarn / roving breakages – lower is better.', { better: 'lower' }),
  // winding
  P('PRODUCTION', 'WIND_SPEED', 'Winding speed', 'Wind', 'm/min', 0, ['AW'], 'Speed of winding.', { better: 'target' }),
  P('PRODUCTION', 'TENSION', 'Winding tension', 'Tension', 'cN', 1, ['AW'], 'Tension applied while winding.', { better: 'target', optional: true }),
  P('PRODUCTION', 'SPLICE_AIR', 'Splicer air pressure', 'Splice', 'bar', 1, ['AW'], 'Air pressure used to splice yarn ends.', { better: 'target', optional: true }),

  // ---------- accessories (age of shop-floor accessories at run time; packing specification)
  P('ACCESSORY', 'TRAVELLER_AGE_DAYS', 'Traveller age', 'Trav age', 'days', 0, ['RF'], 'Days since the ring travellers were changed. Worn travellers cause hairiness and breaks.', { better: 'lower' }),
  P('ACCESSORY', 'COT_BUFF_AGE_DAYS', 'Cots – days since buffing', 'Buff age', 'days', 0, ['DFB', 'DFF', 'FF', 'RF'], 'Days since the top-roller cots were last buffed.', { better: 'lower' }),
  P('ACCESSORY', 'COT_AGE_DAYS', 'Cots – age', 'Cot age', 'days', 0, ['DFB', 'DFF', 'FF', 'RF'], 'Days since the cots were replaced.', { better: 'lower' }),
  P('ACCESSORY', 'APRON_AGE_DAYS', 'Aprons – age', 'Apron age', 'days', 0, ['FF', 'RF'], 'Days since the aprons were replaced.', { better: 'lower' }),
  P('ACCESSORY', 'SPACER_MM', 'Spacer size', 'Spacer', 'mm', 2, ['RF'], 'Spacer between the roller nips.', { better: 'target' }),
  P('ACCESSORY', 'WIRE_AGE_DAYS', 'Card wire – age', 'Wire age', 'days', 0, ['CARD'], 'Days since the card clothing was changed.', { better: 'lower' }),
  P('ACCESSORY', 'FLAT_GRIND_AGE_DAYS', 'Flats – days since grinding', 'Grind age', 'days', 0, ['CARD'], 'Days since the card flats were ground.', { better: 'lower' }),
  P('ACCESSORY', 'NET_WT_CONE', 'Net weight per cone', 'Cone kg', 'kg', 2, ['PACK'], 'Weight of yarn on each cone.', { better: 'target' }),
  P('ACCESSORY', 'CONES_PER_CARTON', 'Cones per carton', 'Cones', 'cones', 0, ['PACK'], 'Number of cones packed in one carton.', { better: 'target' }),
  P('ACCESSORY', 'CARTON_TARE', 'Carton + packing tare', 'Tare', 'kg', 2, ['PACK'], 'Weight of the carton, polybag and cone separators.', { better: 'target' }),
  P('ACCESSORY', 'CARTON_NET', 'Net weight per carton', 'Net', 'kg', 2, ['PACK'], 'Yarn weight per carton.', { better: 'target' }),
  P('ACCESSORY', 'CARTON_GROSS', 'Gross weight per carton', 'Gross', 'kg', 2, ['PACK'], 'Total weight of a packed carton.', { better: 'target' }),
];

export const PARAM_MAP: Record<string, ParamDef[]> = {};
for (const p of PARAMS) (PARAM_MAP[p.key] ||= []).push(p);

/** Parameter definition for a key (first match; kinds never share keys). */
export function paramDef(key: string): ParamDef | undefined {
  return PARAM_MAP[key]?.[0];
}

export function paramLabel(key: string): string {
  return paramDef(key)?.label ?? key;
}

export function formatParam(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: paramDef(key)?.decimals ?? 2, maximumFractionDigits: paramDef(key)?.decimals ?? 2 });
}

export function paramsFor(stage: Stage, kind?: ParamKind): ParamDef[] {
  return PARAMS.filter((p) => p.stages.includes(stage) && (!kind || p.kind === kind));
}

/** Master type that judges a parameter kind. */
export function masterTypeOf(kind: ParamKind): MasterType {
  return MASTER_OF_KIND[kind];
}

export interface TemplateItem { master: MasterType; scope: Scope; key: string; required: boolean }

/** Every (master, scope, key) a complete master for a count has. COMB items exist only when the count uses a comber. */
export function masterTemplate(usesComber: boolean): TemplateItem[] {
  const out: TemplateItem[] = [];
  for (const p of PARAMS) {
    for (const stage of p.stages) {
      if (stage === 'COMB' && !usesComber) continue;
      out.push({ master: masterTypeOf(p.kind), scope: stage, key: p.key, required: !p.optional });
    }
  }
  for (const p of PARAMS.filter((x) => x.kind === 'FIBRE')) out.push({ master: 'COUNT_MIX', scope: 'MIX', key: p.key, required: true });
  return out;
}

/** Test-parameter keys relevant to lot-level release, by stage. */
export const QUALITY_KEYS_BY_STAGE: Record<string, string[]> = Object.fromEntries(
  MACHINE_STAGES.map((s) => [s, PARAMS.filter((p) => (p.kind === 'QUALITY' || p.kind === 'FIBRE') && p.stages.includes(s)).map((p) => p.key)]),
);

// ------------------------------------------------------------------ accessories on machines
export const ACCESSORY_KINDS = ['TRAVELLER', 'COT', 'COT_BUFF', 'APRON', 'SPACER', 'CARD_WIRE', 'FLAT_GRIND'] as const;
export type AccessoryKind = (typeof ACCESSORY_KINDS)[number];

export const ACCESSORY_INFO: Record<AccessoryKind, { label: string; param: string; stages: Stage[] }> = {
  TRAVELLER: { label: 'Traveller', param: 'TRAVELLER_AGE_DAYS', stages: ['RF'] },
  COT: { label: 'Top-roller cots (replaced)', param: 'COT_AGE_DAYS', stages: ['DFB', 'DFF', 'FF', 'RF'] },
  COT_BUFF: { label: 'Top-roller cots (buffed)', param: 'COT_BUFF_AGE_DAYS', stages: ['DFB', 'DFF', 'FF', 'RF'] },
  APRON: { label: 'Aprons', param: 'APRON_AGE_DAYS', stages: ['FF', 'RF'] },
  SPACER: { label: 'Spacer', param: 'SPACER_MM', stages: ['RF'] },
  CARD_WIRE: { label: 'Card clothing (wire)', param: 'WIRE_AGE_DAYS', stages: ['CARD'] },
  FLAT_GRIND: { label: 'Flats ground', param: 'FLAT_GRIND_AGE_DAYS', stages: ['CARD'] },
};

// ------------------------------------------------------------------ complaints
export const COMPLAINT_TYPES = [
  'HAIRINESS', 'COUNT_VARIATION', 'EVENNESS', 'THIN_THICK_NEPS', 'STRENGTH', 'CONTAMINATION', 'SHADE', 'PACKING_COLOR', 'SHORT_WEIGHT', 'OTHER',
] as const;
export type ComplaintType = (typeof COMPLAINT_TYPES)[number];

export const COMPLAINT_TYPE_LABEL: Record<ComplaintType, string> = {
  HAIRINESS: 'Hairiness',
  COUNT_VARIATION: 'Count variation',
  EVENNESS: 'U% / evenness',
  THIN_THICK_NEPS: 'Thin / thick / neps',
  STRENGTH: 'Strength',
  CONTAMINATION: 'Contamination',
  SHADE: 'Shade / colour mix-up',
  PACKING_COLOR: 'Packing / cone colour',
  SHORT_WEIGHT: 'Short weight',
  OTHER: 'Other',
};

export type ComplaintStatus = 'OPEN' | 'UNDER_ANALYSIS' | 'RESOLVED';
export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = { OPEN: 'Open', UNDER_ANALYSIS: 'In progress', RESOLVED: 'Closed' };
export const COMPLAINT_STATUS_COLOR: Record<ComplaintStatus, 'red' | 'yellow' | 'green'> = { OPEN: 'red', UNDER_ANALYSIS: 'yellow', RESOLVED: 'green' };

export interface LensItem { stage: Stage; key: string; weight: number; why: string; /** which direction of deviation can cause the complaint (default: from the parameter's better-direction) */ dir?: 'high' | 'low' | 'both' }

/** Default Complaint-Type → relevant parameters mapping (the editable lens master is seeded from this). */
export const DEFAULT_LENS: Record<ComplaintType, LensItem[]> = {
  HAIRINESS: [
    { stage: 'RF', key: 'H', weight: 3, why: 'Hairiness H measured on the ring frame' },
    { stage: 'RF', key: 'S3', weight: 3, why: 'Long protruding fibres (S3)' },
    { stage: 'RF', key: 'SPINDLE_RPM', weight: 3, why: 'Higher spindle speed throws more fibre ends out' , dir: 'high' },
    { stage: 'RF', key: 'TRAVELLER_AGE_DAYS', weight: 3, why: 'Worn travellers scrape fibres off the yarn surface' , dir: 'high' },
    { stage: 'RF', key: 'TPI_SET', weight: 2, why: 'Low twist leaves more fibre ends free' , dir: 'low' },
    { stage: 'RF', key: 'RING_DIA', weight: 1, why: 'Ring diameter changes balloon tension' },
    { stage: 'RF', key: 'RH_PCT', weight: 1, why: 'Dry air raises hairiness' , dir: 'low' },
    { stage: 'BR', key: 'SFI', weight: 2, why: 'Short-fibre content of the mix' , dir: 'high' },
    { stage: 'AW', key: 'H', weight: 2, why: 'Hairiness after winding' },
    { stage: 'AW', key: 'WIND_SPEED', weight: 1, why: 'High winding speed adds hairiness' , dir: 'high' },
  ],
  COUNT_VARIATION: [
    { stage: 'RF', key: 'COUNT', weight: 3, why: 'Actual count at ring frame' },
    { stage: 'RF', key: 'COUNT_CV', weight: 3, why: 'Count CV between bobbins' },
    { stage: 'FF', key: 'HANK', weight: 2, why: 'Roving hank' },
    { stage: 'FF', key: 'HANK_CV', weight: 3, why: 'Roving hank variation' },
    { stage: 'RF', key: 'TOTAL_DRAFT', weight: 2, why: 'Ring-frame draft' },
    { stage: 'DFF', key: 'HANK', weight: 2, why: 'Finisher sliver hank' },
    { stage: 'DFF', key: 'CV3M', weight: 2, why: 'Medium-term sliver variation' },
    { stage: 'RF', key: 'COT_BUFF_AGE_DAYS', weight: 1, why: 'Worn cots give uneven drafting' },
  ],
  EVENNESS: [
    { stage: 'RF', key: 'U', weight: 3, why: 'Yarn U%' },
    { stage: 'RF', key: 'CV', weight: 3, why: 'Yarn CVm%' },
    { stage: 'FF', key: 'U', weight: 2, why: 'Roving U%' },
    { stage: 'DFF', key: 'U', weight: 2, why: 'Finisher sliver U%' },
    { stage: 'DFF', key: 'CV1M', weight: 2, why: 'Short-term sliver variation' },
    { stage: 'RF', key: 'BREAK_DRAFT', weight: 2, why: 'Break draft setting' },
    { stage: 'RF', key: 'ROLLER_GAUGE', weight: 1, why: 'Roller gauge' },
    { stage: 'RF', key: 'COT_BUFF_AGE_DAYS', weight: 2, why: 'Cot condition' },
  ],
  THIN_THICK_NEPS: [
    { stage: 'RF', key: 'THIN', weight: 3, why: 'Thin places' },
    { stage: 'RF', key: 'THICK', weight: 3, why: 'Thick places' },
    { stage: 'RF', key: 'NEPS', weight: 3, why: 'Neps in yarn' },
    { stage: 'CARD', key: 'NEPS_OUT', weight: 3, why: 'Neps after card' },
    { stage: 'CARD', key: 'NEP_REMOVAL', weight: 2, why: 'Card nep removal' },
    { stage: 'BR', key: 'NEPS_AFTER', weight: 2, why: 'Neps after blow room' },
    { stage: 'AW', key: 'CUTS_NEP', weight: 2, why: 'Clearer cuts for neps' },
  ],
  STRENGTH: [
    { stage: 'RF', key: 'RKM', weight: 3, why: 'Yarn tenacity' },
    { stage: 'RF', key: 'CSP', weight: 3, why: 'Count-strength product' },
    { stage: 'RF', key: 'TPI', weight: 3, why: 'Actual twist' },
    { stage: 'RF', key: 'TPI_SET', weight: 2, why: 'Twist setting' },
    { stage: 'BR', key: 'STR', weight: 2, why: 'Fibre strength of the mix' },
    { stage: 'BR', key: 'UHML', weight: 2, why: 'Fibre length of the mix' },
    { stage: 'AW', key: 'SPLICE_STR', weight: 1, why: 'Splice strength' },
  ],
  CONTAMINATION: [
    { stage: 'AW', key: 'CONTAM_CUTS', weight: 3, why: 'Foreign-fibre cuts at winder' },
    { stage: 'BR', key: 'TRASH', weight: 2, why: 'Trash in the mix' },
    { stage: 'BR', key: 'CLEAN_EFF', weight: 2, why: 'Blow-room cleaning efficiency' },
    { stage: 'CARD', key: 'TRASH_OUT', weight: 2, why: 'Trash after card' },
  ],
  SHADE: [
    { stage: 'BR', key: 'RD', weight: 3, why: 'Cotton brightness of the mix' },
    { stage: 'BR', key: 'PLUS_B', weight: 3, why: 'Cotton yellowness of the mix' },
    { stage: 'AW', key: 'SHADE_FAULTS', weight: 3, why: 'Shade cuts at winder' },
    { stage: 'PACK', key: 'NET_WT_CONE', weight: 0, why: 'Cone colour verification is checked at packing' },
  ],
  PACKING_COLOR: [
    { stage: 'PACK', key: 'CONES_PER_CARTON', weight: 2, why: 'Cones per carton vs master' },
    { stage: 'PACK', key: 'CARTON_NET', weight: 2, why: 'Net weight per carton' },
  ],
  SHORT_WEIGHT: [
    { stage: 'PACK', key: 'NET_WT_CONE', weight: 3, why: 'Net weight per cone' },
    { stage: 'PACK', key: 'CARTON_NET', weight: 3, why: 'Net weight per carton' },
    { stage: 'PACK', key: 'CARTON_TARE', weight: 2, why: 'Tare weight used' },
    { stage: 'PACK', key: 'CARTON_GROSS', weight: 2, why: 'Gross weight per carton' },
  ],
  OTHER: [
    { stage: 'RF', key: 'U', weight: 2, why: 'Yarn U%' },
    { stage: 'RF', key: 'IPI', weight: 2, why: 'Imperfections' },
    { stage: 'RF', key: 'H', weight: 2, why: 'Hairiness' },
    { stage: 'RF', key: 'CSP', weight: 2, why: 'Strength' },
  ],
};
