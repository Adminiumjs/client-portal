/**
 * The answers that mean the studio has switched the clients' side off (the
 * public API, the app, its surface or its key) — as opposed to a fault. A
 * client then sees the "not available" page in their own language, never the
 * server's sentence for an operator.
 */
export const SWITCHED_OFF: ReadonlySet<string> = new Set(["PUBLIC_SWITCHED_OFF", "SURFACE_OFF", "APP_DISABLED", "PUBLIC_API_DISABLED", "PUBLIC_KEY_OFF"]);

export const isSwitchedOff = (code: string | null | undefined): boolean => typeof code === "string" && SWITCHED_OFF.has(code);
