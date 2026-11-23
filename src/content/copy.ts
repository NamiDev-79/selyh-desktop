/** Textos del agente. Tono: cercano, breve y sin alarmas. Edita aquí sin tocar componentes. */
import type { Tag } from "@/lib/agent";

export const scale = [
  { value: 1, label: "Tranquilo" },
  { value: 2, label: "Bien" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Cargado" },
  { value: 5, label: "Muy cargado" },
] as const;

export const tags: { value: Tag; label: string }[] = [
  { value: "meeting", label: "Reuniones" },
  { value: "bug", label: "Un bug" },
  { value: "deadline", label: "Un plazo" },
  { value: "oncall", label: "Guardia" },
  { value: "review", label: "Revisión" },
  { value: "other", label: "Otra cosa" },
];

export const checkinCopy = {
  question: "¿Cómo vas?",
  hint: "Responde con las teclas 1 a 5 · Esc para cerrar",
  tagPrompt: "¿Algo en particular? (opcional)",
  thanks: "Anotado. Gracias.",
  queued: "Anotado. Lo enviamos cuando vuelva la conexión.",
  needsConsent: "Anotado, pero falta activar el permiso de check-ins. Lo enviaremos cuando lo actives.",
  /** Si nadie responde, se cierra solo y no insiste. */
  autoCloseSeconds: 45,
};

export const onboardingCopy = {
  welcome: {
    title: "Hola, soy Selyh",
    lead: "Vivo en la bandeja del sistema y aparezco solo en pausas naturales para preguntarte cómo vas. Un toque y sigues con lo tuyo.",
    does: ["Check-ins de un toque, del 1 al 5", "Te aviso con calma cuando tu carga sube frente a tu línea base", "Respeto tus horas de silencio y el modo foco"],
    never: ["Teclas ni texto", "Capturas de pantalla", "Títulos de ventanas ni apps", "URLs ni nombres de archivos"],
    neverLabel: "Lo que nunca recojo",
    next: "Empezar",
  },
  link: {
    title: "Vincula este equipo",
    lead: "Aprueba este código en la web de Selyh. No tienes que escribir tu contraseña aquí.",
    open: "Abrir la web para aprobar",
    waiting: "Esperando la aprobación…",
    denied: "Rechazaste la vinculación. Si fue un error, pide un código nuevo.",
    expired: "El código venció. Pide uno nuevo.",
    retry: "Pedir otro código",
    noApi: "No pudimos conectar con Selyh. Revisa tu conexión e intenta de nuevo.",
  },
  consent: {
    title: "Tus permisos",
    lead: "Cada fuente de datos se activa por separado y la puedes revocar cuando quieras desde la web o desde aquí.",
    checkin: {
      title: "Check-ins",
      body: "Tu respuesta del 1 al 5 y, si quieres, una etiqueta (reuniones, guardia…). Es lo mínimo para que Selyh funcione.",
    },
    passive: {
      title: "Señales del escritorio (opcional)",
      body: "Horas activas, pausas, sesión continua más larga y trabajo fuera de horario, calculados en tu equipo. Solo se envía el resumen del día. Nunca teclas, ventanas, apps ni archivos.",
      unsupported: "En este sistema todavía no podemos medir la actividad, así que no se calcula nada.",
    },
  },
  prefs: {
    title: "Cuándo aparezco",
    lead: "Puedes cambiarlo después en Preferencias.",
    reminders: "Recordarme hacer check-in",
    focus: "Modo foco: solo en pausas naturales",
    quiet: "Horas de silencio",
    from: "Desde",
    to: "Hasta",
    autostart: "Iniciar Selyh con el sistema",
  },
  done: {
    title: "Todo listo",
    lead: "Me quedo en la bandeja. Aparezco cuando vuelvas de una pausa; también puedes hacer un check-in cuando quieras desde el icono.",
    close: "Cerrar",
  },
};

export const dashboardCopy = {
  tabs: { today: "Hoy", checkins: "Check-ins", transparency: "Qué se envía", preferences: "Preferencias" } as Record<string, string>,
  calibrating: (days: number, required: number) => `${days} de ${required} días con datos. Mientras tanto no inventamos un número.`,
  trend: { STABLE: "Estable", RISING: "En aumento", HIGH: "Alta" } as Record<string, string>,
  openPanel: "Mi panel en la web",
  status: { pending: "En cola", synced: "Enviado", rejected: "Descartado" } as Record<string, string>,
  reasons: {
    CONSENT_REQUIRED: "esperando el permiso de check-ins",
    TOO_OLD: "tenía más de 30 días",
    FUTURE: "fecha del equipo adelantada",
    INVALID: "dato inválido",
  } as Record<string, string>,
  transparency: {
    lead: "Esto es exactamente lo que el agente envía a Selyh. Nada más.",
    checkinFields: "Por cada check-in: tu respuesta (1 a 5), la etiqueta si elegiste una, la hora y un identificador aleatorio para no duplicarlo.",
    passiveOff: "Las señales del escritorio están apagadas: el agente no calcula ni envía ningún índice de actividad.",
    passiveOn: "Una vez al día, cuando el día termina, se envía este resumen. El de hoy se sigue calculando en tu equipo y todavía no salió de él.",
    idle: "Para detectar pausas, el agente mira solo cuántos segundos pasaron desde que tocaste el teclado o el ratón. Ese número no sale de tu equipo.",
    noIdle: "En este sistema el agente aún no detecta pausas: aparece según tus recordatorios.",
  },
};

export const crisisLine = { name: "Línea 113, opción 5 (MINSA)", detail: "Gratis, las 24 horas" };

export const signalLabels: Record<string, { label: string; fmt: (v: number) => string }> = {
  hoursActive: { label: "Horas activas", fmt: (v) => `${v.toFixed(1)} h` },
  afterHoursMinutes: { label: "Fuera de horario", fmt: (v) => `${v} min` },
  breaks: { label: "Pausas de 5 min o más", fmt: (v) => `${v}` },
  breakMinutes: { label: "Tiempo en pausas", fmt: (v) => `${v} min` },
  longestSessionMinutes: { label: "Sesión continua más larga", fmt: (v) => `${v} min` },
  firstActivityMinute: { label: "Inicio de la jornada", fmt: (v) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}` },
  lastActivityMinute: { label: "Fin de la jornada", fmt: (v) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}` },
};

export const signalStatus: Record<string, string> = { open: "Hoy · en tu equipo", pending: "Por enviar", sent: "Enviado", rejected: "No aceptado" };

export const scaleCopy = {
  intro: (name: string, answered: number, total: number) => (answered ? `${name}: llevas ${answered} de ${total}.` : `${name}: unas pocas preguntas, a tu ritmo.`),
  item: (n: number) => `Pregunta ${n}`,
  later: "Más tarde",
  saving: "Guardando…",
  partDone: "Listo por hoy. Guardamos tus respuestas y seguimos otro día.",
  finish: "Ver resultado",
  resultNote: "Es una referencia, no un diagnóstico.",
  close: "Cerrar",
  none: "No hay preguntas pendientes por hoy.",
  crisis: {
    title: "Gracias por responder con sinceridad",
    lead: "Lo que contaste importa. No tienes que pasarlo sola ni solo: estas líneas atienden personas, gratis.",
    urgent: "Si sientes que puedes hacerte daño ahora, llama al 106 (SAMU) o acude a emergencias.",
    continue: "Seguir con las preguntas",
    seeResult: "Ver mi resultado",
    close: "Cerrar por ahora",
  },
};

export const exerciseCopy = {
  ask: (title: string, minutes: number) => `¿${title.replace(/\s*\(.*\)$/, "")}? Toma ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
  now: "Ahora",
  later: "Más tarde",
  no: "No, gracias",
  done: "Terminé",
  helpful: "¿Te sirvió?",
  yes: "Sí",
  notReally: "No mucho",
  thanks: "Gracias. Con esto ajustamos lo que te sugerimos.",
  inhale: "Inhala",
  hold: "Sostén",
  exhale: "Exhala",
  offerAfterCheckin: "¿Una pausa guiada de unos minutos?",
  noneAvailable: {
    DAILY_CAP_REACHED: "Ya llegaste al tope de pausas sugeridas por hoy.",
    PENDING_SUGGESTION: "Tienes una pausa pendiente de responder.",
    NO_CONTENT_AVAILABLE: "Por ahora no hay ejercicios nuevos para ti.",
    OPEN_CRISIS_FLAG: "Ahora lo importante es hablar con alguien. Revisa las líneas de ayuda.",
  } as Record<string, string>,
};
