import { type CSSProperties, useEffect, useState } from "react";

import { Bars, FloatHead, Icon, Notice } from "@/components/ui";
import { crisisLine, scaleCopy as c } from "@/content/copy";
import { agent, type CrisisResource, errorText, type ScaleBatch, type ScaleResult } from "@/lib/agent";

import "./scale.css";

type Batch = Extract<ScaleBatch, { scale: object }>;
type View =
  | { v: "loading" }
  | { v: "none" }
  | { v: "error"; message: string }
  | { v: "ask"; batch: Batch }
  | { v: "crisis"; resources: CrisisResource[]; then: View }
  | { v: "result"; result: ScaleResult }
  | { v: "partDone" };

/**
 * Tanda de escala: 2 o 3 preguntas, a lo sumo una vez al día. Cada respuesta se guarda al momento;
 * en el PHQ-9 el ítem de seguridad va primero y, si es mayor que 0, los recursos de ayuda se
 * muestran AHÍ MISMO, con calma, antes de cualquier otra cosa.
 */
export function Scale() {
  const [view, setView] = useState<View>({ v: "loading" });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ answered: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // La API devuelve los recursos en cada guardado mientras el ítem de seguridad siga > 0:
  // se muestran al instante, pero una sola vez por tanda (después se puede seguir con calma).
  const [crisisSeen, setCrisisSeen] = useState(false);

  useEffect(() => {
    agent
      .scaleBatch()
      .then((b) => {
        if (!b.scale) return setView({ v: "none" });
        setProgress({ answered: b.scale.answered, total: b.scale.total });
        setView({ v: "ask", batch: b as Batch });
      })
      .catch((e) => setView({ v: "error", message: errorText(e) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void agent.scaleLater();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const answer = async (batch: Batch, index: number, value: number) => {
    setSaving(index);
    setError(null);
    try {
      const res = await agent.scaleAnswer(batch.scale.code, index, value);
      setAnswers((a) => ({ ...a, [index]: value }));
      setProgress({ answered: res.answered, total: res.total });
      if (res.crisis && !crisisSeen) {
        setCrisisSeen(true);
        setView({ v: "crisis", resources: res.crisis.resources, then: { v: "ask", batch } });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(null);
    }
  };

  const finish = async (code: string) => {
    setError(null);
    try {
      const result = await agent.scaleComplete(code);
      setView(result.crisis ? { v: "crisis", resources: result.crisis.resources, then: { v: "result", result } } : { v: "result", result });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <main className="float scale">
      <FloatHead
        title="Unas preguntas"
        closeLabel="Más tarde"
        onClose={() => void agent.scaleLater()}
        aside={progress && view.v === "ask" ? <span className="badge mono">{progress.answered} de {progress.total}</span> : null}
      />

      <div className="scale-body">
        {view.v === "loading" ? <div className="scale-skeleton" aria-busy /> : null}
        {view.v === "error" ? <Notice tone="attention">{view.message}</Notice> : null}
        {view.v === "none" ? <p className="muted">{c.none}</p> : null}

        {view.v === "ask" ? <Ask batch={view.batch} answers={answers} saving={saving} progress={progress} onAnswer={answer} onFinish={finish} onPartDone={() => setView({ v: "partDone" })} /> : null}

        {view.v === "crisis" ? (
          <Crisis resources={view.resources} continueLabel={view.then.v === "result" ? c.crisis.seeResult : c.crisis.continue} onContinue={() => setView(view.then)} />
        ) : null}

        {view.v === "result" ? (
          <div className="stack fade scale-result" style={{ "--gap": "10px" } as CSSProperties}>
            <span className="badge" data-tone="brand">
              {view.result.instrument}
            </span>
            <p className="scale-score">
              <span className="mono">{view.result.totalScore}</span>
              <span className="scale-of"> de {view.result.maxScore}</span>
            </p>
            <div className="scale-meter" aria-hidden>
              <span style={{ width: `${(view.result.totalScore / view.result.maxScore) * 100}%` }} />
            </div>
            <p className="scale-band">{view.result.band}</p>
            <p className="muted">{view.result.note}</p>
            <p className="quote scale-care">{c.resultNote}</p>
          </div>
        ) : null}

        {view.v === "partDone" ? (
          <div className="scale-done fade" role="status">
            <Bars size={40} enter />
            <p className="quote">{c.partDone}</p>
          </div>
        ) : null}

        {error ? (
          <Notice tone="attention" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>

      <footer className="scale-foot">
        {view.v === "result" || view.v === "partDone" || view.v === "none" || view.v === "error" ? (
          <button className="btn btn-primary btn-sm" onClick={() => void agent.scaleLater()} autoFocus>
            {c.close}
          </button>
        ) : view.v === "ask" ? (
          <button className="btn btn-ghost btn-sm" onClick={() => void agent.scaleLater()}>
            {c.later}
          </button>
        ) : null}
      </footer>
    </main>
  );
}

function Ask({
  batch,
  answers,
  saving,
  progress,
  onAnswer,
  onFinish,
  onPartDone,
}: {
  batch: Batch;
  answers: Record<number, number>;
  saving: number | null;
  progress: { answered: number; total: number } | null;
  onAnswer: (b: Batch, index: number, value: number) => void;
  onFinish: (code: string) => void;
  onPartDone: () => void;
}) {
  const { scale, meta } = batch;
  // Texto aprobado por el personal clínico (viene del catálogo de la API).
  const text = meta?.text ?? null;
  const min = meta?.minPerItem ?? 0;
  const max = meta?.maxPerItem ?? (text ? min + text.options.length - 1 : 3);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const allDone = scale.nextItems.every((i) => answers[i] !== undefined);
  const complete = progress ? progress.answered >= progress.total : false;

  return (
    <div className="stack fade" style={{ "--gap": "14px" } as CSSProperties}>
      <div className="stack" style={{ "--gap": "8px" } as CSSProperties}>
        {progress ? (
          <div className="scale-meter" aria-hidden>
            <span style={{ width: `${(progress.answered / progress.total) * 100}%` }} />
          </div>
        ) : null}
        <p className="label">{c.intro(scale.name, progress?.answered ?? scale.answered, progress?.total ?? scale.total)}</p>
        {text?.period ? <p className="quote scale-period">{text.period}</p> : null}
      </div>

      {scale.nextItems.map((index) => (
        <fieldset key={index} className="scale-item" disabled={saving !== null}>
          <legend>
            <span className="label">Pregunta {index + 1}</span>
            <span className="scale-q">{text?.items[index] || c.item(index + 1)}</span>
          </legend>
          <div className="scale-options">
            {values.map((v, i) => (
              <button key={v} type="button" aria-pressed={answers[index] === v} onClick={() => onAnswer(batch, index, v)}>
                <span className="scale-radio" aria-hidden>
                  {answers[index] === v ? <Icon name="check" size={11} /> : null}
                </span>
                {text?.options[i] ?? v}
              </button>
            ))}
          </div>
          {saving === index ? <span className="faint">{c.saving}</span> : null}
        </fieldset>
      ))}

      {allDone ? (
        complete ? (
          <button className="btn btn-primary" style={{ justifySelf: "start" }} onClick={() => onFinish(scale.code)}>
            {c.finish}
          </button>
        ) : (
          <button className="btn btn-primary" style={{ justifySelf: "start" }} onClick={onPartDone}>
            Listo
          </button>
        )
      ) : null}
    </div>
  );
}

/** Recursos de ayuda humana: tranquilos, claros y antes que cualquier otra cosa. */
function Crisis({ resources, continueLabel, onContinue }: { resources: CrisisResource[]; continueLabel: string; onContinue: () => void }) {
  const list = resources.length ? resources : [{ id: "113", name: crisisLine.name, contactInfo: crisisLine.detail } as CrisisResource];
  return (
    <section className="stack fade scale-crisis" role="alert" style={{ "--gap": "12px" } as CSSProperties}>
      <h1>{c.crisis.title}</h1>
      <p className="quote scale-care">{c.crisis.lead}</p>
      <ul className="scale-resources">
        {list.map((r) => (
          <li key={r.id}>
            <span className="scale-phone" aria-hidden>
              <Icon name="phone" />
            </span>
            <span className="stack" style={{ "--gap": "0" } as CSSProperties}>
              <strong>{r.name}</strong>
              <span className="mono scale-contact">{r.contactInfo}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="faint">{c.crisis.urgent}</p>
      <div className="row">
        <button className="btn btn-secondary btn-sm" onClick={onContinue}>
          {continueLabel}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void agent.scaleLater()}>
          {c.crisis.close}
        </button>
      </div>
    </section>
  );
}
