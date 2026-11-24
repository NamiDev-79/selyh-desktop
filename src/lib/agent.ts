/**
 * Puente con el núcleo en Rust. La interfaz nunca toca tokens ni llama a la API directamente:
 * pide cada cosa con un comando. Los tipos de las respuestas del servidor salen de openapi.json.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { paths } from "./api/schema";

type Ok<T> = T extends { responses: infer R } ? (200 extends keyof R ? R[200] : 201 extends keyof R ? R[201] : never) : never;
type Json<T> = T extends { content: { "application/json": infer J } } ? J : never;
/** Tipo de la respuesta exitosa de una ruta de la API. */
export type Res<P extends keyof paths, M extends keyof paths[P]> = Json<Ok<paths[P][M]>>;

export type Analytics = Res<"/analytics/me", "get">;
export type Consent = Res<"/consent", "get">;
export type Preferences = Res<"/preferences", "get">;
export type ConsentSource = Consent[number]["dataSource"];
export type ScaleProgress = Res<"/scales/{code}/progress", "put">;
export type ScaleResult = Res<"/scales/{code}/progress/complete", "post">;
export type ScaleMeta = Res<"/scales", "get">[number];
export type NextPrompt = Res<"/prompts/next", "get">;
export type ScaleBatch = { scale: NonNullable<NextPrompt["scale"]>; meta: ScaleMeta | null } | { scale: null };
export type Suggestion = NonNullable<Res<"/interventions/suggestions/next", "post">["suggestion"]>;
export type CrisisResource = NonNullable<ScaleProgress["crisis"]>["resources"][number];

export type WorkHours = { start: string; end: string; weekends: boolean };
export type SignalMetrics = {
  hoursActive: number;
  afterHoursMinutes: number;
  breaks: number;
  breakMinutes: number;
  longestSessionMinutes: number;
  firstActivityMinute?: number;
  lastActivityMinute?: number;
};
export type SignalDay = { date: string; status: "open" | "pending" | "sent" | "rejected"; sentAt: string | null; metrics: SignalMetrics };
export type SignalsOverview = { consent: boolean; supported: boolean; workHours: WorkHours; today: SignalDay | null; days: SignalDay[] };
export type Tag = "meeting" | "bug" | "deadline" | "oncall" | "review" | "other";

export type Status = {
  linked: boolean;
  onboarded: boolean;
  userName: string | null;
  pending: number;
  pausedUntil: string | null;
  autostart: boolean;
  webUrl: string;
  passiveSignals: boolean;
  idleDetection: boolean;
};

export type LocalCheckin = {
  clientId: string;
  score: number;
  tag: Tag | null;
  capturedAt: string;
  status: "pending" | "synced" | "rejected";
  reason: string | null;
};

export type PairingStart = { userCode: string; verificationUriComplete: string; expiresIn: number };
export type PairingEvent = { status: "approved"; name: string } | { status: "denied" } | { status: "expired" } | { status: "error"; message: string };

/** Error tal como lo serializa el núcleo. */
export type AgentError = { kind: "network" | "unlinked" | "http"; status: number | null; code: string | null; message: string };

export const agent = {
  status: () => invoke<Status>("app_status"),
  pairingStart: () => invoke<PairingStart>("pairing_start"),
  finishOnboarding: () => invoke<void>("finish_onboarding"),
  logout: () => invoke<void>("logout"),

  submitCheckin: (score: number, tag?: Tag) =>
    invoke<{ checkin: LocalCheckin; synced: boolean; waitingConsent: boolean }>("submit_checkin", { score, tag: tag ?? null }),
  openCheckin: () => invoke<void>("open_checkin"),
  dismissCheckin: () => invoke<void>("dismiss_checkin"),
  closeCheckin: () => invoke<void>("close_checkin"),
  localCheckins: () => invoke<LocalCheckin[]>("local_checkins"),
  syncNow: () => invoke<{ sent: number; waitingConsent: number; rejected: number }>("sync_now"),

  analytics: () => invoke<Analytics>("get_analytics"),
  consent: () => invoke<Consent>("get_consent"),
  sleepPrompt: (date: string) => invoke<boolean>("sleep_prompt", { date }),
  logSleep: (date: string, quality: number, hours?: number) => invoke<unknown>("log_sleep", { date, quality, hours: hours ?? null }),
  setConsent: (source: ConsentSource, granted: boolean) => invoke<Consent>("set_consent", { source, granted }),
  preferences: () => invoke<Preferences>("get_preferences"),
  patchPreferences: (patch: Partial<Preferences>) => invoke<Preferences>("patch_preferences", { patch }),

  setAutostart: (enabled: boolean) => invoke<boolean>("set_autostart", { enabled }),
  pause: (minutes: number | null) => invoke<void>("pause", { minutes }),
  openWeb: (path: string) => invoke<void>("open_web", { path }),
  takeDashboardTab: () => invoke<string | null>("take_dashboard_tab"),

  scaleBatch: () => invoke<ScaleBatch>("scale_batch"),
  scaleAnswer: (code: string, index: number, value: number) => invoke<ScaleProgress>("scale_answer", { code, index, value }),
  scaleComplete: (code: string) => invoke<ScaleResult>("scale_complete", { code }),
  scaleLater: () => invoke<void>("scale_later"),
  openScale: () => invoke<void>("open_scale"),

  openExercise: () => invoke<{ reason: string; opened: boolean }>("open_exercise"),
  exerciseCurrent: () => invoke<Suggestion | null>("exercise_current"),
  exerciseRespond: (id: string, response: "ACCEPTED" | "POSTPONED" | "DISMISSED") => invoke<unknown>("exercise_respond", { id, response }),
  exerciseFeedback: (id: string, helpful: boolean) => invoke<unknown>("exercise_feedback", { id, helpful }),
  closeFloating: (label: "checkin" | "scale" | "exercise") => invoke<void>("close_floating", { label }),

  signals: () => invoke<SignalsOverview>("signals_overview"),
  setWorkHours: (hours: WorkHours) => invoke<WorkHours>("set_work_hours", { hours }),

  onPairing: (fn: (e: PairingEvent) => void): Promise<UnlistenFn> => listen<PairingEvent>("pairing", (e) => fn(e.payload)),
  onDashboardTab: (fn: (tab: string) => void): Promise<UnlistenFn> => listen<string>("dashboard-tab", (e) => fn(e.payload)),
};

export function errorText(e: unknown): string {
  const err = e as Partial<AgentError> | undefined;
  if (err?.kind === "network") return "Sin conexión con Selyh. Lo guardamos y lo enviamos cuando vuelva la red.";
  if (err?.kind === "unlinked") return "El agente no está vinculado a tu cuenta.";
  if (err?.code === "CONSENT_REQUIRED") return "Falta activar el permiso para esa fuente de datos.";
  return err?.message ?? "Algo salió mal. Intenta de nuevo.";
}
