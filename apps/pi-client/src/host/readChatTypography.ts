import type { ChatTypographyView } from "../shared/model/chatTypography.js";

interface ConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
}

const DEFAULT_MESSAGE_FONT_SIZE = 13;
const DEFAULT_COMPOSER_FONT_SIZE = 14;

export function readChatTypography(config: ConfigurationReader): ChatTypographyView {
  const messageFontFamily = readFontFamily(config.get("fontFamily", "default"));
  const composerFontFamily = readFontFamily(config.get("editor.fontFamily", "default"));
  return {
    message: {
      ...(messageFontFamily ? { fontFamily: messageFontFamily } : {}),
      fontSize: readFontSize(config.get("fontSize", DEFAULT_MESSAGE_FONT_SIZE), DEFAULT_MESSAGE_FONT_SIZE),
    },
    composer: {
      ...(composerFontFamily ? { fontFamily: composerFontFamily } : {}),
      fontSize: readFontSize(config.get("editor.fontSize", DEFAULT_COMPOSER_FONT_SIZE), DEFAULT_COMPOSER_FONT_SIZE),
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
