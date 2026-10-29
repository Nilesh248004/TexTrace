import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DevTrace, Role } from '@shared/types';

export interface User { id: string; username: string; name: string; role: Role; org: string; title: string; customerId: string | null }

interface SessionState { token: string | null; user: User | null; set: (token: string, user: User) => void; clear: () => void }
/** persisted under `textrace.session` ({ state: { token, user } }) — scripts/shot.ts seeds the same key */
export const useSession = create<SessionState>()(persist((set) => ({ token: null, user: null, set: (token, user) => set({ token, user }), clear: () => set({ token: null, user: null }) }), { name: 'textrace.session', partialize: (s) => ({ token: s.token, user: s.user }) }));

export type JudgeMode = 'asOf' | 'latest';
interface UiState { theme: 'light' | 'dark'; dev: boolean; count: string; judge: JudgeMode; setTheme: (t: 'light' | 'dark') => void; setDev: (v: boolean) => void; setCount: (c: string) => void; setJudge: (m: JudgeMode) => void }
export const useUi = create<UiState>()(persist((set) => ({ theme: 'light', dev: false, count: 'ALL', judge: 'asOf', setTheme: (theme) => set({ theme }), setDev: (dev) => set({ dev }), setCount: (count) => set({ count }), setJudge: (judge) => set({ judge }) }), { name: 'textrace.ui' }));

export interface TraceNote { id: number; label: string; trace: DevTrace }
interface TraceState { notes: TraceNote[]; push: (label: string, trace: DevTrace) => void; dismiss: (id: number) => void }
let seq = 0;
export const useTraces = create<TraceState>((set) => ({
  notes: [],
  push: (label, trace) => { const id = ++seq; set((s) => ({ notes: [...s.notes.slice(-2), { id, label, trace }] })); setTimeout(() => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })), 11000); },
  dismiss: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
}));

interface LiveState { height: number | null; online: boolean; set: (p: Partial<Pick<LiveState, 'height' | 'online'>>) => void }
export const useLive = create<LiveState>((set) => ({ height: null, online: false, set: (p) => set(p) }));
