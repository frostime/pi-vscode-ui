declare module "markdown-it/lib/rules_inline/image.mjs" {
  import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

  export default function image(state: StateInline, silent: boolean): boolean;
}
