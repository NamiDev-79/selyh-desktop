# Selyh – Agente de escritorio (Tauri 2)

App ligera que vive en la bandeja del sistema. Aparece solo en pausas naturales para un check-in de un toque y funciona sin conexión. Se apoya en la API v2.2 del backend; no necesita endpoints nuevos.

## Correr

Requisitos: Node 20+, Rust 1.90+ y, en Windows, las Build Tools de Visual Studio (C++) y WebView2 (viene con Windows 11).

```bash
npm install
npm run app        # tauri dev: interfaz en Vite (puerto 1420) + núcleo en Rust
npm run bundle     # instaladores firmables (NSIS/MSI en Windows)
```

Variables (opcionales, en el entorno o al compilar):

| Variable | Por defecto | Para qué |
|---|---|---|
| `SELYH_API_URL` | `https://selyhbackend-production.up.railway.app` | API de Selyh (para la local: `http://localhost:3000`) |
| `SELYH_WEB_URL` | `https://selyh.fun` | Web (para la local: `http://localhost:5173`), para aprobar el código y abrir el panel |
| `SELYH_PROFILE` | (vacío) | Solo para desarrollo: usa otra entrada del llavero y otra base local (p. ej. `prueba`) para probar con otra cuenta sin tocar la sesión real |

**Vista previa del diseño sin Tauri:** `npm run dev` y abre `http://localhost:1420/?view=checkin` (u `onboarding`, `dashboard`). En desarrollo y fuera de Tauri, `src/lib/dev-preview.ts` simula el núcleo con datos de ejemplo.

Otros comandos: `npm run typecheck`, `npm run sdk` (regenera los tipos desde `../backend/openapi/openapi.json`), `cargo check` en `src-tauri/`.

## Qué hace

Cubre los pasos 1 a 7 del orden de construcción de la descripción (falta el 8: firma y actualizaciones).

1. **Base:** bandeja con menú, ventanas, inicio con el sistema, una sola instancia y el sistema de diseño de Selyh (barras de pausa, índigo y azul tinta, Bricolage + Space Grotesk + Lora; claro u oscuro según el sistema).
2. **Vinculación con código:** `POST /auth/device/start` y sondeo de `/auth/device/token`; la persona aprueba en `/device` de la web. Los tokens van al llavero del sistema, en una sola entrada, para que cada rotación del refresh token sea atómica.
3. **Check-in de un toque y cola offline:** mini ventana que no roba el foco, teclas 1 a 5 y Esc. Cada check-in se guarda primero en SQLite con su `clientId` y se envía con `POST /sync`. Si falta el permiso, queda en cola hasta que se active. Tras un 4 o un 5 se *ofrece* una pausa guiada; nunca se abre sola.
4. **Pausas naturales:** el agente pregunta al volver de 5 minutos sin usar el equipo y, fuera del modo foco, también el check-in cada 45 minutos como mucho. `GET /prompts/next` decide qué toca. Nada aparece mientras escribes, con pantalla completa o en "no molestar". En cada pausa se muestra **una sola cosa**, en este orden:
   - el check-in;
   - una tanda de escala (como máximo una al día);
   - un ejercicio, si el servidor lo sugiere (como máximo uno cada 2 horas).
5. **Escalas por partes y crisis:** 2 o 3 preguntas por tanda, guardadas una a una con `PUT /scales/:code/progress`. En el PHQ-9 el ítem de seguridad va primero; si es mayor que 0, los recursos de ayuda aparecen **en la misma ventana, al instante**. Al terminar, `POST …/complete` con `source: "desktop"` muestra el resultado (referencial, no un diagnóstico). El texto de los ítems y de las opciones lo aprueba el personal clínico y llega de la API (`GET /scales`).
6. **Micro-intervenciones:** la propuesta ofrece "Ahora", "Más tarde" o "No". El ejercicio corre en la mini ventana: la respiración guiada tiene un círculo que se expande y se contrae; los demás ejercicios, un temporizador. Al final, "¿te sirvió?" (`/respond` y `/feedback`).
7. **Sensor pasivo (opcional, apagado por defecto):** con el permiso `DESKTOP`, cada 15 s mira solo cuántos segundos pasaron sin teclado ni ratón y acumula un resumen del día en SQLite:
   - horas activas;
   - trabajo fuera de horario;
   - pausas de 5 minutos o más y su duración;
   - sesión continua más larga;
   - inicio y fin de la jornada.

   Solo se envía el resumen de cada día ya cerrado (`POST /sync`, `sourceType: "DESKTOP"`). Revocar el permiso detiene el cálculo y borra lo no enviado. El horario laboral vive solo en el equipo.

**Panel mínimo:**
- **Hoy:** el estado o "calibrando", y botones para hacer un check-in, responder la escala o hacer una pausa guiada.
- **Check-ins:** los últimos, con su estado.
- **Qué se envía:** el resumen de hoy, que sigue en el equipo, y cada día enviado con el JSON exacto.
- **Preferencias:** permisos, horario laboral, modo foco, horas de silencio y pausa.

## Dónde cambiar cada cosa

| Quiero cambiar… | Archivo |
|---|---|
| Textos | `src/content/copy.ts` |
| Colores, tipografía y componentes base | `src/styles/app.css` (tokens del manual de marca) y `src/components/ui.tsx` (barras, logotipo, iconos) |
| Cuándo aparece cada cosa | constantes al inicio de `src-tauri/src/scheduler.rs` |
| Cómo se calculan las señales | `src-tauri/src/sensor.rs` (tiene pruebas: `cargo test`) |
| Texto de las escalas | `../web/src/content/scales.ts` (compartido con la web) |
| Menú de la bandeja | `src-tauri/src/tray.rs` |
| Permisos de las ventanas | `src-tauri/capabilities/default.json` |

## Arquitectura

```
src-tauri/src/
  lib.rs         arranque, plugins, la app sigue viva sin ventanas
  config.rs      URLs de la API y la web
  keychain.rs    sesión en el llavero del sistema
  api.rs         cliente HTTP, refresh rotativo con una sola rotación en paralelo
  auth.rs        vinculación con código
  sync.rs        cola offline (SQLite) y POST /sync
  activity.rs    segundos sin teclado/ratón y "no molestar" (sin contenido)
  sensor.rs      resumen diario de actividad (solo con el permiso DESKTOP)
  scheduler.rs   cuándo mostrar el check-in, la escala o el ejercicio
  tray.rs        icono y menú; icon.rs dibuja el icono (punto ámbar si hay check-in pendiente)
  windows.rs     ventanas de check-in, bienvenida y panel
  commands.rs    lo único que la interfaz puede pedir al núcleo
src/
  windows/       checkin, scale, exercise, onboarding, dashboard (la etiqueta de la ventana elige la vista)
  lib/agent.ts   puente tipado con el núcleo; tipos de la API desde openapi.json
  content/       textos
```

**Seguridad.** La interfaz nunca ve tokens ni llama a la API: solo invoca comandos con lo justo. Las capacidades de Tauri solo permiten eventos y manejar la propia ventana; abrir la web y el inicio con el sistema pasan por el núcleo. No hay acceso al sistema de archivos.

## Pendiente

- **Textos con licencia de las escalas:** mientras `../web/src/content/scales.ts` no tenga los ítems validados, se muestra "Pregunta N". Probar el flujo de crisis con la psicóloga antes del piloto.
- **Detección de inactividad en macOS y Linux:** hoy solo existe en Windows (`GetLastInputInfo`). En los otros sistemas el sensor no calcula nada y lo dice; las pausas naturales se reemplazan por los recordatorios.
- **Validar los índices** en el piloto (prueba de ablación). El estimado del servidor usa `desktop.hoursActive`, `afterHoursMinutes`, `longestSessionMinutes` y `breakMinutes` con pesos heurísticos (`backend/src/modules/analytics/model.ts`).
- **Cierre de la jornada** como pausa natural.
- **Firma de código, notarización y actualizador** (paso 8).
