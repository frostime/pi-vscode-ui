import { mount, unmount } from "svelte";

import MarkdownImage from "./MarkdownImage.svelte";

export interface MountedMarkdownImages {
  destroy(): void;
}

export function mountMarkdownImages(root: HTMLElement): MountedMarkdownImages {
  const components = [...root.querySelectorAll<HTMLElement>("[data-markdown-image]")].map((target) => {
    const source = target.dataset.imageSource ?? "";
    const alt = target.dataset.imageAlt ?? "";
    const title = target.dataset.imageTitle || undefined;
    return mount(MarkdownImage, {
      target,
      props: { source, alt, title, linked: Boolean(target.closest("a")) },
    });
  });

  return {
    destroy() {
      for (const component of components) void unmount(component);
    },
  };
}
