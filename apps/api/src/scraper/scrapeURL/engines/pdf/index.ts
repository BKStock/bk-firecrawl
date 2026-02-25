import { Meta } from "../..";
import { config } from "../../../../config";
import { EngineScrapeResult } from "..";
import * as Sentry from "@sentry/node";
import * as marked from "marked";
import { downloadFile, fetchFileToBuffer } from "../utils/downloadFile";
import {
  PDFAntibotError,
  PDFInsufficientTimeError,
  PDFPrefetchFailed,
  RemoveFeatureError,
  EngineUnsuccessfulError,
} from "../../error";
import { readFile, unlink } from "node:fs/promises";
import type { Response } from "undici";
import { AbortManagerThrownError } from "../../lib/abortManager";
import {
  shouldParsePDF,
  getPDFMaxPages,
} from "../../../../controllers/v2/types";
import { processPdf } from "@mendable/firecrawl-rs";
import { MAX_FILE_SIZE, MILLISECONDS_PER_PAGE } from "./types";
import type { PDFProcessorResult } from "./types";
import { scrapePDFWithRunPodMU } from "./runpodMU";
import { scrapePDFWithParsePDF } from "./pdfParse";

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

export async function scrapePDF(meta: Meta): Promise<EngineScrapeResult> {
  const shouldParse = shouldParsePDF(meta.options.parsers);
  const maxPages = getPDFMaxPages(meta.options.parsers);

  if (!shouldParse) {
    if (meta.pdfPrefetch !== undefined && meta.pdfPrefetch !== null) {
      const content = (await readFile(meta.pdfPrefetch.filePath)).toString(
        "base64",
      );
      return {
        url: meta.pdfPrefetch.url ?? meta.rewrittenUrl ?? meta.url,
        statusCode: meta.pdfPrefetch.status,

        html: content,
        markdown: content,

        proxyUsed: meta.pdfPrefetch.proxyUsed,
      };
    } else {
      const file = await fetchFileToBuffer(
        meta.rewrittenUrl ?? meta.url,
        meta.options.skipTlsVerification,
        {
          headers: meta.options.headers,
          signal: meta.abort.asSignal(),
        },
      );

      const ct = file.response.headers.get("Content-Type");
      if (ct && !ct.includes("application/pdf")) {
        // if downloaded file wasn't a PDF
        if (meta.pdfPrefetch === undefined) {
          // for non-PDF URLs, this is expected, not anti-bot
          if (!meta.featureFlags.has("pdf")) {
            throw new EngineUnsuccessfulError("pdf");
          } else {
            throw new PDFAntibotError();
          }
        } else {
          throw new PDFPrefetchFailed();
        }
      }

      const content = file.buffer.toString("base64");
      return {
        url: file.response.url,
        statusCode: file.response.status,

        html: content,
        markdown: content,

        proxyUsed: "basic",
      };
    }
  }

  const { response, tempFilePath } =
    meta.pdfPrefetch !== undefined && meta.pdfPrefetch !== null
      ? { response: meta.pdfPrefetch, tempFilePath: meta.pdfPrefetch.filePath }
      : await downloadFile(
          meta.id,
          meta.rewrittenUrl ?? meta.url,
          meta.options.skipTlsVerification,
          {
            headers: meta.options.headers,
            signal: meta.abort.asSignal(),
          },
        );

  try {
    if ((response as any).headers) {
      // if downloadFile was used
      const r: Response = response as any;
      const ct = r.headers.get("Content-Type");
      if (ct && !ct.includes("application/pdf")) {
        // if downloaded file wasn't a PDF
        if (meta.pdfPrefetch === undefined) {
          // for non-PDF URLs, this is expected, not anti-bot
          if (!meta.featureFlags.has("pdf")) {
            throw new EngineUnsuccessfulError("pdf");
          } else {
            throw new PDFAntibotError();
          }
        } else {
          throw new PDFPrefetchFailed();
        }
      }
    }

    let result: PDFProcessorResult | null = null;
    let effectivePageCount: number = 0;
    let metadataTitle: string | undefined;

    // 1. Always call processPdf to get type, complexity, metadata, and markdown
    const logger = meta.logger.child({ method: "scrapePDF/processPdf" });
    try {
      const startedAt = Date.now();
      const pdfResult = processPdf(tempFilePath);
      const durationMs = Date.now() - startedAt;

      logger.info("processPdf completed", {
        durationMs,
        pdfType: pdfResult.pdfType,
        pageCount: pdfResult.pageCount,
        confidence: pdfResult.confidence,
        isComplex: pdfResult.isComplex,
        markdownLength: pdfResult.markdown?.length ?? 0,
        url: meta.rewrittenUrl ?? meta.url,
      });

      effectivePageCount = maxPages
        ? Math.min(pdfResult.pageCount, maxPages)
        : pdfResult.pageCount;
      metadataTitle = pdfResult.title ?? undefined;

      // 2. Check eligibility for Rust-extracted markdown
      const ineligibleReason = getIneligibleReason(pdfResult);
      const eligible = !ineligibleReason;

      logger.info("Rust PDF eligibility", {
        rust_pdf_eligible: eligible,
        reason: ineligibleReason ?? "eligible",
        url: meta.rewrittenUrl ?? meta.url,
        pdfType: pdfResult.pdfType,
        isComplex: pdfResult.isComplex,
        pageCount: pdfResult.pageCount,
        confidence: pdfResult.confidence,
      });

      console.log("pdfResult", ineligibleReason);

      console.log("pdfResult.markdown", pdfResult.markdown);

      if (eligible && config.PDF_RUST_EXTRACT_ENABLE && pdfResult.markdown) {
        const html = await marked.parse(pdfResult.markdown, { async: true });
        result = { markdown: pdfResult.markdown, html };
      } else if (eligible && !config.PDF_RUST_EXTRACT_ENABLE) {
        logger.info(
          "Rust PDF eligible but not enabled (set PDF_RUST_EXTRACT_ENABLE=true to use)",
          { url: meta.rewrittenUrl ?? meta.url },
        );
      }
    } catch (error) {
      logger.warn("processPdf failed, falling back to MU/PdfParse", {
        error,
        url: meta.rewrittenUrl ?? meta.url,
      });
      Sentry.captureException(error);
      // effectivePageCount stays 0 — skip time budget check
    }

    // Only enforce the per-page time budget when we need MU/fallback.
    // Rust extraction is fast enough that the constraint doesn't apply.
    if (
      !result &&
      effectivePageCount > 0 &&
      effectivePageCount * MILLISECONDS_PER_PAGE >
        (meta.abort.scrapeTimeout() ?? Infinity)
    ) {
      throw new PDFInsufficientTimeError(
        effectivePageCount,
        effectivePageCount * MILLISECONDS_PER_PAGE + 5000,
      );
    }

    // 3. Only read base64 + call MU if Rust didn't produce a final result
    if (!result) {
      const base64Content = (await readFile(tempFilePath)).toString("base64");

      if (
        base64Content.length < MAX_FILE_SIZE &&
        config.RUNPOD_MU_API_KEY &&
        config.RUNPOD_MU_POD_ID
      ) {
        const muV1StartedAt = Date.now();
        try {
          result = await scrapePDFWithRunPodMU(
            {
              ...meta,
              logger: meta.logger.child({
                method: "scrapePDF/scrapePDFWithRunPodMU",
              }),
            },
            tempFilePath,
            base64Content,
            maxPages,
          );
          const muV1DurationMs = Date.now() - muV1StartedAt;
          meta.logger
            .child({ method: "scrapePDF/MUv1Experiment" })
            .info("MU v1 completed", {
              durationMs: muV1DurationMs,
              url: meta.rewrittenUrl ?? meta.url,
              pages: effectivePageCount,
              success: true,
            });
        } catch (error) {
          if (
            error instanceof RemoveFeatureError ||
            error instanceof AbortManagerThrownError
          ) {
            throw error;
          }
          meta.logger.warn(
            "RunPod MU failed to parse PDF (could be due to timeout) -- falling back to parse-pdf",
            { error },
          );
          Sentry.captureException(error);
          const muV1DurationMs = Date.now() - muV1StartedAt;
          meta.logger
            .child({ method: "scrapePDF/MUv1Experiment" })
            .info("MU v1 failed", {
              durationMs: muV1DurationMs,
              url: meta.rewrittenUrl ?? meta.url,
              pages: effectivePageCount,
              success: false,
            });
        }
      }

      // If RunPod MU failed or wasn't attempted, use PdfParse
      if (!result) {
        result = await scrapePDFWithParsePDF(
          {
            ...meta,
            logger: meta.logger.child({
              method: "scrapePDF/scrapePDFWithParsePDF",
            }),
          },
          tempFilePath,
        );
      }
    }

    return {
      url: response.url ?? meta.rewrittenUrl ?? meta.url,
      statusCode: response.status,
      html: result?.html ?? "",
      markdown: result?.markdown ?? "",
      pdfMetadata: {
        numPages: effectivePageCount,
        title: metadataTitle,
      },

      proxyUsed: "basic",
    };
  } finally {
    // Always clean up temp file after we're done with it
    try {
      await unlink(tempFilePath);
    } catch (error) {
      // Ignore errors when cleaning up temp files
      meta.logger?.warn("Failed to clean up temporary PDF file", {
        error,
        tempFilePath,
      });
    }
  }
}

export function pdfMaxReasonableTime(meta: Meta): number {
  return 120000; // Infinity, really
}
