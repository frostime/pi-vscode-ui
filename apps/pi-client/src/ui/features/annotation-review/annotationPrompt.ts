import type { ResponseAnnotation } from "./annotationReviewModel";
import { sortAnnotations } from "./annotationReviewModel";

const ANNOTATIONS_START = "==== ANNOTATIONS ====";
const ANNOTATIONS_END = "==== END ANNOTATIONS ====";

export function formatAnnotationPrompt(source: string, annotations: readonly ResponseAnnotation[]): string {
  if (annotations.length === 0) return "";
  const sections = [ANNOTATIONS_START];

  sortAnnotations(annotations).forEach((annotation, index) => {
    const number = String(index + 1).padStart(2, "0");
    const quote = source
      .slice(annotation.start, annotation.end)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    sections.push(`--- ANNOTATION ${number} ---\n\n${quote}\n\n${annotation.comment.trim()}`);
  });

  sections.push(ANNOTATIONS_END);
  return sections.join("\n\n");
}
