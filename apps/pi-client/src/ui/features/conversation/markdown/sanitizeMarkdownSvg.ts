export type SanitizedMarkdownSvg =
  | { ok: true; svg: string; removedScripts: boolean }
  | { ok: false };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * SVG is always loaded through a Blob URL in an <img>, never injected as DOM.
 * ViewBox-only documents need intrinsic dimensions because the transcript's
 * shrink-to-fit image layout otherwise collapses them to a zero-sized box.
 */
export function sanitizeMarkdownSvg(source: string): SanitizedMarkdownSvg {
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = document.querySelector("svg");
  if (!root || root.namespaceURI !== SVG_NAMESPACE) return { ok: false };

  addViewBoxDimensions(root);

  let removedScripts = false;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.localName.toLowerCase() !== "script") continue;
    element.remove();
    removedScripts = true;
  }

  return {
    ok: true,
    svg: new XMLSerializer().serializeToString(root),
    removedScripts,
  };
}

function addViewBoxDimensions(root: SVGSVGElement): void {
  if (root.hasAttribute("width") || root.hasAttribute("height")) return;
  const values = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!values || values.length !== 4) return;
  const [, , width, height] = values;
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) return;
  if (width <= 0 || height <= 0) return;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
}
