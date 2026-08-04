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

const SCREENS: Record<View, ComponentType> = {
  home: Home,
  proposals: Proposals,
  proposal: ProposalPage,
  projects: Projects,
  project: ProjectPage,
  invoices: Invoices,
  invoice: InvoicePage,
  entry: Entry,
  review: Review,
  progress: Progress,
  clientinvoice: ClientInvoice,
  notfound: NotFound,
};

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
      <DemoDock />
      <ToastLayer />
      <PaySheet />
      <RecordPayment />
      <DeclineDialog />
      <ChangesDialog />
    </>
  );
}
