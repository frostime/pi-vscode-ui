import { chatTypographyDefaults as defaults, type ChatTypographyView } from "../shared/model/chatTypography.js";

interface ConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
}

export function readChatTypography(config: ConfigurationReader): ChatTypographyView {
  const messageFontFamily = readFontFamily(config.get("fontFamily", defaults["chat.fontFamily"]));
  const composerFontFamily = readFontFamily(config.get("editor.fontFamily", defaults["chat.editor.fontFamily"]));
  return {
    message: {
      ...(messageFontFamily ? { fontFamily: messageFontFamily } : {}),
      fontSize: readFontSize(config.get("fontSize", defaults["chat.fontSize"]), defaults["chat.fontSize"]),
    },
    composer: {
      ...(composerFontFamily ? { fontFamily: composerFontFamily } : {}),
      fontSize: readFontSize(config.get("editor.fontSize", defaults["chat.editor.fontSize"]), defaults["chat.editor.fontSize"]),
    },
  };
}

function readFontFamily(value: string): string | undefined {
  const normalized = value.trim();
  return normalized && normalized !== "default" ? normalized : undefined;
}

function readFontSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
