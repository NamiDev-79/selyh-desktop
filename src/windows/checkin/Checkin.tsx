import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { Bars, FloatHead } from "@/components/ui";
import { checkinCopy, exerciseCopy, scale, sleepCopy, tags } from "@/content/copy";
import { agent, errorText, type Tag } from "@/lib/agent";

import "./checkin.css";

type Phase =
  | { step: "ask" }
  | { step: "sending" }
  | { step: "done"; text: string; offer: boolean }
  | { step: "sleep" }
  | { step: "error"; text: string };

/** Día local AAAA-MM-DD: el sueño se guarda en el día en que te despertaste. */
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SKIP_KEY = () => `sleep-skip:${localDay()}`;

/**
 * Mini ventana flotante: 5 opciones y una etiqueta opcional. Teclas 1 a 5 para responder y Esc
 * para cerrar. Si nadie la toca, se cierra sola y no vuelve a insistir por un rato.
 */
export function Checkin() {
  const [phase, setPhase] = useState<Phase>({ step: "ask" });
  const [tag, setTag] = useState<Tag | undefined>();
  const touched = useRef(false);

  const send = useCallback(
    async (score: number) => {
      touched.current = true;
      setPhase({ step: "sending" });
      try {
        const r = await agent.submitCheckin(score, tag);
        const text = r.waitingConsent ? checkinCopy.needsConsent : r.synced ? checkinCopy.thanks : checkinCopy.queued;
        // Con carga alta se OFRECE una pausa guiada; nunca se abre sola.
        const offer = score >= 4 && r.synced;
        setPhase({ step: "done", text, offer });
        // Tras el primer check-in del día, si hay permiso, cómo dormiste (en lugar de cerrar).
        let skipped = false;
        try {
          skipped = localStorage.getItem(SKIP_KEY()) === "1";
        } catch {
          /* sin almacenamiento: se pregunta igual */
        }
        const askSleep = r.synced && !offer && !skipped ? await agent.sleepPrompt(localDay()).catch(() => false) : false;
        if (askSleep) {
          setTimeout(() => setPhase({ step: "sleep" }), 900);
          return;
        }
        setTimeout(() => void agent.closeCheckin(), offer ? 10000 : r.waitingConsent ? 4000 : 1600);
      } catch (e) {
        setPhase({ step: "error", text: errorText(e) });
      }
    },
    [tag],
  );

  // Teclado: 1–5 responde, Esc cierra sin responder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void agent.dismissCheckin();
      const n = Number(e.key);
      if ((phase.step === "ask" || phase.step === "error") && n >= 1 && n <= 5) void send(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.step, send]);

  // Cierre automático si no hubo ninguna interacción.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!touched.current) void agent.dismissCheckin();
    }, checkinCopy.autoCloseSeconds * 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="float checkin" onPointerDown={() => (touched.current = true)}>
      <FloatHead title={checkinCopy.question} closeLabel="Cerrar sin responder" onClose={() => void agent.dismissCheckin()} />

      {phase.step === "sleep" ? (
        <SleepAsk />
      ) : phase.step === "done" ? (
        <div className="checkin-done fade" role="status">
          <Bars size={44} enter />
          <div className="stack" style={{ "--gap": "8px" } as CSSProperties}>
            <p className="quote checkin-thanks">{phase.text}</p>
            {phase.offer ? <OfferPause /> : null}
          </div>
        </div>
      ) : (
        <div className="checkin-body">
          <div className="checkin-scale" role="group" aria-label={checkinCopy.question}>
            {scale.map((s) => (
              <button key={s.value} type="button" disabled={phase.step === "sending"} onClick={() => void send(s.value)} aria-label={`${s.value}, ${s.label}`}>
                <span className="checkin-bar" style={{ "--h": `${4 + s.value * 4}px` } as CSSProperties} aria-hidden />
                <span className="checkin-n mono">{s.value}</span>
                <span className="checkin-l">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="checkin-tags" role="group" aria-label={checkinCopy.tagPrompt}>
            {tags.map((t) => (
              <button key={t.value} type="button" aria-pressed={tag === t.value} onClick={() => setTag(tag === t.value ? undefined : t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          {phase.step === "error" ? (
            <p role="alert" className="checkin-hint checkin-error">
              {phase.text}
            </p>
          ) : (
            <p className="checkin-hint">
              <kbd>1</kbd>–<kbd>5</kbd> para responder · <kbd>Esc</kbd> para cerrar
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function SleepAsk() {
  const [quality, setQuality] = useState<number | undefined>();
  const [hours, setHours] = useState<number | undefined>();
  const [state, setState] = useState<"ask" | "saving" | "saved">("ask");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!quality) return;
    setState("saving");
    setError(null);
    try {
      await agent.logSleep(localDay(), quality, hours);
      setState("saved");
      setTimeout(() => void agent.closeCheckin(), 1800);
    } catch (e) {
      setError(errorText(e));
      setState("ask");
    }
  };
  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY(), "1");
    } catch {
      /* nada que guardar */
    }
    void agent.closeCheckin();
  };

  if (state === "saved") {
    return (
      <div className="checkin-done fade" role="status">
        <Bars size={44} enter />
        <p className="quote checkin-thanks">{sleepCopy.saved}</p>
      </div>
    );
  }
  return (
    <div className="checkin-body sleep fade">
      <p className="sleep-q">{sleepCopy.question}</p>
      <div className="sleep-opts" role="radiogroup" aria-label={sleepCopy.question}>
        {sleepCopy.quality.map((q) => (
          <button key={q.value} type="button" role="radio" aria-checked={quality === q.value} disabled={state === "saving"} onClick={() => setQuality(q.value)}>
            {q.label}
          </button>
        ))}
      </div>
      <p className="checkin-hint">{sleepCopy.hoursPrompt}</p>
      <div className="sleep-opts sleep-hours" role="radiogroup" aria-label={sleepCopy.hoursPrompt}>
        {sleepCopy.hours.map((h) => (
          <button key={h.value} type="button" role="radio" aria-checked={hours === h.value} disabled={state === "saving"} onClick={() => setHours(hours === h.value ? undefined : h.value)}>
            {h.label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="checkin-hint checkin-error">
          {error}
        </p>
      ) : null}
      <div className="row" style={{ "--gap": "8px" } as CSSProperties}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!quality || state === "saving"} onClick={() => void save()}>
          {sleepCopy.save}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={skip}>
          {sleepCopy.skip}
        </button>
      </div>
    </div>
  );
}

function OfferPause() {
  const [note, setNote] = useState<string | null>(null);
  if (note) return <p className="faint">{note}</p>;
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      style={{ justifySelf: "start" }}
      onClick={() =>
        void agent
          .openExercise()
          .then((r) => (r.opened ? agent.closeCheckin() : setNote(exerciseCopy.noneAvailable[r.reason] ?? exerciseCopy.noneAvailable.NO_CONTENT_AVAILABLE!)))
          .catch((e) => setNote(errorText(e)))
      }
    >
      {exerciseCopy.offerAfterCheckin}
    </button>
  );
}
