/**
 * The design's sheet: a dialog over a dimmed page — an icon, a title and a
 * mono sub-line, a close button, then the body. Every sheet of both sides
 * draws inside it.
 *
 * It behaves as a modal dialog should: focus moves into it and stays there
 * (Tab wraps), Escape and a click on the dimmed page close it, and focus
 * goes back to what opened it.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { useI18n } from "../i18n/index.tsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, sub, icon: Icon, onClose, wide = false, children }: { title: ReactNode; sub?: ReactNode; icon: LucideIcon; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = root.current;
    const first = dialog?.querySelector<HTMLElement>("input, textarea, select") ?? dialog;
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || dialog === null) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="sheet-scrim" onClick={() => close.current()}>
      <div ref={root} className={`sheet${wide ? " sheet--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="sheet-titles">
            <h2 className="sheet-title" id={titleId}>
              {title}
            </h2>
            {sub !== undefined && <span className="sheet-sub">{sub}</span>}
          </span>
          <button type="button" className="icon-btn sheet-close ol-gi" aria-label={t("common.close")} title={t("common.close")} onClick={() => close.current()}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
