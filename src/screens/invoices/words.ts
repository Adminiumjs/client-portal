/**
 * Small pieces the money screens share: a contact's first name (for "Sent to
 * Amara."), the three ladders in their order, the payment methods the record
 * sheet offers.
 */
import type { InvoiceLadder, PaymentMethod } from "../../data/types.ts";

/** The first word of a contact's name. */
export const firstName = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

export const LADDERS: readonly InvoiceLadder[] = ["gentle", "standard", "firm"];

/** The methods a payment is recorded with, in the sheet's order ("Other" is Adminium's too, kept for rows it wrote). */
export const METHODS: readonly PaymentMethod[] = ["bank-transfer", "card", "cheque", "cash"];
