/**
 * The clients' pages' repeated pieces: a section card with its heading, the
 * progress ring, a "due in n days" phrase, a deliverable's artwork tile, and
 * the "Also with the studio" list the document pages end with.
 */
import { useMemo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Box, ChevronRight, File, FileText, FolderOpen, Folders, House, Image, LayoutTemplate, Package, Palette, PanelBottom, PenTool, Printer, ReceiptText, Ruler, Scissors, Shapes, Stamp, Type, Utensils } from "lucide-react";

import type { Day, Id } from "../../../data/types.ts";
import { useI18n } from "../../../i18n/index.tsx";
import { studioZone, today } from "../../../lib/clock.ts";
import { dayLabel, type DayStyle } from "../../../lib/dates.ts";
import { usePortal } from "../../../state/portal.ts";
import { go, open, useUi } from "../../../state/ui.ts";
import type { HomeRows } from "../home/model.ts";
import { visibleInvoices, visibleProposals } from "../home/model.ts";
import { daysUntil, invoiceState, isOpen, leadProject, milestonesOf, progress, proposalState } from "./model.ts";

/** A card with an icon and a heading (and, at its end, a count or a pill). */
export function Section({ icon: Icon, title, end, children, id, className }: { icon: LucideIcon; title: ReactNode; end?: ReactNode; children: ReactNode; id: string; className?: string }) {
  return (
    <section className={`cl-card cl-section ${className ?? ""}`.trim()} aria-labelledby={id}>
      <div className="cl-section-head">
        <Icon size={15} aria-hidden="true" className="cl-section-icon" />
        <h2 className="cl-section-title" id={id}>
          {title}
        </h2>
        {end !== undefined && <span className="cl-section-end">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** "due today", "due in 3 days", "4 days ago" — on the studio's calendar. */
export function useDueIn(): (day: Day | null) => string {
  const { t, number } = useI18n();
  return (day) => {
    if (day === null) return "";
    const d = daysUntil(day, today());
    if (d === 0) return t("client.due.today");
    return d > 0 ? t("client.due.in", { count: number(d) }, d) : t("client.due.ago", { count: number(-d) }, -d);
  };
}

/** A calendar day as words in the page's language, for a sentence that names it. */
export function useDay(): (day: Day | null | undefined, style?: DayStyle) => string {
  const { locale } = useI18n();
  return (day, style = "short") => dayLabel(day, locale, style);
}

/** Every row the client holds, in the shape the pages' reckonings take. */
export function useClientRows(): HomeRows {
  const rows = usePortal((s) => s.rows);
  return useMemo(
    () => ({
      today: today(),
      zone: studioZone(),
      proposals: Object.values(rows.proposals),
      projects: Object.values(rows.projects),
      milestones: Object.values(rows.milestones),
      deliverables: Object.values(rows.deliverables),
      versions: Object.values(rows.deliverable_versions),
      invoices: Object.values(rows.invoices),
      payments: Object.values(rows.payments),
      briefs: Object.values(rows.briefs),
    }),
    [rows],
  );
}

/** The ring the project page leads with: how far along, in the project's colour. */
export function Ring({ pct, tone, size = 76 }: { pct: number; tone: "accent" | "warn" | "pos"; size?: number }) {
  const { number } = useI18n();
  const circumference = 2 * Math.PI * 15.5;
  return (
    <span className="cl-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-3)" strokeWidth="2.8" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={`var(--${tone})`} strokeWidth="2.8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * circumference} ${circumference}`} />
      </svg>
      <span className="cl-ring-pct">{number(pct / 100, { style: "percent" })}</span>
    </span>
  );
}

/** The icons a deliverable may name (the studio picks one when it adds the deliverable). */
const DELIVERABLE_ICONS: Readonly<Record<string, LucideIcon>> = {
  box: Box,
  file: File,
  "file-text": FileText,
  image: Image,
  layout: LayoutTemplate,
  "layout-template": LayoutTemplate,
  package: Package,
  palette: Palette,
  "panel-bottom": PanelBottom,
  "pen-tool": PenTool,
  printer: Printer,
  ruler: Ruler,
  scissors: Scissors,
  shapes: Shapes,
  stamp: Stamp,
  type: Type,
  utensils: Utensils,
};

/** A deliverable's icon by the name it stores ("package", "pen-tool"), else a file. */
export function iconByName(name: string | null | undefined): LucideIcon {
  return (name === null || name === undefined ? undefined : DELIVERABLE_ICONS[name]) ?? File;
}

/** The artwork's tile: the deliverable's icon on a soft wash of the studio's colour. */
export function Tile({ icon, size = 44, children, className }: { icon: string | null; size?: number; children?: ReactNode; className?: string }) {
  const Icon = iconByName(icon);
  return (
    <span className={`cl-tile ${className ?? ""}`.trim()}>
      <Icon size={size} aria-hidden="true" className="cl-tile-icon" />
      {children}
    </span>
  );
}

/**
 * "Also with the studio": the client's other things, from any document page —
 * their project, their other invoices and proposals (four at most), and the
 * way back to everything.
 */
export function AlsoWith({ current }: { current: { kind: "proposal" | "invoice" | "project"; id: Id } }) {
  const { t, money, number } = useI18n();
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const rows = useClientRows();
  const items = useMemo(() => {
    const out: { key: string; icon: LucideIcon; label: string; meta: string; onOpen: () => void }[] = [];
    const project = leadProject(rows.projects);
    if (project !== undefined && current.kind !== "project") {
      const pct = progress(milestonesOf(rows.milestones, project.id));
      out.push({
        key: `j${project.id}`,
        icon: FolderOpen,
        label: project.name,
        meta: [project.number, number(pct / 100, { style: "percent" }), t(`status.${project.status}`)].filter((x) => x !== null && x !== "").join(" · "),
        onOpen: () => open("project", project.id),
      });
    }
    for (const inv of visibleInvoices(rows)) {
      if (current.kind === "invoice" && inv.id === current.id) continue;
      const state = invoiceState(inv, rows.today);
      const tail = state === "void" ? t("status.void") : isOpen(inv) ? t("client.also.open", { amount: money(inv.balance, inv.currency) }) : t("status.paid");
      out.push({ key: `i${inv.id}`, icon: ReceiptText, label: inv.title ?? inv.number ?? "", meta: [inv.number, tail].filter((x) => x !== null && x !== "").join(" · "), onOpen: () => open("invoice", inv.id) });
    }
    for (const p of visibleProposals(rows)) {
      if (current.kind === "proposal" && p.id === current.id) continue;
      out.push({ key: `p${p.id}`, icon: FileText, label: p.title, meta: [p.number, t(`status.${proposalState(p, rows.today)}`)].filter((x) => x !== null && x !== "").join(" · "), onOpen: () => open("proposal", p.id) });
    }
    return out.slice(0, 4);
  }, [rows, current.kind, current.id, t, money, number]);
  if (items.length === 0) return null;
  return (
    <Section icon={Folders} title={t("client.also.title", { studio })} id="cl-also" className="ol-noprint">
      <div role="list">
        {items.map((item) => (
          <div role="listitem" key={item.key}>
            <button type="button" className="cl-list-row ol-row" onClick={item.onOpen}>
              <item.icon size={15} aria-hidden="true" className="cl-list-icon" />
              <span className="cl-list-main">
                <span className="cl-list-title">{item.label}</span>
                <span className="cl-list-meta">{item.meta}</span>
              </span>
              <ChevronRight size={15} aria-hidden="true" className="cl-chevron" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="cl-list-row cl-list-row--last ol-row" onClick={() => go("home")}>
        <House size={15} aria-hidden="true" className="cl-list-icon" />
        <span className="cl-list-all">{t("client.also.all")}</span>
        <ChevronRight size={15} aria-hidden="true" className="cl-chevron" />
      </button>
    </Section>
  );
}

/** The page on show, for a screen that is the same component for two ids. */
export const useSelected = (key: "proposal" | "invoice" | "project" | "deliverable"): Id | null => useUi((s) => s.selected[key]);

/**
 * The way back to everything, at the top of a page no list leads home from
 * (the statement, the brief). The session lives in the page, so a reload to
 * get home would sign the client out: the page itself has to offer the way.
 */
export function BackHome() {
  const { t } = useI18n();
  return (
    <button type="button" className="btn ol-gi btn--small cl-back ol-noprint" onClick={() => go("home")}>
      <ArrowLeft size={14} aria-hidden="true" />
      {t("client.invoice.backHome")}
    </button>
  );
}
