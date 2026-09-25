/**
 * The studio's frame: the sidebar (the studio's mark and name, "Studio", the
 * screens with their counts, who is signed in and as what), the header (the
 * menu button under 900 px, search, light or dark, the account menu), the
 * page, and the footer.
 *
 * The counts follow the rows the desk holds — the boot read set, every save,
 * every live update — so another computer's change moves them too.
 *
 * Inside Adminium's dashboard none of the chrome is drawn: the dashboard's
 * own sidebar lists these screens and its header carries the person and the
 * theme. The page then fills the dashboard's content area on its own.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, LogOut, Menu, Moon, Search, Sun, X } from "lucide-react";

import { SIDEBAR, sidebarItemFor, type DeskView } from "../app/routes.ts";
import type { SearchHit } from "../data/ports.ts";
import { ACCOUNT_URL, signOutStaff } from "../data/staffSession.ts";
import { isEmbedded } from "../embed.ts";
import { useI18n } from "../i18n/index.tsx";
import { initials } from "../lib/initials.ts";
import { yearOf } from "../lib/dates.ts";
import { today } from "../lib/clock.ts";
import { deskReads, useDesk, useNavCounts, useSettings } from "../state/desk.ts";
import { go, open, toggleTheme, useUi } from "../state/ui.ts";
import { NAV_ICONS } from "./icons.ts";
import { BrandMark } from "./BrandMark.tsx";

/** Under 900 px the sidebar folds into the menu. */
export function useNarrow(width = 900): boolean {
  const query = `(max-width: ${String(width - 1)}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const on = () => setNarrow(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

function Brand() {
  const { t } = useI18n();
  const settings = useSettings();
  const name = settings?.name ?? "";
  return (
    <div className="brand">
      <BrandMark mark={settings?.mark} name={name} />
      <span className="brand-text">
        <span className="brand-name">{name}</span>
        <span className="brand-sub">{t("frame.studio")}</span>
      </span>
    </div>
  );
}

/** The screens this person may open, with their counts. */
function NavList({ onPick }: { onPick?: () => void }) {
  const { t, number } = useI18n();
  const view = useUi((s) => s.view) as DeskView;
  const manager = useDesk((s) => s.me.manager);
  const counts = useNavCounts();
  const lit = sidebarItemFor(view);
  return (
    <>
      {SIDEBAR.filter((item) => item.managerOnly !== true || manager).map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const count = item.badge === undefined ? 0 : counts[item.badge];
        return (
          <button
            key={item.view}
            type="button"
            className="desk-nav-item ol-nav"
            aria-current={lit === item.view ? "page" : undefined}
            data-nav={item.view}
            onClick={() => {
              go(item.view);
              onPick?.();
            }}
          >
            {Icon !== undefined && <Icon size={16} aria-hidden="true" />}
            {t(item.labelKey)}
            {count > 0 && <span className="desk-nav-badge">{number(count)}</span>}
          </button>
        );
      })}
    </>
  );
}

function PersonCard() {
  const me = useDesk((s) => s.me);
  return (
    <div className="person-card">
      <span className="person-card-ini" aria-hidden="true">
        {initials(me.name)}
      </span>
      <span className="person-card-text">
        <span className="person-card-name">{me.name}</span>
        {me.roleName !== null && <span className="person-card-role">{me.roleName}</span>}
      </span>
    </div>
  );
}

function Sidebar() {
  const { t } = useI18n();
  return (
    <aside className="desk-rail ol-noprint">
      <Brand />
      <nav className="desk-nav" aria-label={t("frame.nav")}>
        <NavList />
      </nav>
      <PersonCard />
    </aside>
  );
}

/** The phone-width menu: the sidebar's screens, sliding in from the start edge. */
function PhoneMenu() {
  const { t } = useI18n();
  const settings = useSettings();
  const panel = useRef<HTMLDivElement>(null);
  const close = () => useUi.setState({ menu: false });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="menu-scrim" onClick={close}>
      <div ref={panel} className="menu-panel" role="dialog" aria-modal="true" aria-label={t("frame.nav")} onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <span className="menu-brand">
            <BrandMark mark={settings?.mark} name={settings?.name ?? ""} />
            {settings?.name ?? ""}
          </span>
          <button type="button" className="icon-btn ol-gi" aria-label={t("frame.closeMenu")} title={t("frame.closeMenu")} onClick={close}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <nav className="desk-nav" aria-label={t("frame.nav")}>
          <NavList onPick={close} />
        </nav>
      </div>
    </div>
  );
}

const DETAIL_OF: Record<SearchHit["table"], DeskView> = { proposals: "proposal", invoices: "invoice", projects: "project", clients: "client" };

/** The header's search: the server's, over documents, projects and clients, a few at a time. */
function DeskSearch() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const text = q.trim();

  useEffect(() => {
    if (text === "") {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      deskReads()
        .search(text, 7)
        .then((found) => live && setHits(found))
        .catch(() => live && setHits([]));
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setQ("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (hit: SearchHit) => {
    setQ("");
    open(DETAIL_OF[hit.table], hit.id);
  };
  const showing = text !== "";
  return (
    <div className="search" ref={box} role="search">
      <Search size={15} className="search-icon" aria-hidden="true" />
      <input
        className="search-input ol-fld"
        type="search"
        value={q}
        placeholder={t("frame.search")}
        aria-label={t("frame.search")}
        // A search box names the results it drives; "expanded" is a combobox's state, not a searchbox's.
        aria-controls={showing ? listId : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQ("");
          if (e.key === "ArrowDown") box.current?.querySelector<HTMLElement>(".search-hit")?.focus();
        }}
      />
      {showing && (
        <div className="search-results" id={listId}>
          {hits === null ? (
            <div className="search-empty" role="status">
              {t("frame.searching")}
            </div>
          ) : hits.length === 0 ? (
            <div className="search-empty" role="status">
              {t("frame.searchNothing")}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {hits.map((hit) => (
                <li key={`${hit.table}:${String(hit.id)}`}>
                  <button
                    type="button"
                    className="search-hit ol-row"
                    onClick={() => pick(hit)}
                    onKeyDown={(e) => {
                      const li = e.currentTarget.parentElement;
                      if (e.key === "ArrowDown") (li?.nextElementSibling?.querySelector("button") as HTMLElement | null)?.focus();
                      if (e.key === "ArrowUp") (li?.previousElementSibling?.querySelector("button") as HTMLElement | null)?.focus();
                      if (e.key === "Escape") setQ("");
                    }}
                  >
                    <span className="search-hit-id">{hit.label}</span>
                    <span className="search-hit-title">{hit.title}</span>
                    {hit.client !== null && <span className="search-hit-client">{hit.client}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Account({ narrow }: { narrow: boolean }) {
  const { t } = useI18n();
  const me = useDesk((s) => s.me);
  const [openMenu, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!openMenu) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>(".account-chip")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);
  const first = me.name.split(" ")[0] ?? me.name;
  return (
    <div className="account" ref={box}>
      <button type="button" className="account-chip ol-gi" aria-haspopup="menu" aria-expanded={openMenu} aria-controls={openMenu ? menuId : undefined} aria-label={t("frame.accountMenu")} onClick={() => setOpen((v) => !v)}>
        <span className="account-ini" aria-hidden="true">
          {initials(me.name)}
        </span>
        <span className="account-name">{narrow ? first : me.name}</span>
      </button>
      {openMenu && (
        <div className="account-menu" role="menu" id={menuId} aria-label={t("frame.accountMenu")}>
          <div className="account-who">
            <span className="account-who-name">{me.name}</span>
            {me.email !== null && <span className="account-who-email">{me.email}</span>}
          </div>
          <a className="account-item ol-gi" role="menuitem" href={ACCOUNT_URL} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
            {t("frame.account")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <button type="button" className="account-item ol-gi" role="menuitem" onClick={() => void signOutStaff(window.location.pathname)}>
            {t("frame.signOut")}
            <LogOut size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ narrow }: { narrow: boolean }) {
  const { t } = useI18n();
  const dark = useUi((s) => s.theme === "dark");
  return (
    <header className="desk-header ol-noprint">
      {narrow && (
        <button type="button" className="icon-btn ol-gi" aria-label={t("frame.menu")} title={t("frame.menu")} aria-haspopup="dialog" onClick={() => useUi.setState({ menu: true })}>
          <Menu size={18} aria-hidden="true" />
        </button>
      )}
      <DeskSearch />
      <button type="button" className="icon-btn header-end ol-gi" aria-label={t("frame.theme")} title={t("frame.theme")} onClick={toggleTheme}>
        {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
      </button>
      <Account narrow={narrow} />
    </header>
  );
}

function SignedOutBar() {
  const { t } = useI18n();
  const signedOut = useUi((s) => s.signedOut);
  if (!signedOut) return null;
  return (
    <div className="signed-out-bar" role="alert">
      <span style={{ flex: 1 }}>{t("frame.sessionEnded")}</span>
      <button type="button" className="btn btn--small ol-gi" onClick={() => window.location.reload()}>
        {t("frame.signInAgain")}
      </button>
    </div>
  );
}

function Copyright() {
  const { t, number } = useI18n();
  const name = useSettings()?.name ?? "";
  const day = useDesk((s) => s.today);
  return <span>{t("frame.copyright", { year: number(yearOf(day === "" ? today() : day), { useGrouping: false }), studio: name })}</span>;
}

function Loading() {
  const { t } = useI18n();
  return (
    <div role="status" className="screen-lead">
      {t("frame.loading")}
    </div>
  );
}

export default function DeskFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const menu = useUi((s) => s.menu);
  const loading = useDesk((s) => s.load === "loading" && s.today === "");
  const page = loading ? <Loading /> : children;

  if (isEmbedded()) {
    return (
      <main id="main" className="desk-main desk-main--embedded">
        <SignedOutBar />
        <div className="desk-main-inner">{page}</div>
      </main>
    );
  }
  return (
    <div className="desk">
      <a className="desk-skip" href="#main">
        {t("frame.skip")}
      </a>
      {!narrow && <Sidebar />}
      <div className="desk-column">
        <Header narrow={narrow} />
        <SignedOutBar />
        <main id="main" className="desk-main" tabIndex={-1}>
          <div className="desk-main-inner">{page}</div>
        </main>
        <footer className="desk-footer ol-noprint">
          <Copyright />
        </footer>
      </div>
      {narrow && menu && <PhoneMenu />}
    </div>
  );
}
