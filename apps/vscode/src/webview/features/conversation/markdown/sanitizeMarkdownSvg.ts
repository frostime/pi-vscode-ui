import DOMPurify from "dompurify";

export type SanitizedMarkdownSvg =
  | { ok: true; svg: string; removedUnsafeContent: boolean }
  | { ok: false };

const MAX_SVG_DIMENSION = 16_384;
const ACTIVE_TAGS = [
  "script",
  "foreignObject",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "discard",
  "style",
];
const URI_ATTRIBUTES = new Set(["href", "xlink:href"]);
const GRAPHICAL_ELEMENTS = new Set([
  "circle",
  "ellipse",
  "image",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
  "use",
]);

export function sanitizeMarkdownSvg(source: string): SanitizedMarkdownSvg {
  let removedUnsafeContent = containsUnsafeSvgContent(source);
  const cleaned = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ACTIVE_TAGS,
    FORBID_ATTR: ["style"],
  });

  const document = new DOMParser().parseFromString(cleaned, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) return { ok: false };

  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        removedUnsafeContent = true;
        continue;
      }
      if (URI_ATTRIBUTES.has(name) && !isLocalFragment(attribute.value)) {
        element.removeAttribute(attribute.name);
        removedUnsafeContent = true;
        continue;
      }
      if (containsExternalCssUrl(attribute.value)) {
        element.removeAttribute(attribute.name);
        removedUnsafeContent = true;
      }
    }
  }

  if (!hasSafeIntrinsicDimensions(root) || !hasGraphicalContent(root)) return { ok: false };
  return {
    ok: true,
    svg: new XMLSerializer().serializeToString(root),
    removedUnsafeContent,
  };
}

function containsUnsafeSvgContent(source: string): boolean {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) return true;
  for (const element of [document.documentElement, ...document.documentElement.querySelectorAll("*")]) {
    if (ACTIVE_TAGS.some((tag) => tag.toLowerCase() === element.localName.toLowerCase())) return true;
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === "style" || name.startsWith("on")) return true;
      if (URI_ATTRIBUTES.has(name) && !isLocalFragment(attribute.value)) return true;
      if (containsExternalCssUrl(attribute.value)) return true;
    }
  }
  return false;
}

function isLocalFragment(value: string): boolean {
  return /^#[A-Za-z_][\w:.-]*$/.test(value.trim());
}

function containsExternalCssUrl(value: string): boolean {
  const urls = value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi);
  for (const match of urls) if (!isLocalFragment(match[2] ?? "")) return true;
  return false;
}

function hasSafeIntrinsicDimensions(root: Element): boolean {
  const width = absoluteLength(root.getAttribute("width"));
  const height = absoluteLength(root.getAttribute("height"));
  if (width !== null && (width <= 0 || width > MAX_SVG_DIMENSION)) return false;
  if (height !== null && (height <= 0 || height > MAX_SVG_DIMENSION)) return false;

  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox) return true;
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) return false;
  return viewBox[2]! > 0
    && viewBox[3]! > 0
    && viewBox[2]! <= MAX_SVG_DIMENSION
    && viewBox[3]! <= MAX_SVG_DIMENSION;
}

function absoluteLength(value: string | null): number | null {
  if (value === null || /%$/.test(value.trim())) return null;
  const match = value.trim().match(/^([\d.]+)(?:px)?$/i);
  return match ? Number(match[1]) : null;
}

function hasGraphicalContent(root: Element): boolean {
  return [...root.querySelectorAll("*")].some((element) => GRAPHICAL_ELEMENTS.has(element.localName.toLowerCase()));
}
