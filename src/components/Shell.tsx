/**
 * TWO shells, switched by the demo dock's Studio | Client segment.
 *
 * The studio gets internal chrome — sidebar, topbar, document search. The
 * client gets a minimal portal: a centered column, a small wordmark header
 * labelled "Client portal", a theme toggle, and no sidebar at all. That
 * difference is the product story, so it lives in the chrome rather than being
 * simulated inside each screen.
 */

import { useMemo, useState } from "react";
import {
  FileText,
  FolderKanban,
  House,
  Menu,
  Moon,
  Receipt,
  Search,
  Sun,
  X,
} from "lucide-react";

import type { View } from "../data/types.ts";
import { isEmbedded } from "../embed.ts";
import { timezoneNotice } from "../i18n/ambient.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money } from "../lib/format.ts";
import { balance } from "../lib/invoice.ts";
import { clientById, useStore } from "../state/store.ts";
import { Avatar } from "./Primitives.tsx";

interface NavEntry {
  view: View;
  labelKey: "chrome.nav.home" | "chrome.nav.proposals" | "chrome.nav.projects" | "chrome.nav.invoices" | "chrome.nav.archive";
  icon: typeof House;
}

const NAV: NavEntry[] = [
  { view: "home", labelKey: "chrome.nav.home", icon: House },
  { view: "proposals", labelKey: "chrome.nav.proposals", icon: FileText },
  { view: "projects", labelKey: "chrome.nav.projects", icon: FolderKanban },
  { view: "invoices", labelKey: "chrome.nav.invoices", icon: Receipt },
  /* Archive is a deliberately cut view: it exists and 404s honestly. */
  { view: "notfound", labelKey: "chrome.nav.archive", icon: FolderKanban },
];

function NavList({ onPick }: { onPick?: () => void }) {
  const { t } = useI18n();
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);

  return (
    <nav className="ol-sidebar__nav" aria-label={t("chrome.brand.studio")}>
      {NAV.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.labelKey}
            type="button"
            className="ol-navitem"
            aria-current={view === entry.view ? "page" : undefined}
            onClick={() => {
              go(entry.view);
              onPick?.();
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}

function Brand() {
  const { t } = useI18n();
  return (
    <div className="ol-sidebar__brand">
      <span className="ol-sidebar__mark" aria-hidden="true">
        <FileText size={18} />
      </span>
      <span>
        <span className="ol-sidebar__name">{t("chrome.brand")}</span>
        <span className="ol-sidebar__sub" style={{ display: "block" }}>
          {t("chrome.brand.studio")}
        </span>
      </span>
    </div>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <div className="ol-sidebar__foot">
      {t("chrome.footer.copy")}
      <span className="ol-sidebar__chip ol-mono">{t("chrome.footer.chip")}</span>
    </div>
  );
}

/** Document search — a filter over what is in memory, by number or title. */
function DocumentSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const proposals = useStore((s) => s.proposals);
  const invoices = useStore((s) => s.invoices);
  const openProposal = useStore((s) => s.openProposal);
  const openInvoice = useStore((s) => s.openInvoice);

  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (q.length < 2) return null;
    return {
      proposals: proposals
        .filter((p) => p.num.toLowerCase().includes(q) || label(p.title).toLowerCase().includes(q))
        .slice(0, 4),
      invoices: invoices
        .filter((i) => i.num.toLowerCase().includes(q) || label(i.title).toLowerCase().includes(q))
        .slice(0, 5),
    };
  }, [q, proposals, invoices]);

  const empty = hits !== null && hits.proposals.length === 0 && hits.invoices.length === 0;

  return (
    <div className="ol-topbar__search">
      <Search size={15} aria-hidden="true" />
      <input
        className="ol-topbar__input ol-fld"
        type="search"
        value={query}
        placeholder={t("chrome.search.placeholder")}
        aria-label={t("chrome.search.label")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      />

      {open && hits !== null && (
        <div className="ol-searchpop ol-scroll">
          {empty && <p className="ol-searchpop__empty">{t("chrome.search.empty", { query })}</p>}

          {hits.proposals.length > 0 && (
            <>
              <div className="ol-searchpop__group">{t("chrome.nav.proposals")}</div>
              {hits.proposals.map((p) => (
                <button
                  key={p.num}
                  type="button"
                  className="ol-searchpop__row"
                  onMouseDown={() => {
                    openProposal(p.num);
                    setQuery("");
                  }}
                >
                  <span className="ol-mono">{p.num}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {label(p.title)}
                  </span>
                </button>
              ))}
            </>
          )}

          {hits.invoices.length > 0 && (
            <>
              <div className="ol-searchpop__group">{t("chrome.nav.invoices")}</div>
              {hits.invoices.map((i) => (
                <button
                  key={i.num}
                  type="button"
                  className="ol-searchpop__row"
                  onMouseDown={() => {
                    openInvoice(i.num);
                    setQuery("");
                  }}
                >
                  <span className="ol-mono">{i.num}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {label(i.title)}
                  </span>
                  <span className="ol-searchpop__meta ol-mono">{money(balance(i))}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The one VISIBLE trace of a zone nobody confirmed (data/sessionSource.ts).
 *
 * Two states, one chip. `fallback` — no zone on the connection at all, so every
 * date renders in UTC. `host` — a real zone, but the one Adminium took from the
 * machine it runs on, which is plausible and unverified and therefore the more
 * dangerous of the two: UTC announces itself, a wrong city does not.
 *
 * A chip and not a banner because the state is degraded, not broken; the fix
 * lives in the tooltip. Renders nothing for an operator-set zone, which is what
 * nearly every boot should be.
 */
function ZoneNotice({ block = false }: { block?: boolean }) {
  const { t } = useI18n();
  const notice = timezoneNotice();
  if (notice === null) return null;
  const chip =
    notice.source === "fallback" ? (
      <span className="ol-chip" title={t("chrome.utc.why")}>
        {t("chrome.utc.notice")}
      </span>
    ) : (
      <span className="ol-chip" title={t("chrome.zone.why", { zone: notice.zone })}>
        {t("chrome.zone.notice", { zone: notice.zone })}
      </span>
    );
  return block ? <div className="ol-utcnote">{chip}</div> : chip;
}

/** The studio's internal chrome. */
function StudioShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const navOpen = useStore((s) => s.navOpen);
  const setNavOpen = useStore((s) => s.setNavOpen);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div className="ol-app">
      <aside className="ol-sidebar">
        <Brand />
        <NavList />
        <Footer />
      </aside>

      {navOpen && (
        <>
          <button
            type="button"
            className="ol-scrim"
            aria-label={t("chrome.menu.close")}
            onClick={() => setNavOpen(false)}
          />
          <div className="ol-sheet" role="dialog" aria-modal="true" aria-label={t("chrome.brand")}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Brand />
              <button
                type="button"
                className="ol-iconbtn ol-btn"
                style={{ marginInlineStart: "auto", marginInlineEnd: 12 }}
                onClick={() => setNavOpen(false)}
                aria-label={t("chrome.menu.close")}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <NavList onPick={() => setNavOpen(false)} />
            <Footer />
          </div>
        </>
      )}

      <div className="ol-main">
        <header className="ol-topbar">
          <button
            type="button"
            className="ol-iconbtn ol-btn ol-narrow-only"
            onClick={() => setNavOpen(true)}
            aria-label={t("chrome.menu.open")}
          >
            <Menu size={18} aria-hidden="true" />
          </button>

          <DocumentSearch />
          <div className="ol-topbar__spacer" />

          <ZoneNotice />

          <button
            type="button"
            className="ol-iconbtn ol-btn"
            onClick={toggleTheme}
            aria-label={t(theme === "dark" ? "chrome.dock.theme.light" : "chrome.dock.theme.dark")}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </header>

        <main className="ol-content" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The client portal: a centered column that simply narrows. No sidebar, no
 * search, no internal navigation — the client sees exactly the document they
 * were sent and nothing about the studio's other work.
 */
function PortalShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const portalClient = useStore((s) => s.portalClient);
  const leavePortal = useStore((s) => s.leavePortal);
  const client = clientById(portalClient);

  return (
    <div className="ol-portal">
      <header className="ol-portal__head">
        <button
          type="button"
          className="ol-portal__brand"
          onClick={leavePortal}
        >
          <span className="ol-portal__wordmark">{t("chrome.brand")}</span>
          <span className="ol-portal__label">{t("chrome.brand.portal")}</span>
        </button>

        <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 9 }}>
          {client !== null && (
            <span className="ol-userchip">
              <Avatar name={client.company} tint={client.tint} />
              <span className="ol-wide-only">{client.company}</span>
            </span>
          )}
          <button
            type="button"
            className="ol-iconbtn ol-btn"
            onClick={toggleTheme}
            aria-label={t(theme === "dark" ? "chrome.dock.theme.light" : "chrome.dock.theme.dark")}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="ol-portal__body" id="main">
        {children}
      </main>

      <footer className="ol-portal__foot">
        {t("chrome.footer.copy")}
        <span className="ol-sidebar__chip ol-mono">{t("chrome.footer.chip")}</span>
      </footer>
    </div>
  );
}

/**
 * NO CHROME AT ALL — the internal placement (29-app-surfaces.md D6).
 *
 * Blended into the Adminium dashboard, this app's screens render inside the
 * dashboard's own shell: Adminium's sidebar carries this app's sections, and
 * Adminium's topbar carries the account menu, the theme control and the
 * language control. Rendering our own alongside would be two sidebars, two
 * theme toggles and two brands in one window.
 *
 * WHAT THIS COSTS, stated rather than glossed: document search lives in the
 * studio topbar and is the one thing here that is neither navigation nor a
 * duplicated preference. It goes with the topbar. A slim embedded search is a
 * clear follow-up; shipping half a topbar to keep it would have been the
 * ambiguous choice.
 *
 * `#main` is kept, because the skip link in `App.tsx` targets it and a skip
 * link pointing at nothing is worse than no skip link.
 */
function EmbeddedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ol-embedded">
      <main className="ol-content" id="main">
        {/* In-flow, not chrome: D6's "no chrome" bans the duplicated shell,
            not a data-state notice the host has no way to show. */}
        <ZoneNotice block />
        {children}
      </main>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const persona = useStore((s) => s.persona);
  /*
   * A runtime check, not a build flag, and that is the point: ONE hosted-staff
   * bundle serves both placements. Opened directly at `/apps/clients/staff/`
   * it renders the full studio chrome; framed by the dashboard it renders
   * none. Switching placement is a setting in Studio, not a rebuild.
   */
  if (isEmbedded()) return <EmbeddedShell>{children}</EmbeddedShell>;
  return persona === "client" ? (
    <PortalShell>{children}</PortalShell>
  ) : (
    <StudioShell>{children}</StudioShell>
  );
}
