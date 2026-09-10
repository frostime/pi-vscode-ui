export type SanitizedMarkdownSvg =
  | { ok: true; svg: string; removedScripts: boolean }
  | { ok: false };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * SVG is always loaded through a Blob URL in an <img>, never injected as DOM.
 * The only source transformation needed for this boundary is removing script
 * elements and reporting that change to the user.
 */
export function sanitizeMarkdownSvg(source: string): SanitizedMarkdownSvg {
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = document.querySelector("svg");
  if (!root || root.namespaceURI !== SVG_NAMESPACE) return { ok: false };

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
