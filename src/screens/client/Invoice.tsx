/**
 * An invoice: how to pay, I've sent a payment — to be drawn.
 *
 * A placeholder: it names the page and nothing more. The clients' lane
 * replaces this file whole (same name, a default export, no props).
 */
import { Placeholder } from "../../components/Placeholder.tsx";

export default function Invoice() {
  return <Placeholder titleKey="nav.invoice" view="client-invoice" />;
}
