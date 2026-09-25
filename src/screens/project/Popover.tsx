/**
 * The design's small dialog that opens under a button (Pause…, Mark done…):
 * a title and a close button, a line saying what happens, the fields, then
 * Cancel and the action.
 *
 * It behaves as a dialog: focus moves to its first field (or its action),
 * Escape and a click outside close it, and focus goes back to what opened it.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";

export function Popover({
  title,
  sub,
  children,
  action,
  actionIcon,
  tone = "primary",
  busy = false,
  onSubmit,
  onClose,
  align = "start",
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
  action: string;
  actionIcon?: LucideIcon;
  tone?: "primary" | "danger";
  busy?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = root.current;
    const first = box?.querySelector<HTMLElement>("input, textarea, select") ?? box?.querySelector<HTMLElement>("[data-pop-action]") ?? box;
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
    };
    const onDown = (event: MouseEvent) => {
      if (box !== null && event.target instanceof Node && !box.contains(event.target)) close.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      opener?.focus?.();
    };
  }, []);

  return (
    <div ref={root} className={`prj-pop prj-pop--${align}`} role="dialog" aria-labelledby={titleId} tabIndex={-1}>
      <div className="prj-pop-head">
        <span className="prj-pop-title" id={titleId}>
          {title}
        </span>
        <button type="button" className="prj-pop-close ol-gi" aria-label={t("common.close")} title={t("common.close")} onClick={() => close.current()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {sub !== undefined && <span className="prj-pop-sub">{sub}</span>}
      {children}
      <div className="prj-pop-actions">
        <Button onClick={() => close.current()}>{t("common.cancel")}</Button>
        <Button kind={tone === "danger" ? "danger" : "primary"} className={tone === "danger" ? "prj-pop-danger" : undefined} icon={actionIcon} busy={busy} onClick={onSubmit} data-pop-action="">
          {action}
        </Button>
      </div>
    </div>
  );
}
