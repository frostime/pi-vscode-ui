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

export const EMPTY_COMPOSER_DRAFT: ComposerDraftView = {
  revision: 0,
  text: "",
  images: [],
};
