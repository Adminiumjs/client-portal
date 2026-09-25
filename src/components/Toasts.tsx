/**
 * The toast: a short line at the foot of the page, announced politely to a
 * screen reader (the region is always there, so a new line is read out).
 */
import { CalendarDays, CalendarPlus, Check, CircleAlert, Copy, ExternalLink, FileText, Info, LogOut, Mail, MailCheck, Receipt, TriangleAlert, Truck, Wallet, type LucideIcon } from "lucide-react";

import { useUi } from "../state/ui.ts";

/** The icons a toast may name. A name not here draws the check. */
const ICONS: Record<string, LucideIcon> = {
  check: Check,
  alert: CircleAlert,
  warn: TriangleAlert,
  info: Info,
  mail: Mail,
  "log-out": LogOut,
  // The back office's: a purchase passed on, a supplier, a sentence copied, a date held, a test sent, a document.
  wallet: Wallet,
  truck: Truck,
  copy: Copy,
  "calendar-plus": CalendarPlus,
  "calendar-days": CalendarDays,
  "mail-check": MailCheck,
  "external-link": ExternalLink,
  "file-text": FileText,
  receipt: Receipt,
};

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
