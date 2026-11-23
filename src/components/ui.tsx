import type { CSSProperties, ReactNode } from "react";

// Geometría del logotipo en trazos: la misma que usa la web (una sola fuente).
import { LOGO_LETTERS, LOGO_SHORT, LOGO_TALL, LOGO_VIEWBOX } from "../../../web/src/components/brand/logo-geometry";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)} />;
}

/** Fila con texto a la izquierda y un control a la derecha. */
export function SettingRow({ title, body, children }: { title: ReactNode; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 16 }}>
      <div className="stack" style={{ "--gap": "2px" } as CSSProperties}>
        <span style={{ fontWeight: 500 }}>{title}</span>
        {body ? <span className="faint">{body}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Notice({ tone = "neutral", children, role }: { tone?: "neutral" | "brand" | "attention"; children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="notice fade" data-tone={tone} role={role}>
      {children}
    </div>
  );
}

/**
 * Barras de pausa (la «l» de selyh): alta índigo y corta índigo suave, en proporción áurea.
 * `breathe` hace respirar la barra corta; `enter` reproduce la entrada del manual una vez.
 */
export function Bars({ size = 20, breathe, enter, tall = "var(--brand)", short = "var(--brand-soft)", label }: { size?: number; breathe?: boolean; enter?: boolean; tall?: string; short?: string; label?: string }) {
  // Retícula del isotipo (64): alta x17 h42, corta x35 h26, ancho 13.
  return (
    <svg className="bars" width={(size * 31) / 42} height={size} viewBox="17 11 31 42" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-breathe={breathe ? "" : undefined} data-enter={enter ? "" : undefined} style={{ overflow: "visible" }}>
      <rect className="bar-tall" x={17} y={11} width={13} height={42} rx={6.5} fill={tall} />
      <rect className="bar-short" x={35} y={27} width={13} height={26} rx={6.5} fill={short} />
    </svg>
  );
}

/** Logotipo en trazos: letras en el color del texto, barras de marca. */
export function Logo({ height = 22 }: { height?: number }) {
  const [tx, th, w] = LOGO_TALL;
  const [sx, sh] = LOGO_SHORT;
  return (
    <svg viewBox={LOGO_VIEWBOX} height={height} role="img" aria-label="Selyh" style={{ display: "block", width: "auto" }}>
      {LOGO_LETTERS.map(([x, d]) => (
        <g key={x} fill="currentColor" transform="scale(1 -1)">
          <path transform={`translate(${x} 0)`} d={d} />
        </g>
      ))}
      <rect x={tx} y={-th} width={w} height={th} rx={w / 2} fill="var(--brand)" />
      <rect x={sx} y={-sh} width={w} height={sh} rx={w / 2} fill="var(--brand-soft)" />
    </svg>
  );
}

/** Iconos de línea, trazo uniforme y extremos redondeados (manual §10). */
const ICONS = {
  close: "M6 6l12 12M18 6 6 18",
  today: "M3 12h4l3-8 4 16 3-8h4",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9 12l2 2 4-4",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  check: "M5 12.5l4.5 4.5L19 7",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  pause: "M9 5v14M15 9v10",
  arrow: "M5 12h14M13 6l6 6-6 6",
} as const;

export function Icon({ name, size = 16, style }: { name: keyof typeof ICONS; size?: number; style?: CSSProperties }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden style={style}>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Cabecera de las ventanas flotantes: barras, título y cerrar. Toda la franja sirve para arrastrar. */
export function FloatHead({ title, aside, onClose, closeLabel }: { title: ReactNode; aside?: ReactNode; onClose: () => void; closeLabel: string }) {
  return (
    <header className="float-head" data-tauri-drag-region>
      <span className="float-title" data-tauri-drag-region>
        <Bars size={18} breathe />
        <h1 data-tauri-drag-region>{title}</h1>
      </span>
      <span className="row" style={{ "--gap": "6px", flexWrap: "nowrap" } as CSSProperties}>
        {aside}
        <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
          <Icon name="close" />
        </button>
      </span>
    </header>
  );
}
