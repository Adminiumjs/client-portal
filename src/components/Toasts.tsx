/**
 * The toast: a short line at the foot of the page, announced politely to a
 * screen reader (the region is always there, so a new line is read out).
 */
import { TriangleAlert, Check, CircleAlert, Info, LogOut, Mail, type LucideIcon } from "lucide-react";

import { useUi } from "../state/ui.ts";

/** The icons a toast may name. A name not here draws the check. */
const ICONS: Record<string, LucideIcon> = { check: Check, alert: CircleAlert, warn: TriangleAlert, info: Info, mail: Mail, "log-out": LogOut };

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts ol-noprint" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.icon] ?? Check;
        return (
          <div key={toast.id} className={`toast${toast.tone === "danger" ? " toast--danger" : ""}`}>
            <Icon size={16} aria-hidden="true" />
            {toast.text}
          </div>
        );
      })}
    </div>
  );
}
