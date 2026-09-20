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
import { DEMO } from "../surface.ts";
import { appName } from "../i18n/ambient.ts";
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

/**
 * What this app is CALLED on screen.
 *
 * The operator's name from Adminium when they set one, else the name this
 * build ships with. One helper rather than a `??` at each of the three render
 * sites: a sidebar, a wordmark and a dialog label that disagree about the name
 * of the app is a worse bug than any of them being wrong alone.
 *
 * Not localized, deliberately — an operator types one business name and it is
 * not Adminium's to translate. `chrome.brand` still is, for the apps that keep
 * the shipped one.
 */
function useBrand(): string {
  const { t } = useI18n();
  return appName() ?? t("chrome.brand");
}

function Brand() {
  const brand = useBrand();
  const { t } = useI18n();
  return (
    <div className="ol-sidebar__brand">
      <span className="ol-sidebar__mark" aria-hidden="true">
        <FileText size={18} />
      </span>
      <span>
        <span className="ol-sidebar__name">{brand}</span>
        <span className="ol-sidebar__sub" style={{ display: "block" }}>
          {t("chrome.brand.studio")}
        </span>
      </span>
    </div>
  );
}

/**
 * The demo's own footer — and ONLY the demo's.
 *
 * It reads "A demo client portal shipped with Adminium" beside an
 * `adminium.dev/demo/client-portal` chip. True of the marketplace demo; a
 * falsehood on an operator's own deployment, where it told their staff and
 * their clients that the thing they were working in was a sample. It shipped
 * that way in all eight locales, inside the hosted staff and customer bundles
 * both.
 *
 * `DEMO` folds to a literal at build time (`surface.ts`), so in every other
 * build this component and its strings are eliminated from the bundle rather
 * than merely skipped — the same rule D24 applied to the demo dock, which this
 * footer was simply missed by.
 */
function Footer() {
  const { t } = useI18n();
  if (!DEMO) return null;
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

/*
 * THE ZONE CHIP IS GONE, and the warning it carried now lives in Adminium.
 *
 * It rendered "Dates shown in UTC" — or a city nobody confirmed — permanently,
 * in the header of every screen, for everyone. But an unset timezone is the
 * OPERATOR's to fix, on the connection, in Adminium; staff and customers
 * reading this app can do nothing about it and were shown it on every page
 * anyway. Studio's Connections card now names the zone dates actually render
 * in whenever a connection has none, which is both where the fix is and the
 * only audience that can apply it.
 *
 * `timezoneNotice()` stays in `i18n/ambient.ts`: the claim is still worth
 * carrying and still logged at boot. Nothing renders it.
 */
/** The studio's internal chrome. */
function StudioShell({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
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
          <div className="ol-sheet" role="dialog" aria-modal="true" aria-label={brand}>
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
  const brand = useBrand();
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
          <span className="ol-portal__wordmark">{brand}</span>
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

      {/* Same demo-only rule as the sidebar's <Footer/>, inlined here because
          the portal's footer carries the portal's own class. */}
      {DEMO && (
        <footer className="ol-portal__foot">
          {t("chrome.footer.copy")}
          <span className="ol-sidebar__chip ol-mono">{t("chrome.footer.chip")}</span>
        </footer>
      )}
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
