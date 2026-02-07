import { Meta } from "../..";
import { config } from "../../../../config";
import { EngineScrapeResult } from "..";
import * as marked from "marked";
import { robustFetch } from "../../lib/fetch";
import { z } from "zod";
import * as Sentry from "@sentry/node";
import escapeHtml from "escape-html";
import PdfParse from "pdf-parse";
import { downloadFile, fetchFileToBuffer } from "../utils/downloadFile";
import {
  PDFAntibotError,
  PDFInsufficientTimeError,
  PDFPrefetchFailed,
  RemoveFeatureError,
  EngineUnsuccessfulError,
} from "../../error";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Response } from "undici";
import {
  getPdfResultFromCache,
  savePdfResultToCache,
} from "../../../../lib/gcs-pdf-cache";
import { AbortManagerThrownError } from "../../lib/abortManager";
import {
  shouldParsePDF,
  getPDFMaxPages,
} from "../../../../controllers/v2/types";
import {
  getPdfMetadata,
  detectPdfType,
  extractPdfToMarkdown,
} from "@mendable/firecrawl-rs";

type PDFProcessorResult = { html: string; markdown?: string };

const MAX_FILE_SIZE = 19 * 1024 * 1024; // 19MB
const MILLISECONDS_PER_PAGE = 150;

async function scrapePDFWithRunPodMU(
  meta: Meta,
  tempFilePath: string,
  base64Content: string,
  maxPages?: number,
): Promise<PDFProcessorResult> {
  meta.logger.debug("Processing PDF document with RunPod MU", {
    tempFilePath,
  });

  if (!maxPages) {
    try {
      const cachedResult = await getPdfResultFromCache(base64Content);
      if (cachedResult) {
        meta.logger.info("Using cached RunPod MU result for PDF", {
          tempFilePath,
        });
        return cachedResult;
      }
    } catch (error) {
      meta.logger.warn("Error checking PDF cache, proceeding with RunPod MU", {
        error,
        tempFilePath,
      });
    }
  }

  meta.abort.throwIfAborted();

  meta.logger.info("Max Pdf pages", {
    tempFilePath,
    maxPages,
  });

  if (
    config.PDF_MU_V2_EXPERIMENT === "true" &&
    config.PDF_MU_V2_BASE_URL &&
    Math.random() * 100 < config.PDF_MU_V2_EXPERIMENT_PERCENT
  ) {
    (async () => {
      const pdfParseId = crypto.randomUUID();
      const startedAt = Date.now();
      const logger = meta.logger.child({ method: "scrapePDF/MUv2Experiment" });
      logger.info("MU v2 experiment started", {
        scrapeId: meta.id,
        pdfParseId,
        url: meta.rewrittenUrl ?? meta.url,
        maxPages,
      });
      try {
        const resp = await robustFetch({
          url: config.PDF_MU_V2_BASE_URL ?? "",
          method: "POST",
          headers: config.PDF_MU_V2_API_KEY
            ? { Authorization: `Bearer ${config.PDF_MU_V2_API_KEY}` }
            : undefined,
          body: {
            input: {
              file_content: base64Content,
              filename: path.basename(tempFilePath) + ".pdf",
              timeout: meta.abort.scrapeTimeout(),
              created_at: Date.now(),
              id: pdfParseId,
              ...(maxPages !== undefined && { max_pages: maxPages }),
            },
          },
          logger,
          schema: z.any(),
          mock: meta.mock,
          abort: meta.abort.asSignal(),
        });
        const body: any = resp as any;
        const tokensIn = body?.metadata?.["total-input-tokens"];
        const tokensOut = body?.metadata?.["total-output-tokens"];
        const pages = body?.metadata?.["pdf-total-pages"];
        const durationMs = Date.now() - startedAt;
        logger.info("MU v2 experiment completed", {
          durationMs,
          url: meta.rewrittenUrl ?? meta.url,
          tokensIn,
          tokensOut,
          pages,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        logger.warn("MU v2 experiment failed", { error, durationMs });
      }
    })();
  }

  const muV1StartedAt = Date.now();
  const podStart = await robustFetch({
    url: "https://api.runpod.ai/v2/" + config.RUNPOD_MU_POD_ID + "/runsync",
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RUNPOD_MU_API_KEY}`,
    },
    body: {
      input: {
        file_content: base64Content,
        filename: path.basename(tempFilePath) + ".pdf",
        timeout: meta.abort.scrapeTimeout(),
        created_at: Date.now(),
        ...(maxPages !== undefined && { max_pages: maxPages }),
      },
    },
    logger: meta.logger.child({
      method: "scrapePDFWithRunPodMU/runsync/robustFetch",
    }),
    schema: z.object({
      id: z.string(),
      status: z.string(),
      output: z
        .object({
          markdown: z.string(),
        })
        .optional(),
    }),
    mock: meta.mock,
    abort: meta.abort.asSignal(),
  });

  let status: string = podStart.status;
  let result: { markdown: string } | undefined = podStart.output;

  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    do {
      meta.abort.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 2500));
      meta.abort.throwIfAborted();
      const podStatus = await robustFetch({
        url: `https://api.runpod.ai/v2/${config.RUNPOD_MU_POD_ID}/status/${podStart.id}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.RUNPOD_MU_API_KEY}`,
        },
        logger: meta.logger.child({
          method: "scrapePDFWithRunPodMU/status/robustFetch",
        }),
        schema: z.object({
          status: z.string(),
          output: z
            .object({
              markdown: z.string(),
            })
            .optional(),
        }),
        mock: meta.mock,
        abort: meta.abort.asSignal(),
      });
      status = podStatus.status;
      result = podStatus.output;
    } while (status !== "COMPLETED" && status !== "FAILED");
  }

  if (status === "FAILED") {
    const durationMs = Date.now() - muV1StartedAt;
    meta.logger.child({ method: "scrapePDF/MUv1" }).warn("MU v1 failed", {
      durationMs,
      url: meta.rewrittenUrl ?? meta.url,
    });
    throw new Error("RunPod MU failed to parse PDF");
  }

  if (!result) {
    const durationMs = Date.now() - muV1StartedAt;
    meta.logger.child({ method: "scrapePDF/MUv1" }).warn("MU v1 failed", {
      durationMs,
      url: meta.rewrittenUrl ?? meta.url,
    });
    throw new Error("RunPod MU returned no result");
  }

  const processorResult = {
    markdown: result.markdown,
    html: await marked.parse(result.markdown, { async: true }),
  };

  if (!meta.internalOptions.zeroDataRetention) {
    try {
      await savePdfResultToCache(base64Content, processorResult);
    } catch (error) {
      meta.logger.warn("Error saving PDF to cache", {
        error,
        tempFilePath,
      });
    }
  }

  {
    const durationMs = Date.now() - muV1StartedAt;
    meta.logger.child({ method: "scrapePDF/MUv1" }).info("MU v1 completed", {
      durationMs,
      url: meta.rewrittenUrl ?? meta.url,
    });
  }

  return processorResult;
}

async function scrapePDFWithParsePDF(
  meta: Meta,
  tempFilePath: string,
): Promise<PDFProcessorResult> {
  meta.logger.debug("Processing PDF document with parse-pdf", { tempFilePath });

  const result = await PdfParse(await readFile(tempFilePath));
  const escaped = escapeHtml(result.text);

  return {
    markdown: escaped,
    html: escaped,
  };
}

async function scrapePDFWithLocalExtraction(
  meta: Meta,
  tempFilePath: string,
): Promise<PDFProcessorResult> {
  meta.logger.debug("Processing PDF document with local Rust extraction", {
    tempFilePath,
  });

  const result = extractPdfToMarkdown(tempFilePath);

  meta.logger.debug("Local Rust extraction completed", {
    tempFilePath,
    markdownLength: result.markdown.length,
    pageCount: result.pageCount,
  });

  const html = await marked.parse(result.markdown, { async: true });

  return {
    markdown: result.markdown,
    html,
  };
}

export async function scrapePDF(meta: Meta): Promise<EngineScrapeResult> {
  console.log("🔥 Scraping PDF", meta.options.parsers);
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

  const startDownload = Date.now();
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
  console.log("🔥 Download duration", Date.now() - startDownload);

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

    const startMetadata = Date.now();
    const pdfMetadata = await getPdfMetadata(tempFilePath);
    console.log("🔥 PDF metadata duration", Date.now() - startMetadata);

    const effectivePageCount = maxPages
      ? Math.min(pdfMetadata.numPages, maxPages)
      : pdfMetadata.numPages;

    if (
      effectivePageCount * MILLISECONDS_PER_PAGE >
      (meta.abort.scrapeTimeout() ?? Infinity)
    ) {
      throw new PDFInsufficientTimeError(
        effectivePageCount,
        effectivePageCount * MILLISECONDS_PER_PAGE + 5000,
      );
    }

    let result: PDFProcessorResult | null = null;

    const start = Date.now();

    // Detect PDF type to determine processing strategy
    const pdfTypeResult = detectPdfType(tempFilePath);
    const pdfDetectionData = {
      pdfType: pdfTypeResult.pdfType,
      confidence: pdfTypeResult.confidence,
      pagesWithText: pdfTypeResult.pagesWithText,
      pagesSampled: pdfTypeResult.pagesSampled,
      pageCount: pdfTypeResult.pageCount,
      url: meta.rewrittenUrl ?? meta.url,
    };

    const duration = Date.now() - start;
    console.log("🔥 PDF type detection duration", duration);

    meta.logger
      .child({ method: "scrapePDF/detectPdfType" })
      .info("PDF type detection completed", pdfDetectionData);

    // Track which extraction method will be used
    const useLocalExtraction =
      pdfTypeResult.pdfType === "text" && pdfTypeResult.confidence >= 0.8;
    let extractionMethod: "local" | "runpod-mu" | "pdf-parse" =
      useLocalExtraction ? "local" : "runpod-mu";

    // For text-based PDFs, use fast local extraction (no GPU needed)
    if (useLocalExtraction) {
      const localStartedAt = Date.now();
      try {
        result = await scrapePDFWithLocalExtraction(
          {
            ...meta,
            logger: meta.logger.child({
              method: "scrapePDF/scrapePDFWithLocalExtraction",
            }),
          },
          tempFilePath,
        );
        const localDurationMs = Date.now() - localStartedAt;
        const duration = Date.now() - start;
        console.log("🔥 Local PDF extraction duration", duration);
        meta.logger
          .child({ method: "scrapePDF/scrapePDFWithLocalExtraction" })
          .info("Local PDF extraction completed", {
            durationMs: localDurationMs,
            url: meta.rewrittenUrl ?? meta.url,
            pages: effectivePageCount,
            pdfType: pdfTypeResult.pdfType,
            confidence: pdfTypeResult.confidence,
            markdownLength: result.markdown?.length ?? 0,
          });
      } catch (error) {
        const localDurationMs = Date.now() - localStartedAt;
        extractionMethod = "runpod-mu"; // Will fall back

        meta.logger
          .child({ method: "scrapePDF/scrapePDFWithLocalExtraction" })
          .warn("Local PDF extraction failed -- falling back to RunPod MU", {
            error,
            durationMs: localDurationMs,
            url: meta.rewrittenUrl ?? meta.url,
            pdfType: pdfTypeResult.pdfType,
            confidence: pdfTypeResult.confidence,
          });

        // Capture to Sentry for monitoring local extraction failures
        Sentry.captureException(error, {
          tags: {
            pdfExtractionMethod: "local",
            pdfType: pdfTypeResult.pdfType,
          },
          extra: {
            url: meta.rewrittenUrl ?? meta.url,
            confidence: pdfTypeResult.confidence,
            pageCount: effectivePageCount,
          },
        });
        // result stays null, will fall through to RunPod MU
      }
    }

    // Try RunPod MU for scanned/image/mixed PDFs or if local extraction failed
    if (!result && config.RUNPOD_MU_API_KEY && config.RUNPOD_MU_POD_ID) {
      // Only read and encode file when we actually need MinerU
      const base64Content = (await readFile(tempFilePath)).toString("base64");

      if (base64Content.length >= MAX_FILE_SIZE) {
        meta.logger.warn(
          "PDF too large for RunPod MU, falling back to pdf-parse",
          {
            size: base64Content.length,
            maxSize: MAX_FILE_SIZE,
          },
        );
      } else {
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
            .child({ method: "scrapePDF/scrapePDFWithRunPodMU" })
            .info("RunPod MU extraction completed", {
              durationMs: muV1DurationMs,
              url: meta.rewrittenUrl ?? meta.url,
              pages: effectivePageCount,
              pdfType: pdfTypeResult.pdfType,
              markdownLength: result.markdown?.length ?? 0,
            });
        } catch (error) {
          if (
            error instanceof RemoveFeatureError ||
            error instanceof AbortManagerThrownError
          ) {
            throw error;
          }
          extractionMethod = "pdf-parse"; // Will fall back
          const muV1DurationMs = Date.now() - muV1StartedAt;

          meta.logger
            .child({ method: "scrapePDF/scrapePDFWithRunPodMU" })
            .warn("RunPod MU failed -- falling back to pdf-parse", {
              error,
              durationMs: muV1DurationMs,
              url: meta.rewrittenUrl ?? meta.url,
              pdfType: pdfTypeResult.pdfType,
            });

          Sentry.captureException(error, {
            tags: {
              pdfExtractionMethod: "runpod-mu",
              pdfType: pdfTypeResult.pdfType,
            },
            extra: {
              url: meta.rewrittenUrl ?? meta.url,
              pageCount: effectivePageCount,
            },
          });

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
    }

    // If RunPod MU failed or wasn't attempted, use PdfParse
    if (!result) {
      extractionMethod = "pdf-parse";

      result = await scrapePDFWithParsePDF(
        {
          ...meta,
          logger: meta.logger.child({
            method: "scrapePDF/scrapePDFWithParsePDF",
          }),
        },
        tempFilePath,
      );

      meta.logger
        .child({ method: "scrapePDF/scrapePDFWithParsePDF" })
        .info("pdf-parse extraction completed", {
          url: meta.rewrittenUrl ?? meta.url,
          pages: effectivePageCount,
          pdfType: pdfTypeResult.pdfType,
          markdownLength: result.markdown?.length ?? 0,
        });
    }

    // Final summary log for monitoring and analytics
    meta.logger
      .child({ method: "scrapePDF" })
      .info("PDF processing completed", {
        url: meta.rewrittenUrl ?? meta.url,
        extractionMethod,
        pdfType: pdfTypeResult.pdfType,
        confidence: pdfTypeResult.confidence,
        pages: effectivePageCount,
        markdownLength: result?.markdown?.length ?? 0,
      });

    return {
      url: response.url ?? meta.rewrittenUrl ?? meta.url,
      statusCode: response.status,
      html: result?.html ?? "",
      markdown: result?.markdown ?? "",
      pdfMetadata: {
        // Rust parser gets the metadata incorrectly, so we overwrite the page count here with the effective page count
        // TODO: fix this later
        numPages: effectivePageCount,
        title: pdfMetadata.title,
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
