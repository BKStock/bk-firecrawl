use napi::bindgen_prelude::*;
use napi_derive::napi;
use pdf_inspector::{PdfType, process_pdf as rust_process_pdf};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct PDFMetadata {
  pub num_pages: i32,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
}

#[napi(object)]
pub struct PdfProcessResult {
  pub pdf_type: String,
  pub markdown: Option<String>,
  pub page_count: i32,
  pub processing_time_ms: f64,
  pub pages_needing_ocr: Vec<i32>,
  pub title: Option<String>,
  pub confidence: f64,
}

fn pdf_type_str(t: PdfType) -> &'static str {
  match t {
    PdfType::TextBased => "TextBased",
    PdfType::Scanned => "Scanned",
    PdfType::ImageBased => "ImageBased",
    PdfType::Mixed => "Mixed",
  }
}

fn _get_pdf_metadata(path: &str) -> std::result::Result<PDFMetadata, String> {
  let detection = pdf_inspector::detect_pdf_type(path)
    .map_err(|e| format!("Failed to detect PDF type: {}", e))?;

  Ok(PDFMetadata {
    num_pages: detection.page_count as i32,
    title: detection.title,
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

/// Process a PDF file: detect type, extract text + markdown if text-based.
#[napi]
pub fn process_pdf(path: String) -> Result<PdfProcessResult> {
  let result = rust_process_pdf(&path).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to process PDF: {e}"),
    )
  })?;

  Ok(PdfProcessResult {
    pdf_type: pdf_type_str(result.pdf_type).to_string(),
    markdown: result.markdown,
    page_count: result.page_count as i32,
    processing_time_ms: result.processing_time_ms as f64,
    pages_needing_ocr: result.pages_needing_ocr.iter().map(|&p| p as i32).collect(),
    title: result.title,
    confidence: result.confidence as f64,
  })
}
