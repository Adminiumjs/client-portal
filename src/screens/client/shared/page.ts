/**
 * What every signed-in page of the clients' side does the same way: send a
 * visitor who is not signed in to sign-in, read the page's own document when
 * it opens, open one of the studio's documents or files in a new tab, and put
 * a refusal into words.
 */
import { useEffect, useState } from "react";

import type { PortalPort } from "../../../data/ports.ts";
import type { Id } from "../../../data/types.ts";
import type { TFunction } from "../../../i18n/index.tsx";
import { refusalKey, type Outcome } from "../../../state/outcome.ts";
import { portalPort, usePortal } from "../../../state/portal.ts";
import { go, toast, useUi } from "../../../state/ui.ts";

/** The clients' port, or null where there is none (the studio's preview on the desk's own build). */
export function portOrNull(): PortalPort | null {
  try {
    return portalPort();
  } catch {
    return null;
  }
}

export const inPreview = (): boolean => useUi.getState().preview !== null;

/**
 * A page that shows a client's own things: someone not signed in (and not the
 * studio previewing) is sent to sign-in instead.
 */
export function useSignedIn(): boolean {
  const me = usePortal((s) => s.me);
  const loading = usePortal((s) => s.load === "loading");
  const preview = useUi((s) => s.preview !== null);
  const signedIn = me !== null || preview;
  useEffect(() => {
    if (!signedIn && !loading) go("find");
  }, [signedIn, loading]);
  return signedIn;
}

/**
 * Read the page's document when it opens (and when it changes). The page can
 * draw at once when the document is already held (Home read it); otherwise
 * `ready` turns true once the read has answered, so a page can tell "still
 * reading" from "not there" (an unknown id and another client's id both land
 * on not found).
 */
export function useOpened(id: Id | null, load: (id: Id) => Promise<void>, held = false): boolean {
  const [readyFor, setReadyFor] = useState<Id | null>(null);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    load(id)
      .catch(() => undefined)
      .finally(() => {
        if (live) setReadyFor(id);
      });
    return () => {
      live = false;
    };
  }, [id, load]);
  return id === null || held || readyFor === id;
}

/**
 * Open something the server hands a link to (a document, a private file) in a
 * new tab. The tab opens at once, on the click, so no pop-up blocker stops it;
 * the address follows when the server answers.
 */
export async function openInNewTab(link: () => Promise<string> | string, blocked: string): Promise<boolean> {
  const tab = typeof window === "undefined" ? null : window.open("about:blank", "_blank");
  if (tab === null) {
    toast(blocked, { icon: "warn", tone: "danger" });
    return false;
  }
  try {
    tab.opener = null;
    tab.location.replace(await link());
    return true;
  } catch {
    tab.close();
    toast(blocked, { icon: "warn", tone: "danger" });
    return false;
  }
}

/** A refused action in words: the studio's preview says so; anything else, the shared wording. */
export function sayRefusal<T>(t: TFunction, outcome: Outcome<T>): string | null {
  if (outcome.ok) return null;
  const text = t(refusalKey(outcome.reason));
  if (outcome.reason === "preview") toast(text, { icon: "info" });
  return outcome.reason === "preview" ? null : text;
}
