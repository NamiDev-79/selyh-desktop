import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/space-grotesk";
import "@fontsource/lora/500-italic.css";
import "./styles/app.css";

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Checkin } from "./windows/checkin/Checkin";
import { Dashboard } from "./windows/dashboard/Dashboard";
import { Exercise } from "./windows/exercise/Exercise";
import { Onboarding } from "./windows/onboarding/Onboarding";
import { Scale } from "./windows/scale/Scale";

// Todas las ventanas cargan este mismo archivo; la etiqueta de la ventana decide la vista.
const views = { checkin: Checkin, scale: Scale, exercise: Exercise, onboarding: Onboarding, dashboard: Dashboard } as const;

async function boot() {
  if (import.meta.env.DEV && !isTauri()) (await import("./lib/dev-preview")).installPreview();
  const label = getCurrentWindow().label as keyof typeof views;
  const View = views[label] ?? Dashboard;
  document.documentElement.dataset.view = label;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <View />
    </StrictMode>,
  );
}

void boot();
