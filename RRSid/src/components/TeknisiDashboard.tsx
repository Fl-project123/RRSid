import React, { useState, useEffect } from 'react';
import { SignalBlock, SwitchWesel, Train, LineDirection, UserCareer, TrainType, Station } from '../types';
import { Compass, ShieldCheck, AlertTriangle, Play, LogOut, CheckCircle2, Siren, Wrench, Volume2, Anchor, Award, Radio, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import RealWorldMap from './RealWorldMap';
import { STATIONS } from '../data/tracks';
import { audio } from './AudioEngine';
import VhfRadioDinas from './VhfRadioDinas';
import RadioKomando from './RadioKomando';

interface TeknisiDashboardProps {
  signals: SignalBlock[];
  switches: SwitchWesel[];
  activeTrains: Train[];
  career: UserCareer;
  onUpdateTrain: (updated: Train, penalties: string[], isBanned: boolean, banReason?: string, coupledTrainIds?: string[]) => void;
  onExit: () => void;
  onSendChatMessage: (msg: string, sender: string) => void;
  onClearCollision: (trainId1: string, trainId2: string, stationKp: number, loriTrainId?: string) => void;
}

export default function TeknisiDashboard({
  signals,
  switches,
  activeTrains,
  career,
  onUpdateTrain,
  onExit,
  onSendChatMessage,
  onClearCollision,
}: TeknisiDashboardProps) {
  // Rescue train controlled by this technical player
  const [rescueTrain, setRescueTrain] = useState<Train | null>(null);

  // Keep a ref of rescueTrain to use in unmount cleanup
  const rescueTrainRef = React.useRef<Train | null>(null);
  useEffect(() => {
    rescueTrainRef.current = rescueTrain;
  }, [rescueTrain]);

  // Clean up rescue train on unmount
  useEffect(() => {
    return () => {
      if (rescueTrainRef.current) {
        onClearCollision('', '', 0, rescueTrainRef.current.id);
      }
    };
  }, []);

  const handleExit = () => {
    if (rescueTrain) {
      onClearCollision('', '', 0, rescueTrain.id);
    }
    onExit();
  };
  
  // Selected Incident & coupling status
  const [selectedIncident, setSelectedIncident] = useState<{
    id: string;
    type: 'collision';
    kp: number;
    desc: string;
    trainsInvolved: string[];
  } | null>(null);

  const [towing, setTowing] = useState<boolean>(false);
  const [evacSuccess, setEvacSuccess] = useState<boolean>(false);
  const [sleeperOffset, setSleeperOffset] = useState(0);
  const [showRadioPanel, setShowRadioPanel] = useState<boolean>(false);

  // Filter collided pairs from activeTrains
  const collidedTrains = activeTrains.filter(t => t.hasCollided);

  const activeIncidents: any[] = [];
  if (collidedTrains.length > 0) {
    const seen = new Set<string>();
    collidedTrains.forEach(t => {
      if (seen.has(t.id)) return;
      // find another train close to t.kp
      const partner = collidedTrains.find(ot => ot.id !== t.id && Math.abs(ot.kp - t.kp) < 0.45);
      if (partner) {
        seen.add(t.id);
        seen.add(partner.id);
        activeIncidents.push({
          id: `incident-collision-${t.id}-${partner.id}`,
          type: 'collision',
          kp: t.kp,
          desc: `💥 Tabrakan Hebat Sektor: ${t.name} dan ${partner.name}!`,
          trainsInvolved: [t.id, partner.id]
        });
      }
    });
  }

  // Auto-select first incident if none selected
  useEffect(() => {
    if (activeIncidents.length > 0 && !selectedIncident && !towing) {
      setSelectedIncident(activeIncidents[0]);
    }
  }, [activeIncidents, selectedIncident, towing]);

  // Find nearest station to collision point
  const getNearestStationToKp = (kp: number): Station => {
    return [...STATIONS].sort((a, b) => Math.abs(a.kp - kp) - Math.abs(b.kp - kp))[0];
  };

  const nearestStation = selectedIncident ? getNearestStationToKp(selectedIncident.kp) : STATIONS[2]; // MRI

  // Spawning a Rescue Lori at custom depot selectors
  const spawnRescueTrainAt = (kpStart: number, label: string) => {
    const rId = 'NR-LORI-' + Math.floor(100 + Math.random() * 900);
    const newRescue: Train = {
      id: rId,
      name: `Lori Rescue Derek CC 201 NR (${rId})`,
      type: TrainType.Langsir,
      isAI: false,
      driverName: career.username,
      direction: LineDirection.Hilir,
      kp: kpStart,
      speed: 0,
      maxSpeed: 65,
      targetSpeedLimit: 60,
      currentPlatformId: null,
      doorsOpen: false,
      throttle: 0,
      brake: 5,
      reverser: 'N',
      horn: false,
      emergencyBrake: false,
      currentTrackId: 'Main-Hilir',
      cargoType: 'Maintenance',
      lastStopKp: null,
      hasCollided: false,
      isBanned: false
    };

    setRescueTrain(newRescue);
    onUpdateTrain(newRescue, [], false);
    onSendChatMessage(`🛠️ [KREASI]: Teknisi ${career.username} selesai merakit Loko Penyelamat Darurat CC 201 NR (${rId}) di Sektor ${label}!`, 'Sistem Lintas');
  };

  // Click-clack sound effects for lori
  useEffect(() => {
    if (rescueTrain && rescueTrain.speed > 0) {
      audio.startClickClackLoop(rescueTrain.speed);
    } else {
      audio.stopClickClack();
    }
    return () => {
      audio.stopClickClack();
    };
  }, [rescueTrain?.speed]);

  // Animated perspective rail sleepers movement
  useEffect(() => {
    if (!rescueTrain || rescueTrain.speed === 0) return;
    const scrollInterval = setInterval(() => {
      setSleeperOffset(prev => (prev + (rescueTrain.speed / 5)) % 100);
    }, 45);
    return () => clearInterval(scrollInterval);
  }, [rescueTrain?.speed]);

  // Physics loop for rescue train
  useEffect(() => {
    if (!rescueTrain) return;

    const interval = setInterval(() => {
      // If fully braked and idle, nothing to do
      if (rescueTrain.brake > 0 && rescueTrain.speed === 0 && rescueTrain.throttle === 0) return;

      let acc = 0;
      if (rescueTrain.throttle > 0 && rescueTrain.reverser !== 'N') {
        const dir = rescueTrain.reverser === 'F' ? 1 : -1;
        // Towing with multi-car wreck slows down the speed
        const weightFactor = towing ? 0.35 : 1.0;
        acc = (rescueTrain.throttle / 5.0) * 4.2 * dir * weightFactor;
      }
      
      const brakeFactor = rescueTrain.brake / 5.0;
      if (rescueTrain.brake > 0) {
        acc -= 6.5 * brakeFactor * (rescueTrain.speed > 0 ? 1 : -1);
      }

      // Train rolling resistance
      if (rescueTrain.speed > 0) {
        acc -= towing ? 0.8 : 0.4;
      } else if (rescueTrain.speed < 0) {
        acc += towing ? 0.8 : 0.4;
      }

      let nextSp = rescueTrain.speed + acc * 0.25;
      if (nextSp < 0.2 && rescueTrain.reverser === 'N') nextSp = 0;
      if (nextSp < 0) nextSp = 0; // Absolute bound
      
      const speedCap = towing ? 40 : rescueTrain.maxSpeed; // Capped speed when towing heavily
      if (nextSp > speedCap) nextSp = speedCap;

      const kmPerSec = nextSp / 3600;
      let nextKp = rescueTrain.kp;
      
      // Drive direction based on reverser (F/R)
      if (rescueTrain.reverser === 'F') {
        nextKp += kmPerSec * 0.25;
      } else if (rescueTrain.reverser === 'R') {
        nextKp -= kmPerSec * 0.25;
      }

      // Hard boundaries of track map
      if (nextKp < 0.1) { nextKp = 0.1; nextSp = 0; }
      if (nextKp > 54.7) { nextKp = 54.7; nextSp = 0; }

      // Update crashed train coords in realtime to simulate dragging them
      const updated = {
        ...rescueTrain,
        speed: nextSp,
        kp: nextKp,
      };

      setRescueTrain(updated);
      
      // Broadcast other connected peers with wreck list if towing
      onUpdateTrain(
        updated, 
        [], 
        false, 
        undefined, 
        towing && selectedIncident ? selectedIncident.trainsInvolved : undefined
      );
    }, 250);

    return () => clearInterval(interval);
  }, [rescueTrain, towing, selectedIncident, onUpdateTrain]);

  const handleCoupleWreck = () => {
    if (!rescueTrain || !selectedIncident) return;
    setTowing(true);
    audio.playBrakeHiss();
    onSendChatMessage(`🔗 [RANTAI KOPEL]: Teknisi ${career.username} berhasil mengunci coupler derek ke badan kereta tabrakan di KM ${selectedIncident.kp.toFixed(2)} Sektor! Mempersiapkan evakuasi ke stasiun terdekat.`, 'Sistem Lintas');
  };

  const handleEvacComplete = () => {
    if (!selectedIncident || !rescueTrain) return;
    const currentNearest = getNearestStationToKp(rescueTrain.kp);
    
    // Clear and repair
    onClearCollision(selectedIncident.trainsInvolved[0], selectedIncident.trainsInvolved[1], currentNearest.kp, rescueTrain.id);
    onSendChatMessage(`✅ [KONDISI PULIH]: Teknisi ${career.username} tuntas mengevakuasi rangkaian sepur ke Stasiun ${currentNearest.name} (KM ${currentNearest.kp.toFixed(2)})! Seluruh sasis kereta dinyatakan prima dan siap meluncur kembali. (+200 PTS)`, 'Sistem Lintas');

    setEvacSuccess(true);
    setTowing(false);
    setSelectedIncident(null);
    setRescueTrain(null); // Despawn lori to clear lines
  };

  const playS35 = () => {
    audio.playSemboyan35();
  };

  const currentDistToIncident = selectedIncident && rescueTrain 
    ? Math.abs(rescueTrain.kp - selectedIncident.kp) 
    : 999;

  const currentDistToStation = rescueTrain
    ? Math.abs(rescueTrain.kp - nearestStation.kp)
    : 999;

  return (
    <div id="teknisi-dashboard" className="bg-[#030611] text-slate-100 min-h-screen flex flex-col font-sans select-none overflow-x-hidden">
      
      {/* 1. Header Bar Terminal */}
      <header className="bg-[#080d1a] border-b border-rose-950/20 px-4 py-3.5 flex justify-between items-center z-[1020] shadow-xl">
        <div className="flex items-center gap-3">
          <div className="bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20">
            <Wrench className="text-rose-500" size={20} />
          </div>
          <div>
            <h1 className="text-xs font-black tracking-widest text-[#f8fafc] uppercase font-mono flex items-center gap-2 leading-none">
              <span>DIVISI TEKNIS & KRAN PENYELAMATAN</span>
              <span className="text-[8px] bg-red-950 text-red-400 border border-red-900 px-1.5 py-0.5 rounded font-black uppercase tracking-normal leading-none animate-pulse">KRAN RESCUE</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-mono mt-1">Nama: {career.username} • Pangkat: {career.rank} • Skor: {career.points} Pts</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRadioPanel(!showRadioPanel)}
            className={`px-3.5 py-2 rounded-lg font-mono text-[10px] font-extrabold tracking-wider transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 uppercase ${
              showRadioPanel 
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg' 
                : 'bg-indigo-950 border border-indigo-900 text-indigo-400 hover:text-white'
            }`}
          >
            <Radio size={12} className={showRadioPanel ? 'animate-pulse' : ''} />
            <span>🎙️ ON-MIC</span>
          </button>

          <button 
            onClick={handleExit}
            className="bg-red-950/40 hover:bg-red-950/60 text-red-400 font-mono text-[10px] font-extrabold tracking-wider px-3.5 py-2 rounded-lg border border-red-900/40 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 uppercase"
          >
            <LogOut size={13} />
            <span>Keluar Lintas</span>
          </button>
        </div>
      </header>

      {/* Immediate screen-wide emergency overlay when collision arises but user hasn't spawned their lori */}
      {activeIncidents.length > 0 && !rescueTrain && !evacSuccess && (
        <div className="bg-red-950/20 border-b border-red-900/30 text-red-100 px-4 py-2.5 flex items-center justify-between text-xs font-mono font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <Siren className="text-red-400 animate-bounce" size={15} />
            <span>🚨 LAPORAN DARURAT: TERDETEKSI {activeIncidents.length} PLH TABRAKAN KERETA AKTIF PADA LINTASAN SEKUTU!</span>
          </div>
          <span className="text-[10px] bg-red-900 text-white px-2 py-0.5 rounded-sm uppercase">Harap Segera Dispatch Lori Penolong!</span>
        </div>
      )}

      {/* 2. Main Layout Grid */}
      <div className="flex-grow grid grid-cols-1 xl:grid-cols-12 gap-4 p-4 min-h-0">
        
        {/* LEFT COLUMN: Cockpit Windshield & Engine Manual controls */}
        <div className="xl:col-span-5 flex flex-col gap-4 min-h-0">
          
          {/* Main Cockpit and driving simulator console */}
          <div className="bg-[#070b15] border border-slate-900 rounded-2xl p-4 flex flex-col gap-3.5 flex-grow">
            <div className="flex justify-between items-center border-b border-slate-900 pb-2">
              <span className="text-[10.5px] text-indigo-400 font-black tracking-widest uppercase flex items-center gap-1.5 font-mono">
                <Compass size={14} /> DINAS KEMUDI MANUAL LOKO NR
              </span>
              {rescueTrain && (
                <span className="text-[9px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-900/30 px-2 py-0.5 rounded uppercase font-black">
                  STATUS: LIVE SIMULASI
                </span>
              )}
            </div>

            {!rescueTrain ? (
              <div className="flex-grow flex flex-col justify-center items-center text-center p-6 gap-5">
                <div className="bg-amber-600/10 p-4 rounded-full border border-amber-500/20 text-amber-500 animate-pulse">
                  <Anchor size={36} />
                </div>
                <div>
                  <h3 className="text-white font-mono font-black text-xs uppercase tracking-wider">GARASI PARALATAN NR BELUM DISALAHKAN</h3>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed max-w-sm font-sans mt-1.5">
                    Silakan berangkatkan derek lori penyelamat mekanik darurat CC 201 dengan memilih salah satu sektor depo terdekat dari titik terjadinya crash:
                  </p>
                </div>

                <div className="w-full space-y-2 max-w-sm">
                  <button
                    onClick={() => spawnRescueTrainAt(9.8, 'Utara (Manggarai)')}
                    className="w-full bg-[#1e293b] hover:bg-slate-800 text-[#cbd5e1] border border-slate-800 py-3 rounded-lg font-mono text-[10.5px] font-semibold text-left px-4 flex justify-between items-center"
                  >
                    <span>1. DEPO SEKTOR UTARA (MANGGARAI)</span>
                    <strong className="text-amber-500">KM 9.80</strong>
                  </button>

                  <button
                    onClick={() => spawnRescueTrainAt(31.5, 'Tengah (Depok)')}
                    className="w-full bg-[#1e293b] hover:bg-slate-800 text-[#cbd5e1] border border-slate-800 py-3 rounded-lg font-mono text-[10.5px] font-semibold text-left px-4 flex justify-between items-center"
                  >
                    <span>2. DEPO SEKTOR TENGAH (DEPOK)</span>
                    <strong className="text-amber-500">KM 31.50</strong>
                  </button>

                  <button
                    onClick={() => spawnRescueTrainAt(54.3, 'Selatan (Bogor)')}
                    className="w-full bg-[#1e293b] hover:bg-slate-800 text-[#cbd5e1] border border-slate-800 py-3 rounded-lg font-mono text-[10.5px] font-semibold text-left px-4 flex justify-between items-center"
                  >
                    <span>3. DEPO SEKTOR SELATAN (BOGOR)</span>
                    <strong className="text-amber-500">KM 54.30</strong>
                  </button>

                  <button
                    onClick={() => spawnRescueTrainAt(4.0, 'Timur (Pasar Senen)')}
                    className="w-full bg-[#1e293b] hover:bg-slate-800 text-[#cbd5e1] border border-slate-800 py-3 rounded-lg font-mono text-[10.5px] font-semibold text-left px-4 flex justify-between items-center"
                  >
                    <span>4. DEPO SEKTOR TIMUR (PASAR SENEN)</span>
                    <strong className="text-amber-500">KM 4.00</strong>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-grow flex flex-col gap-4 font-mono">
                
                {/* 3D-like Perspective Windshield View Screen */}
                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-800/80 bg-slate-950 shadow-inner group">
                  
                  {/* Visual simulated HUD readouts */}
                  <div className="absolute top-2.5 left-2.5 z-10 bg-black/75 border border-slate-800 px-2 py-1 rounded text-[9px] text-cyan-400 space-y-0.5">
                    <div>LOKO: <span className="text-white font-bold">CC201-NR-EVAC</span></div>
                    <div>SEKTOR_KM: <span className="text-white font-bold">{rescueTrain.kp.toFixed(3)}</span></div>
                    <div>TOW_LOCK: <span className={towing ? 'text-emerald-400 font-bold' : 'text-slate-450 font-normal'}>{towing ? 'CONNECTED 🔗' : 'UNCOUPLED 📴'}</span></div>
                  </div>

                  {/* Distance target indicators */}
                  {selectedIncident && (
                    <div className="absolute top-2.5 right-2.5 z-10 bg-black/75 border border-red-950 px-2 py-1 rounded text-[9px] text-red-400 space-y-0.5 text-right">
                      <div>TARGET_CRASH: <span className="text-white font-bold">KM {selectedIncident.kp.toFixed(2)}</span></div>
                      <div>JARAK: <span className="text-rose-500 font-black">{currentDistToIncident.toFixed(3)} KM</span></div>
                    </div>
                  )}

                  {/* Windshield vector drawing */}
                  <svg className="w-full h-full" viewBox="0 0 400 220" preserveAspectRatio="none">
                    
                    {/* Sky ambient sunset horizon lines */}
                    <rect width="400" height="110" fill="#04060d" />
                    <line x1="0" y1="110" x2="400" y2="110" stroke="#1e293b" strokeWidth="0.5" />
                    <radialGradient id="sun-glow" cx="50%" cy="100%" r="50%">
                      <stop offset="0%" stopColor="#fc5a5a" stopOpacity="0.1" />
                      <stop offset="100%" stopColor="#04060d" stopOpacity="0" />
                    </radialGradient>
                    <rect x="100" y="50" width="200" height="60" fill="url(#sun-glow)" />

                    {/* Rail Tracksperspectives lines merging slightly below center */}
                    <g stroke="#334155" strokeWidth="2.5">
                      <line x1="200" y1="110" x2="-20" y2="230" />
                      <line x1="200" y1="110" x2="420" y2="230" />
                    </g>
                    
                    {/* Track ballast shadow */}
                    <polygon points="200,110 400,225 0,225" fill="#0f172a" opacity="0.3" />

                    {/* Left and Right overhead power lines pylons */}
                    <line x1="50" y1="110" x2="-100" y2="220" stroke="#1e293b" />
                    <line x1="350" y1="110" x2="500" y2="220" stroke="#1e293b" />

                    {/* Animated Sleepers (wooden planks) flying down dynamically proportional to offset state */}
                    {rescueTrain.speed > 0 && Array.from({ length: 6 }).map((_, i) => {
                      const basePos = (i * 20 + sleeperOffset) % 100;
                      const ratio = basePos / 100;
                      
                      // Perspective interpolation
                      const y = 110 + ratio * 110;
                      const scale = ratio;
                      const x1 = 200 - scale * 260;
                      const x2 = 200 + scale * 260;
                      
                      return (
                        <line 
                          key={i} 
                          x1={x1} 
                          y1={y} 
                          x2={x2} 
                          y2={y} 
                          stroke="#1a2035" 
                          strokeWidth={2.5 * scale} 
                          opacity={scale} 
                        />
                      );
                    })}

                    {/* Sleeping still lines if static */}
                    {rescueTrain.speed === 0 && [30, 50, 70, 95].map((pos, idx) => {
                      const ratio = pos / 100;
                      const y = 110 + ratio * 110;
                      const x1 = 200 - ratio * 260;
                      const x2 = 200 + ratio * 260;
                      return (
                        <line 
                          key={idx} 
                          x1={x1} 
                          y1={y} 
                          x2={x2} 
                          y2={y} 
                          stroke="#101726" 
                          strokeWidth={1.5 + ratio * 1.5} 
                          opacity={0.8} 
                        />
                      );
                    })}

                    {/* Visual warning beacon icon flashing and smoking on horizon as they near crash */}
                    {selectedIncident && currentDistToIncident < 1.8 && (
                      <g>
                        {/* Scale based on closeness */}
                        {(() => {
                          const closeness = Math.max(0.1, 1.8 - currentDistToIncident) / 1.8;
                          const wreckSize = 10 + closeness * 65;
                          const x = 200;
                          const y = 110 + closeness * 90;
                          
                          return (
                            <g>
                              {/* Explosion glow rings */}
                              <circle 
                                cx={x} 
                                cy={y - 5} 
                                r={wreckSize * 0.75} 
                                fill="#ef4444" 
                                opacity={(Math.floor(Date.now() / 300) % 2) ? 0.25 : 0.05} 
                              />
                              
                              {/* Incident wreckage outlines */}
                              <rect 
                                x={x - wreckSize / 2} 
                                y={y - wreckSize / 2.5} 
                                width={wreckSize} 
                                height={wreckSize / 3} 
                                fill="#3f3f46" 
                                stroke="#18181b" 
                                strokeWidth="1" 
                                rx="1.5" 
                              />
                              <rect 
                                x={x - wreckSize / 3} 
                                y={y - wreckSize / 1.8} 
                                width={wreckSize * 0.6} 
                                height={wreckSize / 4} 
                                fill="#ef4444" 
                                stroke="#7f1d1d" 
                                strokeWidth="0.5" 
                                rx="1" 
                              />

                              {/* Wreckage Smoke plumes */}
                              <circle cx={x - wreckSize/3} cy={y - wreckSize/1.4} r={wreckSize/6} fill="#71717a" opacity="0.6" />
                              <circle cx={x + wreckSize/3} cy={y - wreckSize/1.6} r={wreckSize/8} fill="#52525b" opacity="0.75" />

                              {/* Hazardous high-voltage sparks */}
                              {(Math.floor(Date.now() / 150) % 3 === 0) && (
                                <path 
                                  d={`M ${x} ${y - 30} L ${x - 5} ${y - 15} L ${x + 5} ${y - 12}`} 
                                  stroke="#38bdf8" 
                                  strokeWidth="1.5" 
                                  fill="none" 
                                />
                              )}
                            </g>
                          );
                        })()}
                      </g>
                    )}
                  </svg>

                  {/* Heavy dark fog atmosphere gradient mask */}
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
                </div>

                {/* Dashboard stats display */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs mt-0.5">
                  <div className="bg-[#0b0f1a] p-3 rounded-lg border border-slate-900">
                    <div className="text-[8.5px] text-slate-500 uppercase tracking-widest leading-none mb-1">Speedometer (Kecepatan)</div>
                    <div className="text-xl font-bold tracking-tighter text-emerald-400">
                      {Math.round(rescueTrain.speed)} <span className="text-[10px] text-slate-500 font-normal">KM/H</span>
                    </div>
                  </div>

                  <div className="bg-[#0b0f1a] p-3 rounded-lg border border-slate-900">
                    <div className="text-[8.5px] text-slate-500 uppercase tracking-widest leading-none mb-1">Maks Speed Selubung</div>
                    <div className="text-xl font-bold tracking-tighter text-amber-500">
                      {towing ? '40' : '65'} <span className="text-[10px] text-slate-500 font-normal">KM/H</span>
                    </div>
                  </div>

                  <div className="bg-[#0b0f1a] p-3 rounded-lg border border-slate-900">
                    <div className="text-[8.5px] text-slate-500 uppercase tracking-widest leading-none mb-1">Target Lokasi (KM)</div>
                    <div className="text-xl font-bold tracking-tighter text-purple-400">
                      {selectedIncident ? selectedIncident.kp.toFixed(2) : '-.--'}
                    </div>
                  </div>
                </div>

                {/* Mechanical controls interface levers */}
                <div className="space-y-3.5 bg-[#080c16] p-3 rounded-xl border border-slate-900/50">
                  
                  {/* Reverser Lever (Direction selector) */}
                  <div>
                    <label className="text-[9px] text-[#475569] font-black block uppercase tracking-wiest mb-1 font-mono">Tuas Pembalik Arah (Reverser Lever)</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['R', 'N', 'F'] as const).map(dir => (
                        <button
                          key={dir}
                          onClick={() => setRescueTrain(prev => prev ? { ...prev, reverser: dir } : null)}
                          className={`py-2 text-[9.5px] font-black rounded-lg transition-all ${
                            rescueTrain.reverser === dir 
                              ? 'bg-amber-400 text-slate-950 font-black shadow-lg scale-95 border-b-2 border-amber-600' 
                              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {dir === 'F' ? 'FORWARD (MAJU)' : dir === 'R' ? 'REVERSE (MUNDUR)' : 'NEUTRAL (NETRAL)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Throttle Lever Buttons */}
                  <div>
                    <div className="flex justify-between items-center text-[9px] text-slate-400 mb-1">
                      <span className="font-extrabold uppercase">Daya Generator Notch Tenaga (Throttle)</span>
                      <span className="text-amber-500 font-bold font-mono">N{rescueTrain.throttle} / N5</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {Array.from({ length: 6 }).map((_, n) => (
                        <button
                          key={n}
                          onClick={() => setRescueTrain(prev => prev ? { ...prev, throttle: n, brake: n > 0 ? 0 : prev.brake } : null)}
                          className={`py-1.5 rounded-lg text-[9.5px] font-black transition-all ${
                            rescueTrain.throttle === n 
                              ? 'bg-amber-500 text-slate-950 font-black shadow border-b-2 border-amber-700' 
                              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          N{n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pneumatic Brakes Lever Buttons */}
                  <div>
                    <div className="flex justify-between items-center text-[9px] text-slate-400 mb-1">
                      <span className="font-extrabold uppercase font-mono">Tuas Rem Udara Teknis (Pneumatic Air Brake)</span>
                      <span className="text-cyan-400 font-bold font-mono">B{rescueTrain.brake} / B5</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {Array.from({ length: 6 }).map((_, b) => (
                        <button
                          key={b}
                          onClick={() => {
                            setRescueTrain(prev => prev ? { ...prev, brake: b, throttle: b > 0 ? 0 : prev.throttle } : null);
                            if (b > 0) audio.playBrakeHiss();
                          }}
                          className={`py-1.5 rounded-lg text-[9.5px] font-black transition-all ${
                            rescueTrain.brake === b 
                              ? 'bg-cyan-500 text-slate-950 font-black shadow border-b-2 border-cyan-700' 
                              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          B{b}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Klaxon Horn and Brake release buttons */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={playS35}
                      className="bg-emerald-500 hover:bg-emerald-400 transition-colors text-slate-950 font-mono font-black py-2.5 rounded-lg text-[10px] uppercase flex items-center justify-center gap-1.5 shadow"
                    >
                      <Volume2 size={13} />
                      <span>Klakson S.35</span>
                    </button>

                    <button
                      onClick={() => {
                        setRescueTrain(prev => prev ? { ...prev, brake: 0 } : null);
                        audio.playBrakeHiss();
                      }}
                      className="bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 font-mono font-extrabold py-2.5 rounded-lg text-[10px] uppercase flex items-center justify-center gap-1.5 shadow"
                    >
                      <Volume2 size={13} className="text-cyan-400/60" />
                      <span>Rilis Penuh (B0)</span>
                    </button>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* Collapsible ON-MIC Radio Trigger Card */}
          <div className="w-full mt-1.5">
            <button
              onClick={() => setShowRadioPanel(!showRadioPanel)}
              className={`w-full py-2.5 rounded-lg text-[10px] font-black tracking-widest transition-all cursor-pointer select-none flex items-center justify-center gap-2 border ${
                showRadioPanel
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 animate-pulse'
                  : 'bg-[#0a0f1e]/90 border-slate-900 text-indigo-400 hover:bg-[#151c33]'
              }`}
            >
              <Radio size={11} className={showRadioPanel ? 'animate-bounce' : ''} />
              <span>🎙️ {showRadioPanel ? 'TUTUP RADIO LINTAS' : 'BUKA RADIO LINTAS'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Collision Alarm center, towing instructions & route map */}
        <div className="xl:col-span-7 flex flex-col gap-4 min-h-0">
          
          {/* Active collision report dashboard screen */}
          <div className="bg-[#070b15] border border-slate-900 rounded-2xl p-4.5 flex flex-col gap-3 min-h-[220px]">
            <div className="border-b border-rose-950 pb-2.5 flex justify-between items-center">
              <span className="text-[10.5px] text-rose-500 font-black tracking-widest uppercase flex items-center gap-1.5 font-mono">
                <Siren size={15} className="text-rose-500 animate-ping" /> TELEMETRI EMERGENCY KECELAKAAN LINTASAN
              </span>
              <span className="text-[9px] font-mono bg-red-950 text-red-400 px-2 rounded-sm border border-red-900">{activeIncidents.length} PLH AKTIF</span>
            </div>

            {selectedIncident ? (
              <div className="flex-grow flex flex-col justify-between">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Status Incident */}
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-900/60 font-mono text-[10px] leading-relaxed">
                    <span className="text-red-400 font-black block uppercase tracking-wider mb-1">DESKRIPSI INTEGRITAS:</span>
                    <p className="text-[#f8fafc] font-black text-[11px] leading-snug">{selectedIncident.desc}</p>
                    <div className="text-slate-400 mt-2.5 font-sans">
                      Sektor Tabrakan: <span className="text-rose-400 font-mono font-bold">KM {selectedIncident.kp.toFixed(2)}</span>
                    </div>
                    <div className="text-slate-400 font-sans">
                      Rangkaian Lumpuh: <span className="text-white font-mono font-black text-[9px] bg-red-950/20 py-0.5 px-1.5 rounded">{selectedIncident.trainsInvolved.join(' 💥 ')}</span>
                    </div>
                  </div>

                  {/* Flight mission progress task tracker */}
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-900/60 font-mono text-[10px] leading-relaxed flex flex-col justify-between">
                    <div>
                      <span className="text-indigo-400 font-black block uppercase tracking-wider mb-1">SITUASI EVAKUASI:</span>
                      
                      {!towing ? (
                        <div>
                          {rescueTrain ? (
                            <div className={`font-bold ${currentDistToIncident <= 0.25 ? 'text-emerald-400' : 'text-amber-500 animate-pulse'}`}>
                              Jarak Lori Penolong ke sasaran: <span className="text-white font-black">{currentDistToIncident.toFixed(3)} KM</span>
                              {currentDistToIncident <= 0.25 ? ' (Siap Kopel)' : ' (Dekati lokasi)'}
                            </div>
                          ) : (
                            <div className="text-red-400 italic">Lori penyelamat belum digerakkan dari depo.</div>
                          )}
                          <span className="text-slate-500 text-[9px] leading-normal block mt-1.5 font-sans">Atasi kecelakaan dengan memajukan lori ke koordinat tabrakan dengan kecepatan lambat (&lt; 15 km/h) agar aman.</span>
                        </div>
                      ) : (
                        <div className="space-y-1 font-sans">
                          <div className="#1caf7c text-emerald-400 font-black text-[10px] tracking-wide flex items-center gap-1">
                            ✓ KOPEL DEPAN TERKUNCI RAPAT
                          </div>
                          <div className="text-indigo-300 text-[10px]">
                            Stasiun Evakuasi: <strong className="text-white font-mono">{nearestStation.name} (Peron KM {nearestStation.kp.toFixed(2)})</strong>
                          </div>
                          <div className={`font-mono text-[11px] font-bold ${currentDistToStation <= 0.15 ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                            Kekapalan Jarak Stasiun: {(currentDistToStation * 1000).toFixed(0)} meter
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Speed limiter alert during active dragging approach */}
                    {towing && (
                      <div className="bg-amber-950/20 border border-amber-900/35 p-1 px-2 rounded text-[8.5px] text-amber-500 font-mono flex items-center gap-1.5 mt-2">
                        <AlertTriangle size={11} />
                        <span>BATAS DRAG: MAKS 40 KM/H SAAT MENARIK GERBONG</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Mechanic action triggers */}
                <div className="mt-3.5">
                  {!towing ? (
                    <button
                      onClick={handleCoupleWreck}
                      disabled={!rescueTrain || currentDistToIncident > 0.25}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-20 disabled:cursor-not-allowed text-slate-950 font-mono font-black text-xs py-3 rounded-xl uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all duration-100 border-b-4 border-amber-700 active:translate-y-px"
                    >
                      <Wrench size={14} />
                      <span>1. KUNCI RANTAI TARIK KOPEL LORI (JARAK &lt;= 0.25KM)</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleEvacComplete}
                      disabled={rescueTrain.speed > 0 || currentDistToStation > 0.15}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-20 disabled:cursor-not-allowed text-slate-950 font-mono font-black text-xs py-3 rounded-xl uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all duration-101 border-b-4 border-emerald-700 active:translate-y-px animate-pulse"
                    >
                      <CheckCircle2 size={14} />
                      <span>2. DEKLARASI EVAKUASI & PULIHKAN LINTAS</span>
                    </button>
                  )}
                </div>

              </div>
            ) : evacSuccess ? (
              <div className="bg-emerald-950/20 border-2 border-emerald-500/20 p-5 rounded-2xl text-center flex flex-col items-center justify-center gap-2 flex-grow">
                <CheckCircle2 className="text-emerald-400 animate-bounce" size={32} />
                <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">MISI EVAKUASI KORBAN KLIRING BERHASIL!</h4>
                <p className="text-[10px] text-slate-300 max-w-md font-sans">
                  Hebat! Gerbong yang lumpuh akibat tabrakan telah sukses ditarik ke dalam sela platform peron stasiun penampung terdekat {nearestStation.name}. Lintasan pulih total dan kereta yang ditarik siap dioperasikan kembali!
                </p>
                <div className="flex gap-2 items-center bg-emerald-950 text-emerald-400 hover:scale-105 transition-all text-[9.5px] font-mono px-3 py-1 rounded border border-emerald-900 mt-1">
                  <Award size={13} />
                  <span>DAPAT BONUS +200 PTS SKOR KARIR</span>
                </div>
              </div>
            ) : (
              <div id="no-incidents" className="flex flex-col justify-center items-center text-center p-8 gap-2.5 flex-grow font-sans">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-500">
                  <CheckCircle2 size={24} className="animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-[#f1f5f9] uppercase font-mono">LINTAS BERJALAN AMAN - BEBAS PLH</h4>
                  <p className="text-[10.5px] text-[#94a3b8] max-w-xs leading-relaxed mt-0.5">Seluruh sepur dipantau meluncur dengan lancar. Tidak terdeteksi tabrakan aktif saat ini!</p>
                </div>
              </div>
            )}
          </div>

          {/* Interactive technical route map visualizer */}
          <div className="bg-[#070b15] border border-slate-900 rounded-2xl p-3 flex flex-col gap-2 flex-grow min-h-[280px]">
            <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest font-mono pl-1">MONITOR GEOGRAFIS PENYELAMAT LINTASAN</span>
            <div className="flex-grow relative rounded-xl overflow-hidden border border-slate-900 bg-slate-950">
              <RealWorldMap
                signals={signals}
                pjls={[]}
                switches={switches}
                trains={rescueTrain ? [rescueTrain] : []}
                activeTrain={rescueTrain}
              />
            </div>
          </div>

        </div>

        {/* ON-MIC VHF RADIO SLIDING DRAWER PANEL */}
        <AnimatePresence>
          {showRadioPanel && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute left-0 top-14 bottom-2 w-64 md:w-72 z-[1050] bg-[#050914]/98 backdrop-blur-lg border-r border-slate-800/80 p-3 md:p-3.5 rounded-r-lg shadow-2xl flex flex-col gap-3 pointer-events-auto"
            >
              <div className="flex justify-between items-center border-b border-rose-950 pb-2">
                <span className="text-[9px] font-black tracking-widest text-emerald-400 uppercase font-mono flex items-center gap-1">
                  🎙️ KOMUNIKASI ON-MIC (TEKNIS)
                </span>
                <button 
                  onClick={() => setShowRadioPanel(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                <RadioKomando
                  activeTrain={rescueTrain || {
                    id: `TEK-${career.username}`,
                    name: `Lori Teknisi`,
                    type: TrainType.Langsir,
                    kp: 15.0,
                    direction: LineDirection.Hilir,
                    speed: 0,
                    throttle: 0,
                    brake: 0,
                    reverser: 'N',
                    isAI: false,
                    hasCollided: false,
                    isBanned: false,
                    driverName: career.username,
                    maxSpeed: 30,
                    targetSpeedLimit: 30,
                    currentPlatformId: null,
                    doorsOpen: false,
                    horn: false,
                    emergencyBrake: false,
                    currentTrackId: 'Main_Line',
                    cargoType: 'Passengers',
                    lastStopKp: null
                  }}
                  allTrains={activeTrains}
                  senderId={career.username}
                />
                <VhfRadioDinas
                  role="Teknisi"
                  username={career.username}
                  onSendChatMessage={onSendChatMessage}
                  selectedZone={rescueTrain ? (rescueTrain.kp < 15 ? 1 : rescueTrain.kp < 35 ? 2 : 3) : 3}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

    </div>
  );
}
