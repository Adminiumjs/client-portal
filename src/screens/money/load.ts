/**
 * What the Money screen reads when it opens, beyond the open work the desk
 * holds: the six months' sent invoices and payments (with the invoices and
 * clients they name) and the running costs. Reads only.
 */
import type { Day } from "../../data/types.ts";
import { ensureRows, loadWhere, useDesk } from "../../state/desk.ts";
import { loadRunningCosts } from "../../state/officeActions.ts";
import { firstDayOf, sixMonths } from "./model.ts";

export async function loadMoney(today: Day): Promise<void> {
  const since = firstDayOf(sixMonths(today)[0]!);
  await Promise.all([
    loadWhere("invoices", { and: [{ column: "status", op: "eq", value: "sent" }, { column: "issued_on", op: "gte", value: since }] }, "issued_on.asc", 1000).then((invoices) =>
      ensureRows("clients", invoices.map((i) => i.client_id)),
    ),
    loadWhere("payments", { column: "paid_on", op: "gte", value: since }, "paid_on.asc", 1000).then(async (payments) => {
      await ensureRows("invoices", payments.map((p) => p.document_id));
      const held = useDesk.getState().rows.invoices;
      await ensureRows("clients", payments.map((p) => p.client_id ?? held[p.document_id]?.client_id ?? null));
    }),
    loadRunningCosts(),
  ]);
}
