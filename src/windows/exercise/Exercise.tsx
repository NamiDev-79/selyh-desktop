import { type CSSProperties, useEffect, useState } from "react";

import { Bars, FloatHead, Notice } from "@/components/ui";
import { exerciseCopy as c } from "@/content/copy";
import { agent, errorText, type Suggestion } from "@/lib/agent";

import "./exercise.css";

type Phase = "ask" | "run" | "feedback" | "thanks";

/** Propuesta breve, ejercicio guiado en la misma ventana y, al final, "¿te sirvió?". */
export function Exercise() {
  const [s, setS] = useState<Suggestion | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("ask");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agent.exerciseCurrent().then(setS).catch(() => setS(null));
  }, []);

  useEffect(() => {
    if (s === null) void agent.closeFloating("exercise");
  }, [s]);

  const respond = async (r: "ACCEPTED" | "POSTPONED" | "DISMISSED") => {
    if (!s) return;
    setError(null);
    try {
      await agent.exerciseRespond(s.id, r);
      if (r === "ACCEPTED") setPhase("run");
      else void agent.closeFloating("exercise");
    } catch (e) {
      setError(errorText(e));
    }
  };

  const feedback = async (helpful: boolean) => {
    if (!s) return;
    await agent.exerciseFeedback(s.id, helpful).catch(() => null);
    setPhase("thanks");
    setTimeout(() => void agent.closeFloating("exercise"), 1800);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void (phase === "ask" ? respond("POSTPONED") : agent.closeFloating("exercise"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!s) return <main className="float ex" />;
  const it = s.intervention;
  const close = () => void (phase === "ask" ? respond("POSTPONED") : agent.closeFloating("exercise"));

  return (
    <main className="float ex">
      <FloatHead title="Una pausa" closeLabel={phase === "ask" ? c.later : "Cerrar"} onClose={close} aside={<span className="badge">{it.durationMinutes} min</span>} />

      <div className="ex-body fade" key={phase}>
        {phase === "ask" ? (
          <>
            <div className="ex-hero" aria-hidden>
              <Bars size={56} enter />
            </div>
            <h2>{c.ask(it.title, it.durationMinutes)}</h2>
            <p className="muted ex-text">{it.bodyMarkdown}</p>
            <div className="ex-actions">
              <button className="btn btn-primary" onClick={() => void respond("ACCEPTED")} autoFocus>
                {c.now}
              </button>
              <button className="btn btn-secondary" onClick={() => void respond("POSTPONED")}>
                {c.later}
              </button>
              <button className="btn btn-ghost" onClick={() => void respond("DISMISSED")}>
                {c.no}
              </button>
            </div>
          </>
        ) : null}

        {phase === "run" ? <Run title={it.title} body={it.bodyMarkdown} minutes={it.durationMinutes} breathing={it.category === "BREATHING"} onDone={() => setPhase("feedback")} /> : null}

        {phase === "feedback" ? (
          <div className="ex-center">
            <Bars size={44} breathe />
            <h2>{c.helpful}</h2>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => void feedback(true)} autoFocus>
                {c.yes}
              </button>
              <button className="btn btn-secondary" onClick={() => void feedback(false)}>
                {c.notReally}
              </button>
            </div>
          </div>
        ) : null}

        {phase === "thanks" ? (
          <div className="ex-center" role="status">
            <Bars size={44} enter />
            <p className="quote ex-thanks">{c.thanks}</p>
          </div>
        ) : null}

        {error ? (
          <Notice tone="attention" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>
    </main>
  );
}

// Respiración en caja: 4 s inhalar, 4 sostener, 4 exhalar, 4 sostener.
// Al inhalar, la barra corta crece hasta igualar a la alta (×φ); al exhalar vuelve a su altura.
const PHI = 1.618;
const BOX = [
  { label: c.inhale, grow: PHI },
  { label: c.hold, grow: PHI },
  { label: c.exhale, grow: 1 },
  { label: c.hold, grow: 1 },
];

function Run({ title, body, minutes, breathing, onDone }: { title: string; body: string; minutes: number; breathing: boolean; onDone: () => void }) {
  const total = Math.max(1, minutes) * 60;
  const [left, setLeft] = useState(total);

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  const elapsed = total - left;
  const step = BOX[Math.floor(elapsed / 4) % BOX.length]!;
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, "0");

  return (
    <>
      <h2 className="ex-run-title">{title}</h2>
      {breathing ? (
        <div className="ex-breath" aria-live="polite">
          <svg className="ex-bars" viewBox="0 0 120 120" aria-hidden>
            <rect x={22} y={0} width={34} height={120} rx={17} fill="var(--brand)" />
            <rect className="ex-short" x={64} y={45.8} width={34} height={74.2} rx={17} fill="var(--brand-soft)" style={{ "--grow": step.grow } as CSSProperties} />
          </svg>
          <span className="ex-step">{step.label}</span>
          <span className="ex-count mono" aria-hidden>
            {4 - (elapsed % 4)}
          </span>
        </div>
      ) : (
        <p className="muted ex-text">{body}</p>
      )}
      {breathing ? <p className="faint">{body}</p> : null}
      <div className="ex-timer">
        <div className="ex-track" aria-hidden>
          <span style={{ width: `${(elapsed / total) * 100}%` }} />
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono faint" aria-label="Tiempo restante">
            {mm}:{ss}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>
            {c.done}
          </button>
        </div>
      </div>
    </>
  );
}
