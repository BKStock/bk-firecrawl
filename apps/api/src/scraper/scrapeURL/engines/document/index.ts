import { Meta } from "../..";
import { EngineScrapeResult } from "..";
import { fetchFileToBuffer } from "../utils/downloadFile";
import { DocumentConverter, DocumentType } from "@mendable/firecrawl-rs";

const converter = new DocumentConverter();

function getDocumentTypeFromUrl(url: string): DocumentType {
  const urlLower = url.toLowerCase();
  if (urlLower.endsWith(".docx")) return DocumentType.Docx;
  if (urlLower.endsWith(".odt")) return DocumentType.Odt;
  if (urlLower.endsWith(".rtf")) return DocumentType.Rtf;

  return DocumentType.Docx; // hope for the best
}

export async function scrapeDocument(meta: Meta): Promise<EngineScrapeResult> {
  const { response, buffer } = await fetchFileToBuffer(
    meta.rewrittenUrl ?? meta.url,
    {
      headers: meta.options.headers,
      signal: meta.abort.asSignal(),
    },
  );

  const documentType = getDocumentTypeFromUrl(response.url);
  const html = await converter.convertBufferToHtml(
    new Uint8Array(buffer),
    documentType,
  );

  return {
    url: response.url,
    statusCode: response.status,
    html,
    proxyUsed: "basic",
  };
}

export function documentMaxReasonableTime(meta: Meta): number {
  return 15000;
}
