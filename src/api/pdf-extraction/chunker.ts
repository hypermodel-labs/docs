import type { PDFChunk } from './types';

export class PDFChunker {
  private chunkSize: number;
  private overlap: number;
  private maxChunks: number;

  constructor(chunkSize = 2000, overlap = 200, maxChunks = 20) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
    this.maxChunks = maxChunks;
  }

  chunkText(text: string, pageBreaks?: number[]): PDFChunk[] {
    const chunks: PDFChunk[] = [];
    let currentPosition = 0;
    let chunkIndex = 0;

    while (currentPosition < text.length && chunkIndex < this.maxChunks) {
      const endPosition = Math.min(currentPosition + this.chunkSize, text.length);
      const chunkText = text.slice(currentPosition, endPosition);

      const pageNumbers = this.getPageNumbers(currentPosition, endPosition, pageBreaks);

      chunks.push({
        text: chunkText,
        pageNumbers,
        chunkIndex,
      });

      currentPosition += this.chunkSize - this.overlap;
      chunkIndex++;

      if (currentPosition >= text.length) break;
    }

    return chunks;
  }

  private getPageNumbers(start: number, end: number, pageBreaks?: number[]): number[] {
    if (!pageBreaks || pageBreaks.length === 0) {
      return [1];
    }

    const pages = new Set<number>();
    let currentPage = 1;

    for (let i = 0; i < pageBreaks.length; i++) {
      if (pageBreaks[i] > end) break;
      if (pageBreaks[i] > start) {
        pages.add(currentPage);
        currentPage++;
      } else {
        currentPage++;
      }
    }

    pages.add(currentPage);
    return Array.from(pages);
  }

  combineChunks(chunks: PDFChunk[]): string {
    return chunks.map(chunk => chunk.text).join('\n\n');
  }
}