export interface PDFExtractionRequest {
  pdfUrl: string;
  schema: Record<string, any>;
  prompt?: string;
}

export interface ExtractionResult {
  url: string;
  extractedData: Record<string, any>;
  urlContextMetadata?: any;
  timestamp: string;
}

export interface PDFExtractionResponse {
  success: boolean;
  data?: ExtractionResult;
  error?: string;
}
