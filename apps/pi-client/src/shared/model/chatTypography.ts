export const chatTypographyDefaults = {
  "chat.fontFamily": "default",
  "chat.fontSize": 13,
  "chat.editor.fontFamily": "default",
  "chat.editor.fontSize": 14,
} as const;

export interface ChatTypographyView {
  message: {
    fontFamily?: string;
    fontSize: number;
  };
  composer: {
    fontFamily?: string;
    fontSize: number;
  };
}
