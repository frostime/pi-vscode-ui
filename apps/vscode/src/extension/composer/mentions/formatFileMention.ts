import { formatPromptReference } from "@frostime/pi-client/shared/files/promptReferences.js";

/** Explicit path/line reference only; never reads or injects file bodies. */
export const formatFileMention = formatPromptReference;
