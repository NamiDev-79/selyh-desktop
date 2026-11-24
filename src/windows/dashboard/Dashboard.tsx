import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { Bars, Icon, Logo, Notice, SettingRow, Switch } from "@/components/ui";
import { crisisLine, dashboardCopy as d, exerciseCopy, onboardingCopy, scale, signalLabels, signalStatus, sleepCopy, tags } from "@/content/copy";
import { agent, type Analytics, errorText, type LocalCheckin, type Preferences, type SignalDay, type SignalsOverview, type Status } from "@/lib/agent";

import "./dashboard.css";

type Tab = "today" | "checkins" | "transparency" | "preferences";
const TABS: Tab[] = ["today", "checkins", "transparency", "preferences"];
const TAB_ICON = { today: "today", checkins: "list", transparency: "shield", preferences: "sliders" } as const;
const isTab = (t: unknown): t is Tab => TABS.includes(t as Tab);

const fmt = (iso: string) => new Date(iso).toLocaleString("es-PE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Panel mínimo del agente. Todo lo demás vive en el panel web. */
export function Dashboard() {
  const [tab, setTab] = useState<Tab>("today");
  const [status, setStatus] = useState<Status | null>(null);
  const reload = useCallback(() => void agent.status().then(setStatus).catch(() => null), []);

  useEffect(() => {
    reload();
    agent.takeDashboardTab().then((t) => isTab(t) && setTab(t)).catch(() => null);
    const un = agent.onDashboardTab((t) => isTab(t) && setTab(t));
    return () => void un.then((f) => f());
  }, [reload]);

  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-brand">
          <Logo height={24} />
          <span className="dash-brand-tag">Agente</span>
        </div>
        <nav className="dash-nav" aria-label="Secciones">
          {TABS.map((t) => (
            <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              <Icon name={TAB_ICON[t]} />
              {d.tabs[t]}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ "--gap": "10px", marginTop: "auto" } as CSSProperties}>
          <button className="dash-web" onClick={() => void agent.openWeb("/panel")}>
            {d.openPanel}
            <Icon name="external" size={14} />
          </button>
          <div className="dash-crisis">
            <Icon name="phone" size={14} />
            <span>
              ¿Mal momento? <strong>{crisisLine.name}</strong>. {crisisLine.detail}.
            </span>
          </div>
          {status?.userName ? (
            <div className="dash-user">
              <span className="dash-avatar" aria-hidden>
                {status.userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="stack" style={{ "--gap": "0", minWidth: 0 } as CSSProperties}>
                <span className="dash-user-name">{status.userName}</span>
                <span className="faint">Este equipo está vinculado</span>
              </span>
            </div>
          ) : null}
        </div>
      </aside>
      <main className="dash-main fade" key={tab}>
        {tab === "today" ? <Today /> : null}
        {tab === "checkins" ? <Checkins /> : null}
        {tab === "transparency" ? <Transparency status={status} /> : null}
        {tab === "preferences" ? <PreferencesTab status={status} onChange={reload} /> : null}
      </main>
    </div>
  );
}

function Today() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    agent.analytics().then(setData).catch((e) => setError(errorText(e)));
  }, []);

  return (
    <section className="stack" style={{ "--gap": "18px" } as CSSProperties}>
      <header className="dash-head">
        <h1>
          Hoy, <span className="quote dash-accent">a tu ritmo</span>
        </h1>
        <p className="muted">Tu carga comparada contigo, no con otras personas.</p>
      </header>
      <div className="row">
        <button className="btn btn-primary" onClick={() => void agent.openCheckin()}>
          Hacer check-in ahora
        </button>
        <button className="btn btn-secondary" onClick={() => void agent.openScale()}>
          Responder escala
        </button>
        <button
          className="btn btn-secondary"
          onClick={() =>
            void agent
              .openExercise()
              .then((r) => !r.opened && setNote(exerciseCopy.noneAvailable[r.reason] ?? exerciseCopy.noneAvailable.NO_CONTENT_AVAILABLE!))
              .catch((e) => setNote(errorText(e)))
          }
        >
          Una pausa guiada
        </button>
      </div>
      {note ? <Notice>{note}</Notice> : null}
      {error ? <Notice tone="attention">{error}</Notice> : null}
      {!data && !error ? <div className="card dash-skeleton" aria-busy /> : null}
      {data ? (
        <>
          {!data.calibration.calibrated ? (
            <div className="card dash-status">
              <Bars size={42} breathe />
              <div className="stack" style={{ "--gap": "8px" } as CSSProperties}>
                <span className="badge" data-tone="brand">
                  Calibrando
                </span>
                <p>{d.calibrating(data.calibration.daysWithData, data.calibration.required)}</p>
                <div className="dash-meter" aria-hidden>
                  <span style={{ width: `${Math.min(100, (data.calibration.daysWithData / data.calibration.required) * 100)}%` }} />
                </div>
              </div>
            </div>
          ) : data.latest ? (
            <div className="card dash-status" data-level={data.latest.trendLabel}>
              <Bars size={42} breathe />
              <div className="stack" style={{ "--gap": "6px" } as CSSProperties}>
                <span className="badge" data-tone={data.latest.trendLabel === "STABLE" ? "brand" : "solid"}>
                  {d.trend[data.latest.trendLabel]}
                </span>
                <p className="dash-message">{data.latest.message}</p>
              </div>
            </div>
          ) : null}
          {data.series.length > 1 ? <Spark values={data.series.map((s) => s.zScoreAvg)} /> : null}
          <p className="faint">{data.disclaimer}</p>
        </>
      ) : null}
    </section>
  );
}

/** Tendencia de los últimos días frente a tu rango habitual (banda menta). */
function Spark({ values }: { values: number[] }) {
  const W = 520;
  const H = 120;
  const max = 1.6;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (z: number) => ((max - Math.max(-max, Math.min(max, z))) / (2 * max)) * H;
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <figure className="card stack" style={{ "--gap": "8px" } as CSSProperties}>
      <figcaption className="row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500 }}>Últimos {values.length} días</span>
        <span className="faint row" style={{ "--gap": "6px" } as CSSProperties}>
          <span className="dash-band-key" aria-hidden /> tu rango habitual
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tendencia de tu carga en los últimos días" style={{ width: "100%", height: "auto", overflow: "visible" }}>
        <defs>
          <linearGradient id="spark-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#a2a2fa" />
            <stop offset="1" stopColor="#6363f1" />
          </linearGradient>
        </defs>
        <rect x={0} y={y(0.5)} width={W} height={y(-0.5) - y(0.5)} rx={6} fill="var(--brand-tint)" />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--brand-soft)" strokeDasharray="3 5" strokeWidth={1} />
        <path d={path} fill="none" stroke="url(#spark-line)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={4.5} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2.6} />
      </svg>
    </figure>
  );
}

function Checkins() {
  const [rows, setRows] = useState<LocalCheckin[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => void agent.localCheckins().then(setRows);
  useEffect(load, []);

  const pending = rows?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <section className="stack" style={{ "--gap": "16px" } as CSSProperties}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Check-ins</h1>
        {pending ? (
          <button
            className="btn btn-secondary btn-sm"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              agent
                .syncNow()
                .then((r) => setMsg(r.sent ? `Enviados: ${r.sent}.` : "Nada nuevo para enviar."))
                .catch((e) => setMsg(errorText(e)))
                .finally(() => {
                  setSyncing(false);
                  load();
                });
            }}
          >
            Enviar {pending} en cola
          </button>
        ) : null}
      </div>
      {msg ? <Notice>{msg}</Notice> : null}
      {rows && !rows.length ? <p className="muted">Aún no hay check-ins desde este equipo. Puedes hacer uno desde el icono de la bandeja.</p> : null}
      <ul className="dash-list">
        {rows?.map((r) => (
          <li key={r.clientId}>
            <span className="dash-score" aria-label={`Respuesta ${r.score}`}>
              <span className="dash-score-bar" style={{ "--h": `${6 + r.score * 4}px` } as CSSProperties} aria-hidden />
              <span className="mono">{r.score}</span>
            </span>
            <span className="stack" style={{ "--gap": "0" } as CSSProperties}>
              <span>
                {scale.find((s) => s.value === r.score)?.label}
                {r.tag ? <span className="faint"> · {tags.find((t) => t.value === r.tag)?.label}</span> : null}
              </span>
              <span className="faint">{fmt(r.capturedAt)}</span>
            </span>
            <span className="badge" data-tone={r.status === "synced" ? "brand" : r.status === "pending" ? "solid" : undefined} title={r.reason ? d.reasons[r.reason] ?? r.reason : undefined}>
              {d.status[r.status]}
              {r.reason ? ` · ${d.reasons[r.reason] ?? r.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transparency({ status }: { status: Status | null }) {
  const [rows, setRows] = useState<LocalCheckin[]>([]);
  useEffect(() => void agent.localCheckins().then(setRows), []);
  const t = d.transparency;
  const last = rows.find((r) => r.status === "synced");

  return (
    <section className="stack" style={{ "--gap": "16px" } as CSSProperties}>
      <h1>Qué se envía</h1>
      <p className="muted">{t.lead}</p>
      <div className="card stack">
        <strong>Check-ins</strong>
        <p className="muted">{t.checkinFields}</p>
        {last ? (
          <pre className="dash-pre mono">
            {JSON.stringify({ clientId: last.clientId, score: last.score, ...(last.tag ? { tag: last.tag } : {}), source: "desktop", capturedAt: last.capturedAt }, null, 2)}
          </pre>
        ) : null}
      </div>
      <SignalsCard />
      <div className="card stack">
        <strong>Detección de pausas</strong>
        <p className="muted">{status?.idleDetection === false ? t.noIdle : t.idle}</p>
      </div>
      <div className="card card-tint stack" style={{ "--gap": "10px" } as CSSProperties}>
        <span className="row" style={{ "--gap": "8px", fontWeight: 600 } as CSSProperties}>
          <Icon name="lock" />
          {onboardingCopy.welcome.neverLabel}
        </span>
        <div className="row" style={{ "--gap": "6px" } as CSSProperties}>
          {onboardingCopy.welcome.never.map((n) => (
            <span key={n} className="badge dash-struck">
              {n}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreferencesTab({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [checkinConsent, setCheckinConsent] = useState<boolean | null>(null);
  const [sleepConsent, setSleepConsent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = onboardingCopy.prefs;

  useEffect(() => {
    agent.preferences().then(setPrefs).catch((e) => setError(errorText(e)));
    agent
      .consent()
      .then((c) => {
        setCheckinConsent(c.find((x) => x.dataSource === "CHECKIN")?.granted ?? false);
        setSleepConsent(c.find((x) => x.dataSource === "SLEEP")?.granted ?? false);
      })
      .catch(() => null);
  }, []);

  const patch = async (v: Partial<Preferences>) => {
    setError(null);
    try {
      setPrefs(await agent.patchPreferences(v));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const quietOn = Boolean(prefs?.quietHoursStart && prefs?.quietHoursEnd);
  const paused = status?.pausedUntil ? new Date(status.pausedUntil) : null;

  return (
    <section className="stack" style={{ "--gap": "16px" } as CSSProperties}>
      <h1>Preferencias</h1>
      {error ? <Notice tone="attention">{error}</Notice> : null}
      <div className="card stack" style={{ "--gap": "14px" } as CSSProperties}>
        <SettingRow title={p.reminders}>
          <Switch checked={prefs?.checkinReminders ?? false} disabled={!prefs} onChange={(v) => void patch({ checkinReminders: v })} label={p.reminders} />
        </SettingRow>
        <SettingRow title={sleepCopy.consent.title} body={sleepCopy.consent.body}>
          <Switch
            checked={sleepConsent ?? false}
            disabled={sleepConsent === null}
            onChange={(v) =>
              void agent
                .setConsent("SLEEP", v)
                .then((c) => setSleepConsent(c.find((x) => x.dataSource === "SLEEP")?.granted ?? false))
                .catch((e) => setError(errorText(e)))
            }
            label={sleepCopy.consent.title}
          />
        </SettingRow>
        <SettingRow title={p.focus}>
          <Switch checked={prefs?.focusMode ?? false} disabled={!prefs} onChange={(v) => void patch({ focusMode: v })} label={p.focus} />
        </SettingRow>
        <SettingRow title={p.quiet} body={quietOn ? `${prefs?.quietHoursStart} a ${prefs?.quietHoursEnd}` : "Apagadas"}>
          <Switch
            checked={quietOn}
            disabled={!prefs}
            onChange={(v) => void patch(v ? { quietHoursStart: "20:00", quietHoursEnd: "08:00" } : { quietHoursStart: null, quietHoursEnd: null })}
            label={p.quiet}
          />
        </SettingRow>
        {quietOn && prefs ? (
          <div className="row" style={{ "--gap": "12px" } as CSSProperties}>
            <label className="field">
              {p.from}
              <input type="time" value={prefs.quietHoursStart ?? ""} onChange={(e) => e.target.value && void patch({ quietHoursStart: e.target.value })} />
            </label>
            <label className="field">
              {p.to}
              <input type="time" value={prefs.quietHoursEnd ?? ""} onChange={(e) => e.target.value && void patch({ quietHoursEnd: e.target.value })} />
            </label>
          </div>
        ) : null}
      </div>

      <SensorPrefs onError={setError} />

      <div className="card stack" style={{ "--gap": "14px" } as CSSProperties}>
        <SettingRow title="Permiso de check-ins" body="Revocarlo detiene el envío; lo que respondas queda en la cola de este equipo.">
          <Switch
            checked={checkinConsent ?? false}
            disabled={checkinConsent === null}
            onChange={(v) =>
              void agent
                .setConsent("CHECKIN", v)
                .then((c) => setCheckinConsent(c.find((x) => x.dataSource === "CHECKIN")?.granted ?? false))
                .catch((e) => setError(errorText(e)))
            }
            label="Permiso de check-ins"
          />
        </SettingRow>
        <SettingRow title={p.autostart}>
          <Switch
            checked={status?.autostart ?? false}
            onChange={(v) =>
              void agent
                .setAutostart(v)
                .then(onChange)
                .catch((e) => setError(String(e)))
            }
            label={p.autostart}
          />
        </SettingRow>
        <SettingRow title="Pausar el agente" body={paused ? `En pausa hasta las ${paused.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}` : "No aparece ningún check-in mientras esté en pausa."}>
          {paused ? (
            <button className="btn btn-secondary btn-sm" onClick={() => void agent.pause(null).then(onChange)}>
              Reanudar
            </button>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => void agent.pause(60).then(onChange)}>
              1 hora
            </button>
          )}
        </SettingRow>
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={() => void agent.logout()}>
          Cerrar sesión en este equipo
        </button>
      </div>
    </section>
  );
}

function Metrics({ m }: { m: SignalDay["metrics"] }) {
  return (
    <dl className="dash-metrics">
      {Object.entries(m).map(([k, v]) => (
        <div key={k}>
          <dt className="faint">{signalLabels[k]?.label ?? k}</dt>
          <dd className="mono">{signalLabels[k]?.fmt(v as number) ?? String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Señales del escritorio: lo de hoy (aún en tu equipo) y lo enviado cada día, índice por índice. */
function SignalsCard() {
  const [o, setO] = useState<SignalsOverview | null>(null);
  useEffect(() => void agent.signals().then(setO), []);
  const t = d.transparency;
  if (!o) return null;
  return (
    <div className="card stack" style={{ "--gap": "12px" } as CSSProperties}>
      <strong>Señales del escritorio</strong>
      {!o.consent ? (
        <p className="muted">{t.passiveOff}</p>
      ) : (
        <>
          <p className="muted">{t.passiveOn}</p>
          {o.today ? (
            <div className="stack" style={{ "--gap": "6px" } as CSSProperties}>
              <span className="badge">{signalStatus.open}</span>
              <Metrics m={o.today.metrics} />
            </div>
          ) : (
            <p className="faint">Hoy todavía no hay actividad registrada.</p>
          )}
        </>
      )}
      {o.days.length ? (
        <details>
          <summary className="faint" style={{ cursor: "pointer" }}>
            Días anteriores ({o.days.length})
          </summary>
          <ul className="dash-days">
            {o.days.map((day) => (
              <li key={day.date}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong className="mono">{day.date}</strong>
                  <span className="badge" data-tone={day.status === "sent" ? "brand" : day.status === "pending" ? "solid" : undefined}>
                    {signalStatus[day.status]}
                    {day.sentAt ? ` · ${new Date(day.sentAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}` : ""}
                  </span>
                </div>
                <pre className="dash-pre mono">{JSON.stringify({ date: day.date, sourceType: "DESKTOP", metrics: day.metrics }, null, 2)}</pre>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Permiso del sensor y horario laboral (el horario solo vive en este equipo). */
function SensorPrefs({ onError }: { onError: (m: string) => void }) {
  const [o, setO] = useState<SignalsOverview | null>(null);
  const load = () => void agent.signals().then(setO);
  useEffect(load, []);
  if (!o) return null;
  const wh = o.workHours;
  const save = (next: typeof wh) =>
    void agent
      .setWorkHours(next)
      .then(load)
      .catch((e) => onError(String(e)));

  return (
    <div className="card stack" style={{ "--gap": "14px" } as CSSProperties}>
      <SettingRow title={onboardingCopy.consent.passive.title} body={o.supported ? onboardingCopy.consent.passive.body : onboardingCopy.consent.passive.unsupported}>
        <Switch
          checked={o.consent}
          disabled={!o.supported}
          onChange={(v) =>
            void agent
              .setConsent("DESKTOP", v)
              .then(load)
              .catch((e) => onError(errorText(e)))
          }
          label={onboardingCopy.consent.passive.title}
        />
      </SettingRow>
      <SettingRow title="Horario laboral" body="Sirve para separar el trabajo fuera de horario. Solo se guarda en este equipo.">
        <span />
      </SettingRow>
      <div className="row" style={{ "--gap": "12px", alignItems: "end" } as CSSProperties}>
        <label className="field">
          Desde
          <input type="time" value={wh.start} onChange={(e) => e.target.value && save({ ...wh, start: e.target.value })} />
        </label>
        <label className="field">
          Hasta
          <input type="time" value={wh.end} onChange={(e) => e.target.value && save({ ...wh, end: e.target.value })} />
        </label>
        <label className="row" style={{ "--gap": "6px", fontSize: 13 } as CSSProperties}>
          <input type="checkbox" checked={wh.weekends} onChange={(e) => save({ ...wh, weekends: e.target.checked })} />
          Trabajo fines de semana
        </label>
      </div>
    </div>
  );
}
