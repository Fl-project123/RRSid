import { Station, SwitchWesel, SignalBlock, SignalColor, LineDirection, TrackType } from '../types';

export const TRACK_SPACING = 30;

export interface MappedStation {
  id: string;
  name: string;
  kp: number;
  branch: 'Utara' | 'Selatan' | 'Timur';
  x: number;
  yHilir: number;
  yHulu: number;
}

export interface MappedSwitch {
  id: string;
  stationId: string;
  kp: number;
  x: number;
  y: number;
  direction: LineDirection;
  state: 'straight' | 'diverging';
  targetY: number;
  type: 'diverge' | 'merge';
}

export interface MappedSignal {
  id: string;
  stationId: string;
  kp: number;
  x: number;
  y: number;
  direction: LineDirection;
  color: SignalColor;
  autoControl: boolean;
}

// 1. DATA STASIUN SKEMATIK (RRSid Line Map)
export const SCHEMATIC_STATIONS: MappedStation[] = [
  // Utara Branch
  { id: 'JAKK', name: 'Jakarta Kota', kp: 0.0, branch: 'Utara', x: 80, yHilir: 90, yHulu: 150 },
  { id: 'CIK', name: 'Cikini', kp: 8.0, branch: 'Utara', x: 280, yHilir: 90, yHulu: 150 },
  // Hub Center
  { id: 'MRI', name: 'Manggarai', kp: 9.8, branch: 'Utara', x: 400, yHilir: 150, yHulu: 210 },
  // Timur Branch (Sektor 4 / Cikarang Loop)
  { id: 'MTR', name: 'Matraman', kp: 9.0, branch: 'Timur', x: 500, yHilir: 30, yHulu: 60 },
  { id: 'PJT', name: 'Pondok Jati', kp: 7.9, branch: 'Timur', x: 620, yHilir: 30, yHulu: 60 },
  { id: 'KRT', name: 'Kramat', kp: 6.6, branch: 'Timur', x: 740, yHilir: 30, yHulu: 60 },
  { id: 'GST', name: 'Gang Sentiong', kp: 5.4, branch: 'Timur', x: 860, yHilir: 30, yHulu: 60 },
  { id: 'PSN', name: 'Pasar Senen', kp: 4.0, branch: 'Timur', x: 980, yHilir: 30, yHulu: 60 },
  // Selatan Branch
  { id: 'DPK', name: 'Depok', kp: 32.0, branch: 'Selatan', x: 780, yHilir: 250, yHulu: 310 },
  { id: 'BOO', name: 'Bogor', kp: 54.8, branch: 'Selatan', x: 1120, yHilir: 250, yHulu: 310 }
];

// Helper Penentu Cabang Sektor Aktif
export function getActiveBranch(kp: number, routeBranch?: 'BogorLine' | 'CikarangLoop'): 'Utara' | 'Selatan' | 'Timur' {
  if (routeBranch === 'CikarangLoop') return 'Timur';
  return kp <= 9.8 ? 'Utara' : 'Selatan';
}

// Transformasi Interpolasi Koordinat (Sangat Presisi untuk Smooth Rendering)
export function getCoordinatesAtKp(kp: number, direction: LineDirection, routeBranch?: 'BogorLine' | 'CikarangLoop'): { x: number; y: number } {
  const branch = getActiveBranch(kp, routeBranch);
  let x = 400, y = 150;

  if (branch === 'Utara') {
    x = 80 + (kp / 9.8) * 320;
    y = direction === LineDirection.Hulu ? 150 : 90;
  } else if (branch === 'Timur') {
    // KP pada Timur Line mengecil menuju Pasar Senen (4.0)
    x = 400 + ((9.8 - kp) / 5.8) * 580;
    y = direction === LineDirection.Hulu ? 60 : 30;
  } else {
    x = 400 + ((kp - 9.8) / 45.0) * 720;
    y = direction === LineDirection.Hulu ? 310 : 250;
  }
  return { x: Math.max(80, Math.min(1200, x)), y };
}

// 2. PEMETAAN WESEL DEKLARATIF DENGAN KOREKSI ARAH LINTAS (DIR-MULT)
export const SCHEMATIC_SWITCHES: MappedSwitch[] = SCHEMATIC_STATIONS.flatMap((st) => {
  const isTimur = st.branch === 'Timur';
  // Balikkan kalkulasi offset khusus untuk lintas Timur agar wesel tidak terbalik lokasinya
  const dirMult = isTimur ? -1 : 1;

  const baseSwitches: MappedSwitch[] = [
    // Hilir Masuk (In) & Keluar (Out)
    { id: `W-${st.id}-Hilir-In`, stationId: st.id, kp: st.kp - (0.1 * dirMult), x: st.x - 60, y: st.yHilir, direction: LineDirection.Hilir, state: 'straight', targetY: st.yHilir - 15, type: 'diverge' },
    { id: `W-${st.id}-Hilir-Out`, stationId: st.id, kp: st.kp + (0.1 * dirMult), x: st.x + 60, y: st.yHilir - 15, direction: LineDirection.Hilir, state: 'straight', targetY: st.yHilir, type: 'merge' },
    // Hulu Masuk (In) & Keluar (Out)
    { id: `W-${st.id}-Hulu-In`, stationId: st.id, kp: st.kp + (0.1 * dirMult), x: st.x + 60, y: st.yHulu, direction: LineDirection.Hulu, state: 'straight', targetY: st.yHulu + 15, type: 'diverge' },
    { id: `W-${st.id}-Hulu-Out`, stationId: st.id, kp: st.kp - (0.1 * dirMult), x: st.x - 60, y: st.yHulu + 15, direction: LineDirection.Hulu, state: 'straight', targetY: st.yHulu, type: 'merge' }
  ];

  // Penempatan Crossover (Wesel Penyeberangan Utama)
  if (['JAKK', 'MRI', 'PSN', 'DPK', 'BOO'].includes(st.id)) {
    baseSwitches.push(
      { id: `W-${st.id}-XOver-Before`, stationId: st.id, kp: st.kp - (0.25 * dirMult), x: st.x - 120, y: st.yHilir, direction: LineDirection.Hilir, state: 'straight', targetY: st.yHulu, type: 'diverge' },
      { id: `W-${st.id}-XOver-After`, stationId: st.id, kp: st.kp + (0.25 * dirMult), x: st.x + 120, y: st.yHulu, direction: LineDirection.Hulu, state: 'straight', targetY: st.yHilir, type: 'diverge' }
    );
  }
  return baseSwitches;
});

// 3. PEMETAAN PERSINYALAN DENGAN SAFETY MARGIN OVERLAP
export const SCHEMATIC_SIGNALS: MappedSignal[] = SCHEMATIC_STATIONS.flatMap((st) => {
  const isTimur = st.branch === 'Timur';
  const dirMult = isTimur ? -1 : 1;

  return [
    // Sinyal Keluar Peron Hilir
    { id: `S-${st.id}-Hilir-Main`, stationId: st.id, kp: st.kp + (0.08 * dirMult), x: st.x + 40, y: st.yHilir, direction: LineDirection.Hilir, color: SignalColor.Red, autoControl: false },
    { id: `S-${st.id}-Hilir-Loop`, stationId: st.id, kp: st.kp + (0.08 * dirMult), x: st.x + 40, y: st.yHilir - 15, direction: LineDirection.Hilir, color: SignalColor.Red, autoControl: false },
    // Sinyal Keluar Peron Hulu
    { id: `S-${st.id}-Hulu-Main`, stationId: st.id, kp: st.kp - (0.08 * dirMult), x: st.x - 40, y: st.yHulu, direction: LineDirection.Hulu, color: SignalColor.Red, autoControl: false },
    { id: `S-${st.id}-Hulu-Loop`, stationId: st.id, kp: st.kp - (0.08 * dirMult), x: st.x - 40, y: st.yHulu + 15, direction: LineDirection.Hulu, color: SignalColor.Red, autoControl: false }
  ];
});

// Helper untuk menerjemahkan KP ke sumbu X di Kanvas
export function kpToX(kp: number, canvasWidth: number, routeBranch?: 'BogorLine' | 'CikarangLoop'): number {
  return getCoordinatesAtKp(kp, LineDirection.Hilir, routeBranch).x;
}

// 4. KEBIJAKAN NON E-BRAKE (Sistem Sanksi Poin Firebase Aktif)
export function checkSignalStop(): boolean {
  // Masinis yang melanggar Sinyal Merah (SPAD) langsung dikenai pinalti poin / auto-kick dari Firebase Rules,
  // sehingga penahanan laju paksa di frontend (auto-stop) ditiadakan agar lebih realistis seperti SOP Masinis sesungguhnya.
  return false;
}
