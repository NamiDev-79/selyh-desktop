import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { Bars, FloatHead } from "@/components/ui";
import { checkinCopy, exerciseCopy, scale, tags } from "@/content/copy";
import { agent, errorText, type Tag } from "@/lib/agent";

import "./checkin.css";

type Phase =
  | { step: "ask" }
  | { step: "sending" }
  | { step: "done"; text: string; offer: boolean }
  | { step: "error"; text: string };

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

      {phase.step === "done" ? (
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
