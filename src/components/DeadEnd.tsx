/**
 * The design's dead end: a 404 or a page that is not available — a faint
 * code or an icon, a kicker, a heading, one line, and two ways on. The
 * desk's 404 draws it flat on the page; the clients' side in a card.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function DeadEnd({ code, badge: Badge, kicker, title, body, actions, card = false, titleId }: { code?: string; badge?: LucideIcon; kicker?: string; title: ReactNode; body: ReactNode; actions: ReactNode; card?: boolean; titleId?: string }) {
  return (
    <div className={`dead-end ol-screen${card ? " dead-end--card" : ""}`}>
      {/* The faint code is decoration; the heading says it in words. */}
      {code !== undefined && <span className="dead-end-code" aria-hidden="true" data-code={code} />}
      {Badge !== undefined && (
        <span className="dead-end-badge" aria-hidden="true">
          <Badge size={26} />
        </span>
      )}
      {kicker !== undefined && <span className="dead-end-kicker">{kicker}</span>}
      <h1 className="dead-end-title" id={titleId}>
        {title}
      </h1>
      <p className="dead-end-body">{body}</p>
      <div className="dead-end-actions">{actions}</div>
    </div>
  );
}
