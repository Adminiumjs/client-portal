/**
 * The printed copy — to be drawn.
 *
 * A placeholder: it names the screen and nothing more. The screen's lane
 * replaces this file whole (same name, a default export, no props).
 */
import { Placeholder } from "../components/Placeholder.tsx";

export default function Print() {
  return <Placeholder titleKey="screen.print" view="print" />;
}
