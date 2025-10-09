import React, { useEffect, useMemo, useRef, useState } from "react";

// Dual N‑Back – iPhone‑friendly React component (TTS fix + PWA-safe)
// - iOS: Start 버튼으로 AudioContext.resume() + TTS unlock(짧은 더미 발화)
// - Beep(안정) / Speech(TTS) 토글 지원
// - speechSynthesis.cancel() 호출 제거 (iOS에서 발화가 먹히지 않는 이슈 회피)

const LETTER_POOL = ["A","E","I","O","U","B","K","M","P","S","T"];
const GRID_SIZE = 3;
const DEFAULT_BLOCK_LEN = 20;

function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>();
  useEffect(() => { savedCallback.current = callback; }, [callback]);
  useEffect(() => { if (delay === null) return; const id = setInterval(() => savedCallback.current && savedCallback.current(), delay); return () => clearInterval(id); }, [delay]);
}

function randInt(max: number) { return Math.floor(Math.random() * max); }

function generateNextStimulus() {
  return { pos: randInt(GRID_SIZE * GRID_SIZE), letter: LETTER_POOL[randInt(LETTER_POOL.length)] };
}

// WebAudio beep
function makeBeep(audioCtx: AudioContext | null, durMs = 140) {
  if (!audioCtx) return () => {};
  return (freq = 600) => {
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs/1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs/1000 + 0.02);
  };
}

function speak(letter: string, voiceName?: string, langHint = "en-US") {
  try {
    const u = new SpeechSynthesisUtterance(letter);
    u.rate = 0.9; u.pitch = 1.0; u.lang = langHint;
    if (voiceName) {
      const v = window.speechSynthesis.getVoices().find(vo => vo.name === voiceName);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
  } catch {}
}

interface Tally { posHits:number; posMisses:number; posFalse:number; sndHits:number; sndMisses:number; sndFalse:number; }
const emptyTally = (): Tally => ({ posHits:0, posMisses:0, posFalse:0, sndHits:0, sndMisses:0, sndFalse:0 });

export default function DualNBackApp() {
  const [running, setRunning] = useState(false);
  const [n, setN] = useState(2);
  const [speedMs, setSpeedMs] = useState(2500);
  const [blockLen, setBlockLen] = useState(DEFAULT_BLOCK_LEN);
  const [trialIdx, setTrialIdx] = useState(0);
  const [stream, setStream] = useState<{pos:number; letter:string;}[]>([]);
  const [current, setCurrent] = useState<{pos:number; letter:string} | null>(null);
  const [tally, setTally] = useState<Tally>(emptyTally());
  const [allowPressPos, setAllowPressPos] = useState(true);
  const [allowPressSnd, setAllowPressSnd] = useState(true);

  const [audioEnabled, setAudioEnabled] = useState(false);
  const [useSpeech, setUseSpeech] = useState(false);
  const [voice, setVoice] = useState<string | undefined>(undefined);
  const [lang, setLang] = useState<string>("en-US");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const beepRef = useRef<(freq?: number) => void>(() => {});

  const grid = useMemo(() => Array.from({length: GRID_SIZE * GRID_SIZE}, (_, i) => i), []);

  // Load default voice when ready
  useEffect(() => {
    const assign = () => {
      const vs = window.speechSynthesis.getVoices();
      const en = vs.find(v => /en(-|\b)/i.test(v.lang));
      setVoice(en?.name);
    };
    assign();
    window.speechSynthesis.onvoiceschanged = assign;
  }, []);

  function resetBlock(nextN?: number) {
    setTrialIdx(0); setStream([]); setCurrent(null); setTally(emptyTally()); setAllowPressPos(true); setAllowPressSnd(true);
    if (typeof nextN === "number") setN(Math.max(1, nextN));
  }

  function unlockAudioOnce() {
    try {
      // WebAudio unlock
      if (!audioCtxRef.current) {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        audioCtxRef.current = ctx;
        beepRef.current = makeBeep(ctx);
      }
      audioCtxRef.current?.resume();
    } catch {}

    try {
      // TTS unlock – 아주 짧은 더미 발화
      const dummy = new SpeechSynthesisUtterance(".");
      dummy.volume = 0.01; // 들리지 않게
      dummy.rate = 1; dummy.pitch = 1; dummy.lang = lang;
      window.speechSynthesis.speak(dummy);
    } catch {}
  }

  function start() {
    unlockAudioOnce();
    setAudioEnabled(true);
    resetBlock();
    setRunning(true);
  }
  function stop() { setRunning(false); setCurrent(null); }

  useInterval(() => {
    if (!running) return;

    if (trialIdx >= blockLen) {
      const posAtt = tally.posHits + tally.posMisses;
      const sndAtt = tally.sndHits + tally.sndMisses;
      const combinedAttempts = posAtt + sndAtt;
      const combinedHits = tally.posHits + tally.sndHits;
      const acc = combinedAttempts ? combinedHits / combinedAttempts : 0;
      const nextN = acc >= 0.75 ? n + 1 : (acc < 0.55 ? Math.max(1, n - 1) : n);
      setTimeout(() => resetBlock(nextN), 400);
      return;
    }

    const next = generateNextStimulus();
    setStream(prev => [...prev, next]);
    setCurrent(next);
    setTrialIdx(t => t + 1);
    setAllowPressPos(true); setAllowPressSnd(true);

    if (audioEnabled) {
      if (useSpeech) {
        speak(next.letter, voice, lang);
      } else {
        const idx = LETTER_POOL.indexOf(next.letter);
        const freq = 500 + (idx >= 0 ? idx * 30 : 0);
        beepRef.current(freq);
      }
    }

    const indexForMiss = stream.length;
    const missTimer = setTimeout(() => {
      setTally(prev => {
        const posMatch = indexForMiss - n >= 0 && stream[indexForMiss - n]?.pos === next.pos;
        const sndMatch = indexForMiss - n >= 0 && stream[indexForMiss - n]?.letter === next.letter;
        const upd = { ...prev };
        if (posMatch && allowPressPos) upd.posMisses += 1;
        if (sndMatch && allowPressSnd) upd.sndMisses += 1;
        return upd;
      });
    }, Math.max(0, speedMs - 80));

    return () => clearTimeout(missTimer);
  }, running ? speedMs : null);

  function handlePress(kind: "pos" | "snd") {
    if (!current) return;
    setTally(prev => {
      const idx = stream.length - 1;
      const prevIdx = idx - n;
      const posMatch = prevIdx >= 0 && stream[prevIdx]?.pos === current.pos;
      const sndMatch = prevIdx >= 0 && stream[prevIdx]?.letter === current.letter;
      const upd = { ...prev };
      if (kind === "pos") {
        if (!allowPressPos) return prev;
        if (posMatch) upd.posHits += 1; else upd.posFalse += 1;
      } else {
        if (!allowPressSnd) return prev;
        if (sndMatch) upd.sndHits += 1; else upd.sndFalse += 1;
      }
      return upd;
    });
    if (kind === "pos") setAllowPressPos(false); else setAllowPressSnd(false);
  }

  const posAttempts = tally.posHits + tally.posMisses;
  const sndAttempts = tally.sndHits + tally.sndMisses;
  const posAcc = posAttempts ? (tally.posHits / posAttempts) : 0;
  const sndAcc = sndAttempts ? (tally.sndHits / sndAttempts) : 0;
  const combinedAttempts = posAttempts + sndAttempts;
  const combinedHits = tally.posHits + tally.sndHits;
  const combinedAcc = combinedAttempts ? (combinedHits / combinedAttempts) : 0;

  return (
    <div className="min-h-screen w-full bg-gray-950 text-gray-100 flex flex-col items-center p-4 select-none">
      <div className="w-full max-w-md">
        <header className="mt-2 mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Dual N‑Back</h1>
          <div className="text-sm opacity-80">iPhone‑friendly</div>
        </header>

        <div className="grid grid-cols-2 gap-2 mb-3">
          {!running ? (
            <button onClick={start} className="rounded-2xl py-2 px-3 bg-green-600 active:scale-95 shadow">Start</button>
          ) : (
            <button onClick={stop} className="rounded-2xl py-2 px-3 bg-red-600 active:scale-95 shadow">Stop</button>
          )}
          <button onClick={() => resetBlock()} className="rounded-2xl py-2 px-3 bg-gray-700 active:scale-95 shadow">Reset Block</button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-2xl bg-gray-800 p-3"><div className="opacity-80">N</div><div className="text-2xl font-semibold">{n}</div></div>
          <div className="rounded-2xl bg-gray-800 p-3"><div className="opacity-80">Trial</div><div className="text-2xl font-semibold">{Math.min(trialIdx + 1, blockLen)} / {blockLen}</div></div>
          <div className="rounded-2xl bg-gray-800 p-3"><div className="opacity-80">Accuracy</div><div className="text-2xl font-semibold">{(combinedAcc*100).toFixed(0)}%</div></div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {grid.map((i) => {
            const isActive = current && current.pos === i;
            return (
              <div key={i} className={`aspect-square rounded-2xl border border-gray-700 flex items-center justify-center transition-transform ${isActive ? "bg-blue-500 scale-105" : "bg-gray-900"}`}>
                <span className="text-2xl font-bold opacity-70">{isActive ? current?.letter : ""}</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button onClick={() => handlePress("pos")} disabled={!running} className={`rounded-2xl py-3 px-4 text-lg font-semibold shadow ${running ? "bg-indigo-600 active:scale-95" : "bg-gray-700 opacity-60"}`}>Position Match</button>
          <button onClick={() => handlePress("snd")} disabled={!running} className={`rounded-2xl py-3 px-4 text-lg font-semibold shadow ${running ? "bg-amber-600 active:scale-95" : "bg-gray-700 opacity-60"}`}>Sound Match</button>
        </div>

        <details className="mb-3 rounded-2xl bg-gray-900 p-3 border border-gray-800">
          <summary className="cursor-pointer select-none font-medium">Settings</summary>
          <div className="mt-3 grid gap-3">
            <div className="flex items-center justify-between gap-3"><label className="opacity-80">Initial N</label><input type="number" min={1} max={9} value={n} onChange={e => setN(Math.max(1, parseInt(e.target.value||"1", 10)))} className="bg-gray-800 rounded-xl px-3 py-1 w-24" /></div>
            <div className="flex items-center justify-between gap-3"><label className="opacity-80">Speed (ms/item)</label><input type="number" min={800} step={100} value={speedMs} onChange={e => setSpeedMs(Math.max(300, parseInt(e.target.value||"1500", 10)))} className="bg-gray-800 rounded-xl px-3 py-1 w-24" /></div>
            <div className="flex items-center justify-between gap-3"><label className="opacity-80">Block length</label><input type="number" min={12} step={2} value={blockLen} onChange={e => setBlockLen(Math.max(8, parseInt(e.target.value||"20", 10)))} className="bg-gray-800 rounded-xl px-3 py-1 w-24" /></div>
            <div className="flex items-center justify-between gap-3"><label className="opacity-80">Audio mode</label>
              <select value={useSpeech ? "speech" : "beep"} onChange={e => setUseSpeech(e.target.value === "speech")} className="bg-gray-800 rounded-xl px-3 py-1 w-full">
                <option value="beep">Beep (WebAudio) – iOS 안정적</option>
                <option value="speech">Speech (TTS)</option>
              </select>
            </div>
            {useSpeech && (
              <>
                <div className="flex items-center justify-between gap-3"><label className="opacity-80">Voice</label>
                  <select value={voice || ""} onChange={e => setVoice(e.target.value || undefined)} className="bg-gray-800 rounded-xl px-3 py-1 w-full">
                    <option value="">(auto)</option>
                    {window.speechSynthesis.getVoices().map(v => (<option key={v.name} value={v.name}>{v.name} – {v.lang}</option>))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3"><label className="opacity-80">TTS language</label>
                  <input value={lang} onChange={e => setLang(e.target.value)} className="bg-gray-800 rounded-xl px-3 py-1 w-full" placeholder="en-US" />
                </div>
              </>
            )}
            <p className="text-xs opacity-70">Tip: iPhone은 사용자 제스처 후에만 오디오가 재생됩니다. 먼저 <b>Start</b>를 누르세요. 홈 화면에 추가하면 전체화면으로 사용 가능.</p>
          </div>
        </details>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-gray-900 p-3 border border-gray-800"><div className="font-semibold mb-1">Position</div><div>Hits: {tally.posHits}</div><div>Misses: {tally.posMisses}</div><div>False alarms: {tally.posFalse}</div><div>Acc: {(posAcc*100).toFixed(0)}%</div></div>
          <div className="rounded-2xl bg-gray-900 p-3 border border-gray-800"><div className="font-semibold mb-1">Sound</div><div>Hits: {tally.sndHits}</div><div>Misses: {tally.sndMisses}</div><div>False alarms: {tally.sndFalse}</div><div>Acc: {(sndAcc*100).toFixed(0)}%</div></div>
        </div>

        <footer className="mt-4 text-xs opacity-60">Accuracy ≥ 75% → N +1; &lt; 55% → N −1.</footer>
      </div>
    </div>
  );
}