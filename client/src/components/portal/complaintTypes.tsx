import { Activity, Bug, CircleDot, Droplets, Feather, Gauge, MessageCircleQuestion, Package, Ruler, Scale, type LucideIcon } from 'lucide-react';
import { COMPLAINT_TYPE_LABEL, type ComplaintType } from '@shared/params';

/** Customer wording + one-line explanation for each issue type (the official label stays in COMPLAINT_TYPE_LABEL). */
export const TYPE_UI: Record<ComplaintType, { title: string; hint: string; Icon: LucideIcon }> = {
  HAIRINESS: { title: 'Hairiness', hint: 'Fuzzy yarn — loose fibres stick out of the surface.', Icon: Feather },
  COUNT_VARIATION: { title: 'Count variation', hint: 'The yarn is thicker or thinner than the count you ordered.', Icon: Ruler },
  EVENNESS: { title: 'Uneven yarn (U%)', hint: 'Streaks, bars or cloudy patches in the fabric.', Icon: Activity },
  THIN_THICK_NEPS: { title: 'Thin, thick places or neps', hint: 'Weak thin spots, fat lumps or tiny knots in the yarn.', Icon: CircleDot },
  STRENGTH: { title: 'Strength', hint: 'The yarn breaks more often than it should on your machines.', Icon: Gauge },
  CONTAMINATION: { title: 'Contamination', hint: 'Foreign material in the yarn — plastic, jute, leaf or dirt.', Icon: Bug },
  SHADE: { title: 'Shade or colour mix-up', hint: 'Some cones are a different shade from the rest.', Icon: Droplets },
  PACKING_COLOR: { title: 'Packing or cone colour', hint: 'Damaged cartons, wrong labels or the wrong cone-tip colour.', Icon: Package },
  SHORT_WEIGHT: { title: 'Short weight', hint: 'Cartons or cones weigh less than they should.', Icon: Scale },
  OTHER: { title: 'Other', hint: 'Something else — tell us in your own words.', Icon: MessageCircleQuestion },
};

export const typeTitle = (t: string): string => TYPE_UI[t as ComplaintType]?.title ?? COMPLAINT_TYPE_LABEL[t as ComplaintType] ?? t;
