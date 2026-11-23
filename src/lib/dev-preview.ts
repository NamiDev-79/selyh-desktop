/**
 * Solo en desarrollo y fuera de Tauri: simula el núcleo para revisar el diseño de cada ventana en
 * un navegador normal. Abre http://localhost:1420/?view=checkin (u onboarding, dashboard, scale, exercise).
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

const data: Record<string, unknown> = {
  app_status: {
    linked: true,
    onboarded: true,
    userName: "Ana",
    pending: 1,
    pausedUntil: null,
    autostart: true,
    webUrl: "http://localhost:5173",
    passiveSignals: false,
    idleDetection: true,
  },
  pairing_start: { userCode: "KQ7M-2XHD", verificationUriComplete: "http://localhost:5173/device?code=KQ7M-2XHD", expiresIn: 600 },
  submit_checkin: { checkin: {}, synced: true, waitingConsent: false },
  local_checkins: [
    { clientId: "a", score: 4, tag: "oncall", capturedAt: iso(1), status: "pending", reason: null },
    { clientId: "b", score: 3, tag: null, capturedAt: iso(20), status: "synced", reason: null },
    { clientId: "c", score: 2, tag: "review", capturedAt: iso(44), status: "synced", reason: null },
  ],
  get_analytics: {
    calibration: { daysWithData: 9, required: 14, calibrated: false },
    latest: null,
    series: [-0.2, 0.1, 0, 0.3, 0.2, 0.5, 0.4, 0.7, 0.6].map((z, i) => ({ date: `2026-11-0${i + 1}`, zScoreAvg: z, trendLabel: "STABLE" })),
    disclaimer: "Selyh no diagnostica. Compara tu carga contigo, no con otras personas.",
  },
  get_consent: [{ dataSource: "CHECKIN", granted: true, grantedAt: iso(48) }],
  get_preferences: { reminderTimes: ["11:00", "17:00"], quietHoursStart: "20:00", quietHoursEnd: "08:00", focusMode: false, checkinReminders: true, weeklySummary: true, dailySuggestionCap: 2 },
  take_dashboard_tab: null,
  scale_batch: {
    scale: { code: "PHQ9", name: "PHQ-9", reason: "DUE", answered: 0, total: 9, nextItems: [8, 0, 1], daysSinceLast: null },
    meta: {
      code: "PHQ9",
      name: "PHQ-9",
      items: 9,
      minPerItem: 0,
      maxPerItem: 3,
      maxScore: 27,
      available: true,
      text: {
        about: "Cómo ha estado tu ánimo.",
        period: "Durante las últimas 2 semanas, ¿qué tan seguido ha tenido molestias debido a los siguientes problemas?",
        options: ["Ningún día", "Varios días", "Más de la mitad de los días", "Casi todos los días"],
        items: ["Poco interés o placer en hacer cosas", "Se ha sentido decaído(a), deprimido(a) o sin esperanzas", "Ha tenido dificultad para quedarse o permanecer dormido(a), o ha dormido demasiado", "", "", "", "", "", "Pensamientos de que estaría mejor muerto(a) o de lastimarse de alguna manera"],
        source: "PHQ-9",
      },
    },
  },
  scale_answer: { code: "PHQ9", name: "PHQ-9", total: 9, answered: 1, answers: [], nextItems: [0, 1], startedAt: iso(0), updatedAt: iso(0), crisis: null },
  exercise_current: {
    id: "00000000-0000-4000-8000-000000000001",
    suggestedAt: iso(0),
    intervention: { id: "x", title: "Respiración en caja (1 min)", bodyMarkdown: "Inhala contando 4, sostén 4, exhala 4, sostén 4. Repite 4 ciclos con los hombros relajados.", durationMinutes: 1, category: "BREATHING" },
  },
  signals_overview: {
    consent: true,
    supported: true,
    workHours: { start: "09:00", end: "18:00", weekends: false },
    today: { date: "2026-11-10", status: "open", sentAt: null, metrics: { hoursActive: 5.4, afterHoursMinutes: 12, breaks: 3, breakMinutes: 41, longestSessionMinutes: 118, firstActivityMinute: 545, lastActivityMinute: 1012 } },
    days: [
      { date: "2026-11-09", status: "sent", sentAt: iso(10), metrics: { hoursActive: 7.9, afterHoursMinutes: 64, breaks: 2, breakMinutes: 25, longestSessionMinutes: 171, firstActivityMinute: 520, lastActivityMinute: 1265 } },
    ],
  },
};

export function installPreview() {
  const view = new URLSearchParams(location.search).get("view") ?? "checkin";
  mockWindows(view);
  mockIPC(async (cmd, args) => {
    if (cmd === "submit_checkin") await new Promise((r) => setTimeout(r, 400));
    // Igual que la API: ítem de seguridad del PHQ-9 (índice 8) mayor que 0 → recursos de ayuda.
    const a = args as { index?: number; value?: number } | undefined;
    if (cmd === "scale_answer" && a?.index === 8 && (a.value ?? 0) > 0) {
      return { ...(data.scale_answer as object), crisis: { resources: [{ id: "1", region: "PE", type: "HOTLINE", name: "Línea 113 (MINSA) – opción 5, salud mental", contactInfo: "113 opción 5", locale: "es" }, { id: "2", region: "PE", type: "EMERGENCY", name: "SAMU – emergencias médicas", contactInfo: "106", locale: "es" }] } };
    }
    if (cmd === "set_consent") return data.get_consent;
    if (cmd === "patch_preferences") return data.get_preferences;
    return data[cmd] ?? null;
  });
}
