/**
 * A sentence with a piece drawn differently inside it (an address in mono, a
 * number in bold): the translation keeps the placeholder where its language
 * puts it, and the piece is drawn in its place.
 */
import { Fragment, type ReactNode } from "react";

/** `slot("If {masked} is one of ours…", "masked", <b>a•••@x</b>)` → the sentence with the node in place. */
export function slot(text: string, name: string, node: ReactNode): ReactNode {
  const parts = text.split(`{${name}}`);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && node}
      {part}
    </Fragment>
  ));
}
