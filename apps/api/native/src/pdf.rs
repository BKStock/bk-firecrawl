use log::{debug, info, warn};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;
use std::sync::Once;
use std::time::Instant;

static INIT_LOGGER: Once = Once::new();

fn init_logger() {
    INIT_LOGGER.call_once(|| {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
            .try_init()
            .ok();
    });
}

// ============================================================================
// Existing types and functions
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct PDFMetadata {
  pub num_pages: i32,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
}

fn _get_pdf_metadata(path: &str) -> std::result::Result<PDFMetadata, String> {
  let metadata = match lopdf::Document::load_metadata(path) {
    Ok(m) => m,
    Err(e) => {
      return Err(format!("Failed to load PDF metadata: {}", e));
    }
  };

  Ok(PDFMetadata {
    num_pages: metadata.page_count as i32,
    title: metadata.title,
  })
}

/// Extract metadata from PDF file.
#[napi]
pub fn get_pdf_metadata(path: String) -> Result<PDFMetadata> {
  _get_pdf_metadata(&path).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to get PDF metadata: {e}"),
    )
  })
}

// ============================================================================
// PDF Inspector types and functions
// ============================================================================

/// Result of PDF type detection
#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct PdfTypeResult {
  /// "text" | "scanned" | "image" | "mixed"
  pub pdf_type: String,
  /// Total number of pages in the document
  pub page_count: i32,
  /// Number of pages that were sampled for detection
  pub pages_sampled: i32,
  /// Number of sampled pages that contain extractable text
  pub pages_with_text: i32,
  /// Confidence score (0.0 - 1.0)
  pub confidence: f64,
  /// Document title from metadata (if available)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
}

/// Result of markdown extraction
#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct PdfExtractionResult {
  /// The extracted markdown content
  pub markdown: String,
  /// Number of pages in the document
  pub page_count: i32,
}

fn pdf_type_to_string(pdf_type: pdf_inspector::PdfType) -> String {
  match pdf_type {
    pdf_inspector::PdfType::TextBased => "text".to_string(),
    pdf_inspector::PdfType::Scanned => "scanned".to_string(),
    pdf_inspector::PdfType::ImageBased => "image".to_string(),
    pdf_inspector::PdfType::Mixed => "mixed".to_string(),
  }
}

fn _detect_pdf_type(path: &str) -> std::result::Result<PdfTypeResult, String> {
  let start = Instant::now();
  debug!(target: "pdf_inspector", "detect_pdf_type: starting path={}", path);

  let result = pdf_inspector::detect_pdf_type(path).map_err(|e| {
    warn!(target: "pdf_inspector", "detect_pdf_type: failed path={} error={}", path, e);
    format!("{}", e)
  })?;

  let pdf_type = pdf_type_to_string(result.pdf_type);
  let elapsed_ms = start.elapsed().as_millis();

  info!(
    target: "pdf_inspector",
    "detect_pdf_type: completed path={} pdf_type={} confidence={:.2} pages={} pages_sampled={} pages_with_text={} duration_ms={}",
    path, pdf_type, result.confidence, result.page_count, result.pages_sampled, result.pages_with_text, elapsed_ms
  );

  Ok(PdfTypeResult {
    pdf_type,
    page_count: result.page_count as i32,
    pages_sampled: result.pages_sampled as i32,
    pages_with_text: result.pages_with_text as i32,
    confidence: result.confidence as f64,
    title: result.title,
  })
}

fn _extract_pdf_to_markdown(path: &str) -> std::result::Result<PdfExtractionResult, String> {
  let start = Instant::now();
  debug!(target: "pdf_inspector", "extract_pdf_to_markdown: starting path={}", path);

  let result = pdf_inspector::process_pdf(path).map_err(|e| {
    warn!(target: "pdf_inspector", "extract_pdf_to_markdown: failed path={} error={}", path, e);
    format!("{}", e)
  })?;

  let markdown = result.markdown.unwrap_or_default();
  let elapsed_ms = start.elapsed().as_millis();

  info!(
    target: "pdf_inspector",
    "extract_pdf_to_markdown: completed path={} pages={} markdown_len={} duration_ms={}",
    path, result.page_count, markdown.len(), elapsed_ms
  );

  Ok(PdfExtractionResult {
    markdown,
    page_count: result.page_count as i32,
  })
}

/// Detect PDF type (text/scanned/image/mixed).
///
/// This is a fast operation that samples a few pages to determine
/// whether the PDF contains extractable text or needs OCR.
///
/// Returns:
/// - "text": PDF has extractable text, use `extract_pdf_to_markdown`
/// - "scanned": PDF is scanned images, needs OCR
/// - "image": PDF is mostly images, needs OCR
/// - "mixed": PDF has both text and image pages
#[napi]
pub fn detect_pdf_type(path: String) -> Result<PdfTypeResult> {
  init_logger();
  _detect_pdf_type(&path).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to detect PDF type: {e}"),
    )
  })
}

/// Extract text from a PDF and convert to markdown.
///
/// This works best for text-based PDFs. For scanned or image-based PDFs,
/// use OCR instead.
///
/// Use `detect_pdf_type` first to check if the PDF is suitable for
/// direct text extraction.
#[napi]
pub fn extract_pdf_to_markdown(path: String) -> Result<PdfExtractionResult> {
  init_logger();
  _extract_pdf_to_markdown(&path).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to extract PDF to markdown: {e}"),
    )
  })
}
