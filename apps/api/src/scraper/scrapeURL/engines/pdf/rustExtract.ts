import { Meta } from "../..";
import * as marked from "marked";
import * as Sentry from "@sentry/node";
import { processPdf } from "@mendable/firecrawl-rs";
import { config } from "../../../../config";
import type { RustExtractionResult } from "./types";

/** Check if the PDF is eligible for Rust extraction, returning a rejection reason or null. */
function getIneligibleReason(
  result: ReturnType<typeof processPdf>,
): string | null {
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

    const ineligibleReason = getIneligibleReason(result);
    const eligible = !ineligibleReason;

    // Always log eligibility so we can query which PDFs would be served by Rust.
    // Search logs for "rust_pdf_eligible":true to find candidates.
    logger.info("Rust PDF eligibility", {
      rust_pdf_eligible: eligible,
      reason: ineligibleReason ?? "eligible",
      url: meta.rewrittenUrl ?? meta.url,
      pdfType: result.pdfType,
      isComplex: result.isComplex,
      pageCount: result.pageCount,
      confidence: result.confidence,
    });

    if (!eligible || config.PDF_RUST_EXTRACT_DISABLE) {
      if (eligible && config.PDF_RUST_EXTRACT_DISABLE) {
        logger.info(
          "Rust PDF eligible but disabled via PDF_RUST_EXTRACT_DISABLE",
          {
            url: meta.rewrittenUrl ?? meta.url,
          },
        );
      }
      return {
        content: null,
        pageCount: result.pageCount,
        title: result.title,
      };
    }

    if (!result.markdown) {
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
