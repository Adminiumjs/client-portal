/**
 * A toast draws the icon its screen asked for — the back office's wallet,
 * truck and copy among them — and the check for a name it does not know.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useUi } from "../state/ui.ts";
import { Toasts } from "./Toasts.tsx";

const drawn = (icon: string): string => {
  useUi.setState({ toasts: [{ id: 1, text: "Done", icon, tone: "pos" }] });
  Object.assign(useUi.getInitialState(), useUi.getState());
  return renderToStaticMarkup(<Toasts />);
};

describe("a toast's icon", () => {
  it("is the one the screen named", () => {
    for (const [name, drawnAs] of [
      ["wallet", "lucide-wallet"],
      ["truck", "lucide-truck"],
      ["copy", "lucide-copy"],
      ["calendar-plus", "lucide-calendar-plus"],
      ["mail-check", "lucide-mail-check"],
    ]) {
      expect(drawn(name!), name).toContain(drawnAs);
    }
  });

  it("is the check for a name it does not know", () => {
    expect(drawn("no-such-icon")).toContain("lucide-check");
  });
});
