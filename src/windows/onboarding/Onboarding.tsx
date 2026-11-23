import { type CSSProperties, useEffect, useState } from "react";

import { Bars, Icon, Logo, Notice, SettingRow, Switch } from "@/components/ui";
import { onboardingCopy as c } from "@/content/copy";
import { agent, type Consent, errorText, type PairingStart, type Preferences } from "@/lib/agent";

import "./onboarding.css";

type Step = "welcome" | "link" | "consent" | "prefs" | "done";
const STEPS: Step[] = ["welcome", "link", "consent", "prefs", "done"];

/** Primer arranque: qué hace y qué no, vinculación con código, permisos y preferencias rápidas. */
export function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");

  // Si ya estaba vinculado (por ejemplo, cerró la ventana a mitad), seguir desde los permisos.
  useEffect(() => {
    agent
      .status()
      .then((s) => s.linked && setStep("consent"))
      .catch(() => null);
  }, []);

  return (
    <main className="ob">
      <header className="ob-top">
        <Logo height={22} />
        <div className="ob-progress" role="img" aria-label={`Paso ${STEPS.indexOf(step) + 1} de ${STEPS.length}`}>
          {STEPS.map((s) => (
            <span key={s} data-on={STEPS.indexOf(s) <= STEPS.indexOf(step)} />
          ))}
        </div>
      </header>
      <div className="ob-body fade" key={step}>
        {step === "welcome" ? <Welcome next={() => setStep("link")} /> : null}
        {step === "link" ? <Link next={() => setStep("consent")} /> : null}
        {step === "consent" ? <Permissions next={() => setStep("prefs")} /> : null}
        {step === "prefs" ? <Prefs next={() => setStep("done")} /> : null}
        {step === "done" ? <Done /> : null}
      </div>
    </main>
  );
}

function Welcome({ next }: { next: () => void }) {
  const w = c.welcome;
  return (
    <>
      <div className="ob-hero" aria-hidden>
        <Bars size={68} enter />
      </div>
      <div className="stack" style={{ "--gap": "8px" } as CSSProperties}>
        <h1>{w.title}</h1>
        <p className="quote ob-tagline">Prevenir también es parte del trabajo.</p>
      </div>
      <p className="muted">{w.lead}</p>
      <ul className="ob-list">
        {w.does.map((d) => (
          <li key={d}>
            <span className="ob-check" aria-hidden>
              <Icon name="check" size={12} />
            </span>
            {d}
          </li>
        ))}
      </ul>
      <div className="card ob-never">
        <span className="row ob-never-title" style={{ "--gap": "8px" } as CSSProperties}>
          <Icon name="lock" />
          {w.neverLabel}
        </span>
        <div className="row" style={{ "--gap": "6px" } as CSSProperties}>
          {w.never.map((n) => (
            <span key={n} className="badge ob-struck">
              {n}
            </span>
          ))}
        </div>
      </div>
      <div className="ob-actions">
        <button className="btn btn-primary" onClick={next} autoFocus>
          {w.next}
        </button>
      </div>
    </>
  );
}

type LinkState = { s: "loading" } | { s: "code"; data: PairingStart } | { s: "denied" } | { s: "expired" } | { s: "error"; message: string };

function Link({ next }: { next: () => void }) {
  const [state, setState] = useState<LinkState>({ s: "loading" });

  const request = () => {
    setState({ s: "loading" });
    agent
      .pairingStart()
      .then((data) => setState({ s: "code", data }))
      .catch((e) => setState({ s: "error", message: (e as { kind?: string }).kind === "network" ? c.link.noApi : errorText(e) }));
  };

  useEffect(() => {
    request();
    const un = agent.onPairing((e) => {
      if (e.status === "approved") next();
      else if (e.status === "denied") setState({ s: "denied" });
      else if (e.status === "expired") setState({ s: "expired" });
      else setState({ s: "error", message: e.message });
    });
    return () => void un.then((f) => f());
  }, []);

  return (
    <>
      <h1>{c.link.title}</h1>
      <p className="muted">{c.link.lead}</p>
      {state.s === "loading" ? <div className="ob-code ob-code-skeleton" aria-busy /> : null}
      {state.s === "code" ? (
        <>
          <div className="ob-code mono" aria-label={`Código ${state.data.userCode}`}>
            {state.data.userCode}
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => void agent.openWeb(new URL(state.data.verificationUriComplete).pathname + new URL(state.data.verificationUriComplete).search)}>
              {c.link.open}
            </button>
          </div>
          <p className="row faint" role="status" style={{ "--gap": "8px" } as CSSProperties}>
            <Bars size={14} breathe />
            {c.link.waiting}
          </p>
        </>
      ) : null}
      {state.s === "denied" || state.s === "expired" || state.s === "error" ? (
        <>
          <Notice tone="attention" role="alert">
            {state.s === "denied" ? c.link.denied : state.s === "expired" ? c.link.expired : state.message}
          </Notice>
          <div className="ob-actions">
            <button className="btn btn-secondary" onClick={request}>
              {c.link.retry}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}

function Permissions({ next }: { next: () => void }) {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    agent.consent().then(setConsent).catch((e) => setError(errorText(e)));
  }, []);

  const [supported, setSupported] = useState(true);
  useEffect(() => {
    agent.status().then((s) => setSupported(s.idleDetection)).catch(() => null);
  }, []);
  const checkin = consent?.find((x) => x.dataSource === "CHECKIN")?.granted ?? false;
  const desktop = consent?.find((x) => x.dataSource === "DESKTOP")?.granted ?? false;

  const toggle = async (v: boolean, source: "CHECKIN" | "DESKTOP" = "CHECKIN") => {
    setBusy(true);
    setError(null);
    try {
      setConsent(await agent.setConsent(source, v));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{c.consent.title}</h1>
      <p className="muted">{c.consent.lead}</p>
      <div className="card stack" style={{ "--gap": "16px" } as CSSProperties}>
        <SettingRow title={c.consent.checkin.title} body={c.consent.checkin.body}>
          <Switch checked={checkin} onChange={(v) => void toggle(v)} label={c.consent.checkin.title} disabled={busy || !consent} />
        </SettingRow>
        <hr className="ob-hr" />
        <SettingRow title={c.consent.passive.title} body={supported ? c.consent.passive.body : c.consent.passive.unsupported}>
          <Switch checked={desktop} onChange={(v) => void toggle(v, "DESKTOP")} label={c.consent.passive.title} disabled={busy || !consent || !supported} />
        </SettingRow>
      </div>
      {error ? <Notice tone="attention" role="alert">{error}</Notice> : null}
      <div className="ob-actions">
        <button className="btn btn-primary" onClick={next} disabled={!checkin}>
          Continuar
        </button>
        {!checkin ? <span className="faint">Activa los check-ins para continuar.</span> : null}
      </div>
    </>
  );
}

function Prefs({ next }: { next: () => void }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agent.preferences().then(setPrefs).catch((e) => setError(errorText(e)));
    agent.status().then((s) => setAutostart(s.autostart)).catch(() => null);
  }, []);

  const patch = async (p: Partial<Preferences>) => {
    setError(null);
    try {
      setPrefs(await agent.patchPreferences(p));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const quietOn = Boolean(prefs?.quietHoursStart && prefs?.quietHoursEnd);

  return (
    <>
      <h1>{c.prefs.title}</h1>
      <p className="muted">{c.prefs.lead}</p>
      <div className="card stack" style={{ "--gap": "16px" } as CSSProperties}>
        <SettingRow title={c.prefs.reminders}>
          <Switch checked={prefs?.checkinReminders ?? false} disabled={!prefs} onChange={(v) => void patch({ checkinReminders: v })} label={c.prefs.reminders} />
        </SettingRow>
        <SettingRow title={c.prefs.focus}>
          <Switch checked={prefs?.focusMode ?? false} disabled={!prefs} onChange={(v) => void patch({ focusMode: v })} label={c.prefs.focus} />
        </SettingRow>
        <SettingRow title={c.prefs.quiet}>
          <Switch
            checked={quietOn}
            disabled={!prefs}
            onChange={(v) => void patch(v ? { quietHoursStart: "20:00", quietHoursEnd: "08:00" } : { quietHoursStart: null, quietHoursEnd: null })}
            label={c.prefs.quiet}
          />
        </SettingRow>
        {quietOn && prefs ? (
          <div className="row" style={{ "--gap": "12px" } as CSSProperties}>
            <label className="field">
              {c.prefs.from}
              <input type="time" value={prefs.quietHoursStart ?? ""} onChange={(e) => e.target.value && void patch({ quietHoursStart: e.target.value })} />
            </label>
            <label className="field">
              {c.prefs.to}
              <input type="time" value={prefs.quietHoursEnd ?? ""} onChange={(e) => e.target.value && void patch({ quietHoursEnd: e.target.value })} />
            </label>
          </div>
        ) : null}
        <hr className="ob-hr" />
        <SettingRow title={c.prefs.autostart}>
          <Switch
            checked={autostart}
            onChange={(v) =>
              void agent
                .setAutostart(v)
                .then(setAutostart)
                .catch((e) => setError(String(e)))
            }
            label={c.prefs.autostart}
          />
        </SettingRow>
      </div>
      {error ? <Notice tone="attention" role="alert">{error}</Notice> : null}
      <div className="ob-actions">
        <button className="btn btn-primary" onClick={next}>
          Continuar
        </button>
      </div>
    </>
  );
}

function Done() {
  return (
    <>
      <div className="ob-hero" aria-hidden>
        <Bars size={68} enter />
      </div>
      <h1>{c.done.title}</h1>
      <p className="muted">{c.done.lead}</p>
      <p className="quote ob-tagline">Una pausa a tiempo también es productividad.</p>
      <div className="ob-actions">
        <button className="btn btn-primary" onClick={() => void agent.finishOnboarding()} autoFocus>
          {c.done.close}
        </button>
      </div>
    </>
  );
}
