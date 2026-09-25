/**
 * The strings the page looks keys up in, per build.
 *
 * The customer build — a client's page, served to anyone with a link — carries
 * only the areas the clients' side reads (`CUSTOMER_AREAS`): the chrome and
 * its own. Every other build carries every area. `SURFACE_SIDE` folds to a
 * literal, so the other branch, and every area only it names, is not in the
 * customer's file at all.
 */
import { SURFACE_SIDE } from "../../surface.ts";
import { AREAS, CUSTOMER_AREAS, bundleOf } from "./index.ts";

export const RUNTIME_MESSAGES =
  SURFACE_SIDE === "customer" ? /*#__PURE__*/ bundleOf(Object.values(CUSTOMER_AREAS)) : /*#__PURE__*/ bundleOf(Object.values(AREAS));
