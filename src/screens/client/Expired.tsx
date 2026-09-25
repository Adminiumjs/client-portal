/**
 * A used or expired sign-in link — to be drawn.
 *
 * A placeholder: it names the page and nothing more. The clients' lane
 * replaces this file whole (same name, a default export, no props).
 */
import { Placeholder } from "../../components/Placeholder.tsx";

export default function Expired() {
  return <Placeholder titleKey="screen.expired" view="client-expired" />;
}
