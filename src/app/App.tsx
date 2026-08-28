/**
 * The app shell.
 *
 * Routing is a plain state switch over `store.view`. Every member of the
 * `View` union is mapped below — the studio's seven views, the portal's four,
 * and the 404 — so no nav item or portal redirect can land nowhere.
 */

import { useEffect } from "react";
import type { ComponentType } from "react";

import DemoDock from "../components/DemoDock.tsx";
import {
  ChangesDialog,
  DeclineDialog,
  PaySheet,
  RecordPayment,
  ToastLayer,
} from "../components/Overlays.tsx";
import Shell from "../components/Shell.tsx";
import type { View } from "../data/types.ts";
import { DEMO, SURFACE_SIDE } from "../surface.ts";
import type { CustomerView, StaffView } from "../surface-nav.ts";
import { setAmbient } from "../i18n/ambient.ts";
import { useI18n } from "../i18n/index.tsx";
import { useStore } from "../state/store.ts";

import {
  Home,
  InvoicePage,
  Invoices,
  ProjectPage,
  Projects,
  ProposalPage,
  Proposals,
} from "../screens/Studio.tsx";
import {
  ClientInvoice,
  Entry,
  NotFound,
  Progress,
  Review,
} from "../screens/Portal.tsx";

/*
 * TOTAL over the side's views, not partial — and `StaffView`/`CustomerView`
 * come from `surface-nav.ts`, which is also what the URL router and the emitted
 * `surface.json` read. A screen declared there with no component here, or a
 * component here for a screen not declared there, is a COMPILE error. That is
 * D7's drift rule, enforced by the type checker rather than by a test.
 *
 * `notfound` is in both: every build needs somewhere for an unknown view to go.
 */
const STUDIO_SCREENS = {
  home: Home,
  proposals: Proposals,
  proposal: ProposalPage,
  projects: Projects,
  project: ProjectPage,
  invoices: Invoices,
  invoice: InvoicePage,
  notfound: NotFound,
} satisfies Record<StaffView, ComponentType>;

const PORTAL_SCREENS = {
  entry: Entry,
  review: Review,
  progress: Progress,
  clientinvoice: ClientInvoice,
  notfound: NotFound,
} satisfies Record<CustomerView, ComponentType>;

/*
 * A surface build ships ONE persona's screens. `SURFACE_SIDE` folds to a
 * literal, so the branch not taken is eliminated and, with it, every screen
 * component only that branch referenced — which is what stops a PUBLIC customer
 * bundle from carrying the staff screens. The two records above stay separate
 * object LITERALS for exactly that reason; deriving one from an array at
 * runtime would read better and would ship the whole studio to every client.
 *
 * Not a clean cut, and the limit is worth naming: `Portal.tsx` imports `Ledger`,
 * `LineTable`, `ProjectBody` and `Ring` FROM `Studio.tsx`, so the customer build
 * keeps whatever of that file those four pull in.
 */
const SCREENS: Partial<Record<View, ComponentType>> =
  SURFACE_SIDE === "staff"
    ? STUDIO_SCREENS
    : SURFACE_SIDE === "customer"
      ? PORTAL_SCREENS
      : { ...STUDIO_SCREENS, ...PORTAL_SCREENS };

function CurrentScreen() {
  const view = useStore((s) => s.view);
  const Screen = SCREENS[view] ?? NotFound;
  return <Screen />;
}

export default function App() {
  const initTheme = useStore((s) => s.initTheme);
  const escape = useStore((s) => s.escape);

  /*
   * Publish the live locale to the module-level bridge before anything below
   * renders, so `lib/format.ts` — which the store calls from outside React —
   * formats in the locale the tree is about to paint.
   */
  const { locale, t, money, number } = useI18n();
  setAmbient(locale, t, money, number);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") escape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [escape]);

  return (
    <>
      <a className="ol-sr-only" href="#main">
        {t("chrome.skipToContent")}
      </a>
      <Shell>
        <CurrentScreen />
      </Shell>
      {/*
        Build-time, not runtime. `DEMO` folds to a literal, so a hosted or
        connected build does not CONTAIN the dock — it is not merely hidden.
        Rendering it unconditionally, as this line did, put the seeded fiction's
        controls into every build that shipped.
      */}
      {DEMO && <DemoDock />}
      <ToastLayer />
      <PaySheet />
      <RecordPayment />
      <DeclineDialog />
      <ChangesDialog />
    </>
  );
}
