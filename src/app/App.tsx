/**
 * The app: the clients' side or the studio's desk, the screen on show, and
 * what can open over it (a sheet, the toasts).
 *
 * The two sides' screens are two separate records ON PURPOSE. `SURFACE_SIDE`
 * folds to a literal at build time, so the clients' bundle — served to anyone
 * on the internet — does not contain a single desk screen, and the desk's
 * bundle no client page. One record filtered at runtime would be tidier and
 * would ship the desk to every visitor (`testing/surfaceBuild.test.ts` checks
 * it does not). `routes.ts` names every view and its file; `routes.test.ts`
 * holds these records to it.
 */
import { useEffect, type ComponentType } from "react";

import { setAmbient } from "../i18n/ambient.ts";
import { useI18n } from "../i18n/index.tsx";
import { SURFACE_SIDE } from "../surface.ts";
import type { CustomerView, StaffView } from "../surface-nav.ts";
import { usePortal } from "../state/portal.ts";
import { useUi } from "../state/ui.ts";
import { isSwitchedOff } from "./switchedOff.ts";

import ClientFrame from "../components/ClientFrame.tsx";
import ClientSheetHost from "../components/ClientSheetHost.tsx";
import DeskFrame from "../components/DeskFrame.tsx";
import SheetHost from "../components/SheetHost.tsx";
import { Toasts } from "../components/Toasts.tsx";

import Home from "../screens/Home.tsx";
import Enquiries from "../screens/Enquiries.tsx";
import Proposals from "../screens/Proposals.tsx";
import Proposal from "../screens/Proposal.tsx";
import Composer from "../screens/Composer.tsx";
import Projects from "../screens/Projects.tsx";
import Project from "../screens/Project.tsx";
import Review from "../screens/Review.tsx";
import Handover from "../screens/Handover.tsx";
import Clients from "../screens/Clients.tsx";
import Client from "../screens/Client.tsx";
import Invoices from "../screens/Invoices.tsx";
import Invoice from "../screens/Invoice.tsx";
import Print from "../screens/Print.tsx";
import Chasing from "../screens/Chasing.tsx";
import Terms from "../screens/Terms.tsx";
import Settings from "../screens/Settings.tsx";
import Time from "../screens/Time.tsx";
import Expenses from "../screens/Expenses.tsx";
import Suppliers from "../screens/Suppliers.tsx";
import Scoping from "../screens/Scoping.tsx";
import Schedule from "../screens/Schedule.tsx";
import Capacity from "../screens/Capacity.tsx";
import Money from "../screens/Money.tsx";
import Archive from "../screens/Archive.tsx";
import Emails from "../screens/Emails.tsx";
import NotFound from "../screens/NotFound.tsx";

import ClientFind from "../screens/client/Find.tsx";
import ClientLink from "../screens/client/Link.tsx";
import ClientHome from "../screens/client/Home.tsx";
import ClientProposal from "../screens/client/Proposal.tsx";
import ClientProject from "../screens/client/Project.tsx";
import ClientReview from "../screens/client/Review.tsx";
import ClientInvoice from "../screens/client/Invoice.tsx";
import ClientStatement from "../screens/client/Statement.tsx";
import ClientBrief from "../screens/client/Brief.tsx";
import ClientHandover from "../screens/client/Handover.tsx";
import ClientExpired from "../screens/client/Expired.tsx";
import ClientNotAvailable from "../screens/client/NotAvailable.tsx";
import ClientEnquire from "../screens/client/Enquire.tsx";
import ClientNotFound from "../screens/client/NotFound.tsx";

const DESK_SCREENS = {
  home: Home,
  enquiries: Enquiries,
  proposals: Proposals,
  proposal: Proposal,
  composer: Composer,
  projects: Projects,
  project: Project,
  review: Review,
  handover: Handover,
  clients: Clients,
  client: Client,
  invoices: Invoices,
  invoice: Invoice,
  print: Print,
  chasing: Chasing,
  terms: Terms,
  settings: Settings,
  time: Time,
  expenses: Expenses,
  suppliers: Suppliers,
  scoping: Scoping,
  schedule: Schedule,
  capacity: Capacity,
  money: Money,
  archive: Archive,
  emails: Emails,
  notfound: NotFound,
} satisfies Record<StaffView, ComponentType>;

const CLIENT_SCREENS = {
  find: ClientFind,
  link: ClientLink,
  home: ClientHome,
  proposal: ClientProposal,
  project: ClientProject,
  review: ClientReview,
  invoice: ClientInvoice,
  statement: ClientStatement,
  brief: ClientBrief,
  handover: ClientHandover,
  expired: ClientExpired,
  notavailable: ClientNotAvailable,
  enquire: ClientEnquire,
  notfound: ClientNotFound,
} satisfies Record<CustomerView, ComponentType>;


function Desk() {
  const view = useUi((s) => s.view);
  const Screen = (DESK_SCREENS as Partial<Record<string, ComponentType>>)[view] ?? NotFound;
  return (
    <>
      <DeskFrame>
        <Screen />
      </DeskFrame>
      <SheetHost />
      <Toasts />
    </>
  );
}

function ClientSide() {
  const view = useUi((s) => s.view);
  const off = usePortal((s) => isSwitchedOff(s.loadError));
  const Screen = off ? ClientNotAvailable : ((CLIENT_SCREENS as Partial<Record<string, ComponentType>>)[view] ?? ClientNotFound);
  return (
    <>
      <ClientFrame>
        <Screen />
      </ClientFrame>
      <ClientSheetHost />
      <Toasts />
    </>
  );
}

export default function App() {
  const { locale, t, money, number } = useI18n();
  // Publish the live locale before anything renders, so the formatters called
  // outside React are already in the new language on the first paint.
  setAmbient(locale, t, money, number);
  const theme = useUi((s) => s.theme);
  const persona = useUi((s) => s.persona);
  const preview = useUi((s) => s.preview !== null);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  if (SURFACE_SIDE === "staff") return preview ? <ClientSide /> : <Desk />;
  if (SURFACE_SIDE === "customer") return <ClientSide />;
  // The demo: both sides, switched by the card's persona.
  return persona === "client" || preview ? <ClientSide /> : <Desk />;
}
