/**
 * A deliverable's icon, by the name it stores (what its file or link
 * suggested when it was added), and the tile it sits on: the client's own
 * colour, faint.
 */
import type { CSSProperties } from "react";
import { Box, File, FileArchive, FileCode, FileImage, FileText, Link, Package, Palette, PenTool, Ruler, Shapes, Type, type LucideIcon } from "lucide-react";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  file: File,
  "file-image": FileImage,
  "file-text": FileText,
  "file-code": FileCode,
  "file-archive": FileArchive,
  link: Link,
  package: Package,
  box: Box,
  ruler: Ruler,
  "pen-tool": PenTool,
  shapes: Shapes,
  palette: Palette,
  type: Type,
};

export function DeliverableIcon({ name, className, size = 44 }: { name: string | null; className?: string; size?: number }) {
  const Icon = ICONS[name ?? ""] ?? File;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/**
 * A tile in the client's own colour, faint (the studio's accent when the
 * client has none): the colour rides in `--tint`; `.prj-tile` draws it, a
 * little stronger in the dark theme.
 */
export function tileStyle(tint: string | null): CSSProperties {
  return { "--tint": /^#[0-9a-f]{3,8}$/i.test(tint ?? "") ? (tint as string) : "var(--accent)" } as CSSProperties;
}
