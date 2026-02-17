export type PDFProcessorResult = { html: string; markdown?: string };

export type RustExtractionResult = {
  content: PDFProcessorResult | null;
  pageCount: number;
  title: string | null | undefined;
};

export const MAX_FILE_SIZE = 19 * 1024 * 1024; // 19MB
export const MAX_RUST_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MILLISECONDS_PER_PAGE = 150;
