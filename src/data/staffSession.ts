/**
 * The signed-in staff member's Adminium session, as the desk's frame uses it:
 * "Your account" opens Adminium's own account page, and "Sign out" ends the
 * Adminium session and lands on its sign-in page, which comes back here.
 *
 * The token is the staff config's (set at boot); the demo sets none, and its
 * sign-out only says so.
 */
let token: () => string | null = () => null;

export function setStaffToken(read: () => string | null): void {
  token = read;
}

export const staffToken = (): string | null => token();

/** Adminium's account page, beside this app. */
export const ACCOUNT_URL = "/account";

/** End the Adminium session, then land on its sign-in page with a way back to `next`. */
export async function signOutStaff(next: string, opts: { fetchImpl?: typeof fetch; go?: (url: string) => void } = {}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const csrf = token();
  try {
    await doFetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: csrf === null ? {} : { "x-adminium-csrf": csrf } });
  } catch {
    // Offline: the sign-in page will say so.
  }
  const url = `/login?next=${encodeURIComponent(next)}`;
  if (opts.go !== undefined) {
    opts.go(url);
    return;
  }
  // The whole window when the desk is framed inside Adminium: its sign-in ends too.
  (window.top ?? window).location.assign(url);
}
