export interface ComposerDraftImageView {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  size: number;
}

export interface ComposerDraftContent {
  text: string;
  images: ComposerDraftImageView[];
}

export interface ComposerDraftView extends ComposerDraftContent {
  revision: number;
}

/** Recover before the latest draft without discarding whitespace or attachments. */
export function prependComposerDraftContent(current: ComposerDraftContent, recovered: ComposerDraftContent): ComposerDraftContent {
  return {
    text: [recovered.text, current.text].filter((text) => text.length > 0).join("\n\n"),
    images: [...recovered.images, ...current.images].map((image) => ({ ...image })),
  };
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraftView = {
  revision: 0,
  text: "",
  images: [],
};
