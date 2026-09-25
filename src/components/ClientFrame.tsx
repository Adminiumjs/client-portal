/**
 * The clients' frame: the studio's mark and name over "Client portal", the
 * signed-in client's company as the sign-out button, light or dark, the page's
 * language, then the page in one column, and a footer with how to reach the
 * studio.
 *
 * In the studio's "preview as the client" a banner says whose view this is and
 * leads back to the studio; the sign-out button then ends the preview.
 *
 * Everything about the studio here is what anyone may read (its name, mark,
 * reply-to address and phone) — nothing about any client before sign-in.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Eye, Languages, LogOut, Mail, Moon, Phone, Sun } from "lucide-react";

import { LOCALES, LOCALE_TAGS, useI18n } from "../i18n/index.tsx";
import { yearOf } from "../lib/dates.ts";
import { today } from "../lib/clock.ts";
import { signOut } from "../state/clientActions.ts";
import { usePortal } from "../state/portal.ts";
import { endPreview, toggleTheme, useUi } from "../state/ui.ts";
import { BrandMark } from "./BrandMark.tsx";

function LanguageMenu() {
  const { t, locale, setLocale } = useI18n();
  const [openMenu, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!openMenu) return;
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);
  return (
    <div className="lang" ref={box}>
      <button type="button" className="icon-btn ol-gi" aria-label={t("portal.language")} title={t("portal.language")} aria-haspopup="menu" aria-expanded={openMenu} aria-controls={openMenu ? menuId : undefined} onClick={() => setOpen((v) => !v)}>
        <Languages size={16} aria-hidden="true" />
      </button>
      {openMenu && (
        <div className="lang-menu" role="menu" id={menuId} aria-label={t("portal.language")}>
          {LOCALE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              role="menuitemradio"
              aria-checked={tag === locale}
              lang={LOCALES[tag].tag}
              className="lang-item ol-chip"
              onClick={() => {
                setLocale(tag);
                setOpen(false);
              }}
            >
              <span>{LOCALES[tag].native}</span>
              {tag === locale && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewBar() {
  const { t } = useI18n();
  const preview = useUi((s) => s.preview);
  const contact = usePortal((s) => s.me?.contact_name ?? "");
  if (preview === null) return null;
  return (
    <div className="preview-bar ol-noprint" role="status">
      <div className="preview-bar-inner">
        <Eye size={15} aria-hidden="true" />
        <span className="preview-line">{t("portal.preview", { first: contact.split(" ")[0] ?? contact })}</span>
        <button type="button" className="btn btn--small ol-gi" onClick={endPreview}>
          <ArrowLeft size={13} aria-hidden="true" />
          {t("portal.previewBack")}
        </button>
      </div>
    </div>
  );
}

export default function ClientFrame({ children }: { children: ReactNode }) {
  const { t, number } = useI18n();
  const studio = usePortal((s) => s.studio?.settings ?? null);
  const company = usePortal((s) => s.me?.company ?? null);
  const preview = useUi((s) => s.preview !== null);
  const dark = useUi((s) => s.theme === "dark");
  const name = studio?.name ?? "";
  const signedIn = company !== null;
  return (
    <div className="portal">
      <header className="portal-header ol-noprint">
        <div className="portal-bar">
          <BrandMark mark={studio?.mark} name={name} />
          <span className="brand-text">
            <span className="brand-name">{name}</span>
            <span className="brand-sub">{t("nav.portal")}</span>
          </span>
          {signedIn && (
            <button type="button" className="portal-signout ol-gi" aria-label={t("portal.signOut", { company })} title={t("portal.signOut", { company })} onClick={() => (preview ? endPreview() : void signOut())}>
              <LogOut size={14} aria-hidden="true" />
              {company}
            </button>
          )}
          <button type="button" className={`icon-btn ol-gi${signedIn ? "" : " first-end"}`} aria-label={t("frame.theme")} title={t("frame.theme")} onClick={toggleTheme}>
            {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <LanguageMenu />
        </div>
      </header>
      <PreviewBar />
      <main id="main" className="portal-main">
        <div className="portal-main-inner">{children}</div>
      </main>
      <footer className="portal-footer ol-noprint">
        <div className="portal-footer-inner">
          <span className="portal-contact">
            {studio?.reply_to !== null && studio?.reply_to !== undefined && (
              <a href={`mailto:${studio.reply_to}`}>
                <Mail size={13} aria-hidden="true" />
                <span className="ol-sr-only">{t("portal.email")} </span>
                <span>{studio.reply_to}</span>
              </a>
            )}
            {studio?.phone !== null && studio?.phone !== undefined && (
              <a href={`tel:${studio.phone.replace(/[^\d+]/g, "")}`}>
                <Phone size={13} aria-hidden="true" />
                <span className="ol-sr-only">{t("portal.phone")} </span>
                <span>{studio.phone}</span>
              </a>
            )}
          </span>
          <span>{t("frame.copyright", { year: number(yearOf(today()), { useGrouping: false }), studio: name })}</span>
        </div>
      </footer>
    </div>
  );
}
