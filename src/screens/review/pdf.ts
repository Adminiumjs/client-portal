/**
 * A PDF's pages, drawn in the page with pdf.js — loaded only when a review
 * actually shows a PDF, so it never weighs on the first screen.
 *
 * The pages are drawn one under the other at the stage's width, so the whole
 * document is ONE drawing: a pin is a point on it, stored as percentages of
 * its width and height (the same drawing on the clients' side puts it back in
 * the same place). At most `MAX_PAGES` pages are drawn; the rest are a
 * download away.
 *
 * This module is itself loaded only when a PDF is shown; the worker's address
 * is a plain string here (the file is served beside the app).
 *
 * pdf.js runs its parsing in a worker from the app's own origin. The build in
 * use evaluates no strings as code, so the page needs no `unsafe-eval`.
 */

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const MAX_PAGES = 12;

export interface DrawnPdf {
  pages: number;
  drawn: number;
}

type PdfModule = typeof import("pdfjs-dist");
let loading: Promise<PdfModule> | null = null;

/** pdf.js and its worker, loaded once. */
export function loadPdfJs(): Promise<PdfModule> {
  loading ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  });
  return loading;
}

/**
 * Draw a PDF's pages into `into` (emptied first), `width` CSS pixels wide.
 * Stops quietly when `signal` aborts (the version changed, the page closed).
 */
export async function drawPdf(url: string, into: HTMLElement, width: number, signal: AbortSignal): Promise<DrawnPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ url, withCredentials: false, enableXfa: false });
  signal.addEventListener("abort", () => void task.destroy(), { once: true });
  const doc = await task.promise;
  const pages = doc.numPages;
  const drawn = Math.min(pages, MAX_PAGES);
  const ratio = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  for (let n = 1; n <= drawn; n++) {
    const page = await doc.getPage(n);
    if (signal.aborted) break;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = "rv-pdf-page";
    canvas.setAttribute("aria-hidden", "true");
    await page.render({ canvas, viewport }).promise;
    // A drawing that was called off (the version changed, the page closed) never touches the page.
    if (signal.aborted) break;
    if (n === 1) into.replaceChildren(canvas);
    else into.append(canvas);
  }
  return { pages, drawn };
}
