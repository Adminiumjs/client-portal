/**
 * How the desk reads a file column's value: Adminium's file id or content
 * URL (read through the private file routes, drawn inline only for images
 * and PDFs — never an SVG), a link to somewhere else, or a file this browser
 * just uploaded (drawn from its own copy).
 */
import { afterEach, describe, expect, it } from "vitest";

import { drawable, fileInfo, forgetFiles, iconFor, parseFileRef, rememberUpload, sizeLabel, type Fetcher } from "./files.ts";

const ID = "file_01J8ZK4Q2W3E5R7T9Y1U3I5O7P";
const GOOD_ID = "file_01J8ZK4Q2W3E5R7T9Y1V3X5N7P";

afterEach(() => forgetFiles());

describe("a file column's value", () => {
  it("is Adminium's file by id or by content URL, a link, or a name", () => {
    expect(parseFileRef(GOOD_ID)).toEqual({ kind: "adminium", id: GOOD_ID });
    expect(parseFileRef(`https://studio.example/api/v1/files/${GOOD_ID}/content`)).toEqual({ kind: "adminium", id: GOOD_ID });
    expect(parseFileRef("https://www.figma.com/file/abc")).toEqual({ kind: "external", href: "https://www.figma.com/file/abc" });
    expect(parseFileRef("demo-file:logo.pdf")).toEqual({ kind: "local", name: "logo.pdf" });
    expect(parseFileRef(" ")).toEqual({ kind: "none" });
    // I, L, O and U are not in the id alphabet: not an id, so not read from Adminium.
    expect(parseFileRef(ID).kind).toBe("local");
  });

  it("draws images and PDFs; an SVG, an archive or anything unknown is a card", () => {
    expect(drawable("image/png")).toBe("image");
    expect(drawable(null, "mark.JPG")).toBe("image");
    expect(drawable("application/pdf")).toBe("pdf");
    expect(drawable("image/svg+xml", "mark.svg")).toBe("none");
    expect(drawable(null, "mark.svg")).toBe("none");
    expect(drawable("application/zip")).toBe("none");
    expect(iconFor({ mime: null, name: "wordmark.svg" })).toBe("file-code");
    expect(iconFor({ mime: "application/pdf", name: "x" })).toBe("file-text");
    expect(iconFor("link")).toBe("link");
  });

  it("says a size the way people read it", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(48 * 1024)).toBe("48 KB");
    expect(sizeLabel(8.4 * 1048576)).toBe("8.4 MB");
    expect(sizeLabel(null)).toBe("");
  });
});

describe("reading a file's facts", () => {
  it("asks Adminium's private route for the name, type and size; draws inline only what may be drawn", async () => {
    const asked: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      asked.push(`${url} ${String(init?.credentials)}`);
      return new Response(JSON.stringify({ data: { filename: "logo_v3.pdf", mime: "application/pdf", sizeBytes: 1200 } }), { status: 200 });
    };
    const info = await fileInfo(GOOD_ID, fetcher);
    expect(asked).toEqual([`/api/v1/files/${GOOD_ID} same-origin`]);
    expect(info).toEqual({ name: "logo_v3.pdf", mime: "application/pdf", size: 1200, url: `/api/v1/files/${GOOD_ID}/content?inline=true`, download: `/api/v1/files/${GOOD_ID}/content` });
    await fileInfo(GOOD_ID, fetcher);
    expect(asked).toHaveLength(1);
  });

  it("never asks to see an SVG inline", async () => {
    const fetcher: Fetcher = async () => new Response(JSON.stringify({ data: { filename: "mark.svg", mime: "image/svg+xml", sizeBytes: 900 } }));
    const info = await fileInfo(GOOD_ID, fetcher);
    expect(info?.url).toBe(`/api/v1/files/${GOOD_ID}/content`);
    expect(drawable(info!.mime, info!.name)).toBe("none");
  });

  it("names a link by its last part, and reads nothing for it", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("no read for a link");
    };
    expect(await fileInfo("https://files.example/box-large-v1.pdf?dl=1", fetcher)).toEqual({ name: "box-large-v1.pdf", mime: null, size: null, url: null, download: "https://files.example/box-large-v1.pdf?dl=1" });
  });

  it("prefers this browser's own copy of a file it just uploaded", async () => {
    rememberUpload(GOOD_ID, new Blob(["x"], { type: "image/png" }), "box.png");
    const info = await fileInfo(GOOD_ID, async () => {
      throw new Error("should not be read");
    });
    expect(info).toMatchObject({ name: "box.png", mime: "image/png", size: 1 });
  });
});
