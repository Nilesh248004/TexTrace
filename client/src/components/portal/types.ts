// Response shapes of /api/portal/* (see server/api/portal.ts). Lot passports reuse LotPassport from shared/domain.
import type { ComplaintStatus, ComplaintType } from '@shared/params';
import type { OnChainRef } from '@shared/types';

export interface PortalSummary {
  customer: { id: string; name: string; city: string; contactName: string };
  orders: number;
  orderedKg: number;
  lots: number;
  inTransit: number;
  delivered: number;
  deliveredKg: number;
  complaints: { open: number; inProgress: number; closed: number };
}

export interface PortalOrder {
  id: string;
  orderNo: string;
  poNo: string;
  countId: string;
  qtyKg: number;
  sentKg: number;
  orderedAt: string;
  dueDate: string;
  status: 'OPEN' | 'PARTIAL' | 'COMPLETE' | string;
}

export interface PortalDispatch {
  id: string;
  dispatchNo: string;
  orderNo: string | null;
  countId: string;
  dispatchedAt: string;
  deliveredAt: string | null;
  invoiceNo: string;
  vehicleNo: string;
  transporter: string;
  lrNo: string;
  destination: string;
  cartons: number;
  conesCount: number;
  netKg: number;
  grossKg: number;
  status: 'DISPATCHED' | 'DELIVERED' | string;
  passportCode: string;
  lots: { lotId: string; lotNo: string; kg: number }[];
}

export interface PortalLotRow {
  id: string;
  lotNo: string;
  countId: string;
  countDisplay: string;
  kg: number;
  dispatchNo: string;
  dispatchedAt: string;
  deliveredAt: string | null;
  status: string;
  cartonFrom: string | null;
  cartonTo: string | null;
  tests: { total: number; withinSpec: number; warning: number; outOfSpec: number };
  complaints: number;
  chain: OnChainRef;
}

export interface PortalComplaint {
  id: string;
  complaintNo: string;
  type: ComplaintType;
  typeLabel: string;
  source: string;
  status: ComplaintStatus;
  customerId: string;
  customerName: string;
  lotId: string;
  lotNo: string;
  countId: string;
  dispatchId: string | null;
  description: string;
  receivedDate: string;
  createdAt: string;
  updatedAt: string;
  complainant: string;
  createdByName: string;
  documentId: string | null;
  repeatCount: number;
  chain: OnChainRef;
}

export interface PortalComplaintDetail {
  complaint: PortalComplaint;
  steps: { at: string; status: ComplaintStatus; text: string }[];
  summary: { rootCause: string; correctiveAction: string; reply: string; closedAt: string } | null;
  document: { id: string; filename: string; mimeType: string; url: string } | null;
}

export interface LotSearchHit { lotId: string; lotNo: string; countDisplay: string; dispatchNo: string; dispatchedAt: string }

export interface MetaLite { millName: string; now: string; counts: { id: string; label: string; display: string }[] }
