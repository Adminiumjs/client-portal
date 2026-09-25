/**
 * The icons the frames draw by name (the sidebar's, from `app/routes.ts`).
 * A screen imports its own icons from `lucide-react` directly.
 */
import { BellRing, CalendarDays, FileText, FolderKanban, Gauge, House, Inbox, ReceiptText, Settings, Timer, Truck, UsersRound, Wallet, type LucideIcon } from "lucide-react";

export const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  house: House,
  inbox: Inbox,
  "file-text": FileText,
  "folder-kanban": FolderKanban,
  "users-round": UsersRound,
  "receipt-text": ReceiptText,
  "bell-ring": BellRing,
  "calendar-days": CalendarDays,
  gauge: Gauge,
  wallet: Wallet,
  truck: Truck,
  timer: Timer,
  settings: Settings,
};
