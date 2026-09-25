/**
 * One email drawn as its reader gets it: the studio's mark and name, then
 * the email itself — designed (or narrowed to a phone), or as plain text —
 * and its foot: where the button goes and the footer. The words are the
 * template's, filled; the page's own words are only the frame around it.
 */
import { ArrowRight, ArrowUpRight, File, Receipt, Scale } from "lucide-react";

import { BrandMark } from "../../components/BrandMark.tsx";
import type { LocaleTag } from "../../i18n/locales.ts";
import { dirFor } from "../../i18n/locales.ts";
import { buttonOf, plainLines, type EmailDoc, type Piece } from "./model.ts";

export type Mode = "rich" | "plain" | "narrow";

const ROW_ICONS = [Receipt, Scale, File] as const;

function RichPiece({ piece, studio, onFollow, index }: { piece: Piece; studio: boolean; onFollow: () => void; index: number }) {
  switch (piece.kind) {
    case "lead":
      return <span className="em-lead">{piece.text}</span>;
    case "para":
      return <p className="em-para">{piece.text}</p>;
    case "code":
      return (
        <span className="em-code" dir="ltr">
          {piece.text}
        </span>
      );
    case "quote":
      return <span className="em-quote">{piece.text}</span>;
    case "rows":
      return (
        <div className="em-rows">
          {piece.rows.map((r, i) => {
            const Icon = ROW_ICONS[Math.min(i, ROW_ICONS.length - 1)]!;
            return (
              <span className="em-row" key={`${String(index)}-${String(i)}`}>
                <Icon size={15} className="em-row-icon" aria-hidden="true" />
                <span className="em-row-text">
                  <span className="em-row-a">{r.a}</span>
                  {r.b !== "" && <span className="em-row-b">{r.b}</span>}
                </span>
                {r.c !== "" && <span className="em-row-c">{r.c}</span>}
              </span>
            );
          })}
        </div>
      );
    case "box":
      return (
        <div className="em-box">
          <span className="em-box-label">{piece.label}</span>
          {piece.lines.map((line, i) => (
            <span className="em-box-line" key={i}>
              {line}
            </span>
          ))}
          {piece.reference !== null && <span className="em-box-line em-box-line--mono">{piece.reference}</span>}
        </div>
      );
    case "button":
      return studio ? (
        <button type="button" className="em-link ol-gi" onClick={onFollow}>
          {piece.label}
          <ArrowUpRight size={14} aria-hidden="true" className="em-flip" />
        </button>
      ) : (
        <button type="button" className="em-cta ol-btn" onClick={onFollow}>
          {piece.label}
          <ArrowRight size={16} aria-hidden="true" className="em-flip" />
        </button>
      );
    case "after":
      return <p className="em-after">{piece.text}</p>;
    case "sign":
      return <span className="em-sign">{piece.text}</span>;
  }
}

export function EmailCard({ doc, pieces, mode, studio, tag, studioName, mark, onFollow }: { doc: EmailDoc; pieces: readonly Piece[]; mode: Mode; studio: boolean; tag: LocaleTag; studioName: string; mark: string | null; onFollow: () => void }) {
  const button = buttonOf(pieces);
  const plain = mode === "plain";
  return (
    <div className={`em-card${mode === "narrow" ? " em-card--narrow" : ""}`} lang={tag} dir={dirFor(tag)} data-mode={mode}>
      <div className="em-brand">
        <BrandMark mark={mark} name={studioName} />
        <span className="em-brand-name">{studioName}</span>
      </div>
      <div className="em-body">
        {plain ? (
          <div className="em-plain">
            {plainLines(pieces, doc.footer).map((line, i) => (
              <span key={i} className={`em-plain-line em-plain-line--${line.tone}`}>
                {line.text}
              </span>
            ))}
          </div>
        ) : (
          <div className="em-rich">
            {pieces.map((piece, i) => (
              <RichPiece key={i} index={i} piece={piece} studio={studio} onFollow={onFollow} />
            ))}
          </div>
        )}
      </div>
      <div className="em-foot">
        {button !== null && (
          <span className="em-url" dir="ltr">
            {button.url}
          </span>
        )}
        {doc.footer.trim() !== "" && <span className="em-foot-text">{doc.footer}</span>}
      </div>
    </div>
  );
}
