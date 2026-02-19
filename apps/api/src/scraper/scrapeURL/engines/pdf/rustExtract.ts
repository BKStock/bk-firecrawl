import { Meta } from "../..";
import * as marked from "marked";
import * as Sentry from "@sentry/node";
import { stat } from "node:fs/promises";
import { processPdf } from "@mendable/firecrawl-rs";
import { MAX_RUST_FILE_SIZE } from "./types";
import type { RustExtractionResult } from "./types";

/** Check if the Rust extraction result is usable, returning a rejection reason or null. */
function getSkipReason(result: ReturnType<typeof processPdf>): string | null {
  if (result.pdfType !== "TextBased") return `pdfType=${result.pdfType}`;
  if (result.confidence < 0.95) return `confidence=${result.confidence}`;
  if (result.isComplex) return "complex layout (tables/columns)";
  if (!result.markdown?.length)
    return "empty markdown (unexpected for TextBased)";
  return null;
}

export async function scrapePDFWithRust(
  meta: Meta,
  tempFilePath: string,
): Promise<RustExtractionResult | null> {
  const logger = meta.logger.child({ method: "scrapePDF/rustExtract" });
  const startedAt = Date.now();

  try {
    const fileSize = (await stat(tempFilePath)).size;
    if (fileSize > MAX_RUST_FILE_SIZE) {
      logger.info("PDF too large for Rust extraction, skipping", {
        fileSize,
        maxSize: MAX_RUST_FILE_SIZE,
      });
      return null;
    }

    const result = processPdf(tempFilePath);
    const durationMs = Date.now() - startedAt;

    logger.info("Rust PDF extraction completed", {
      durationMs,
      pdfType: result.pdfType,
      pageCount: result.pageCount,
      confidence: result.confidence,
      markdownLength: result.markdown?.length ?? 0,
      url: meta.rewrittenUrl ?? meta.url,
    });

    const skipReason = getSkipReason(result);
    if (skipReason) {
      const level = skipReason.startsWith("empty markdown") ? "warn" : "info";
      logger[level]("Rust extraction not applicable, falling through to MU", {
        reason: skipReason,
      });
      // Return metadata (avoids redundant getPdfMetadata call) but no content
      return {
        content: null,
        pageCount: result.pageCount,
        title: result.title,
      };
    }

    const html = await marked.parse(result.markdown, { async: true });
    return {
      content: { markdown: result.markdown, html },
      pageCount: result.pageCount,
      title: result.title,
    };
  } catch (error) {
    logger.warn("Rust PDF extraction failed", {
      error,
      durationMs: Date.now() - startedAt,
    });
    Sentry.captureException(error);
    return null;
  }
}
