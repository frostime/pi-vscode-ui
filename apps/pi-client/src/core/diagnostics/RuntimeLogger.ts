export interface RuntimeLogger {
  error(message: string, error?: unknown): void;
  info(message: string): void;
}
