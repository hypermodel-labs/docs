import axios from 'axios';
import pdfParse from 'pdf-parse';
import { OpenAI } from 'openai';
import { PDFChunker } from './chunker';
import type { PDFExtractionRequest, PDFExtractionResponse, PDFChunk } from './types';

export class PDFExtractor {
  private openai: OpenAI;
  private chunker: PDFChunker;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.chunker = new PDFChunker();
  }

  async extractFromURL(request: PDFExtractionRequest): Promise<PDFExtractionResponse> {
    const startTime = Date.now();

    const pdfBuffer = await this.downloadPDF(request.pdfUrl);

    const pdfData = await pdfParse(pdfBuffer);

    const options = request.options || {};
    this.chunker = new PDFChunker(options.chunkSize, options.overlap, options.maxChunks);

    const chunks = this.chunker.chunkText(pdfData.text);

    const extractedData = await this.extractDataFromChunks(chunks, request.schema);

    return {
      data: extractedData,
      metadata: {
        pdfUrl: request.pdfUrl,
        totalPages: pdfData.numpages,
        chunksProcessed: chunks.length,
        extractionTime: Date.now() - startTime,
      },
    };
  }

  private async downloadPDF(url: string): Promise<Buffer> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
      });

      return Buffer.from(response.data);
    } catch (error) {
      throw new Error(`Failed to download PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractDataFromChunks(chunks: PDFChunk[], schema: Record<string, any>): Promise<any> {
    const extractionPromises = chunks.map(chunk => this.extractFromChunk(chunk, schema));

    const results = await Promise.allSettled(extractionPromises);

    const successfulExtractions = results
      .filter(result => result.status === 'fulfilled')
      .map(result => (result as PromiseFulfilledResult<any>).value)
      .filter(data => data !== null);

    return this.mergeExtractedData(successfulExtractions, schema);
  }

  private async extractFromChunk(chunk: PDFChunk, schema: Record<string, any>): Promise<any> {
    try {
      const systemPrompt = `You are a data extraction specialist. Extract information from the provided text according to the given schema. 
Return the data as a valid JSON object matching the schema structure. 
If a field cannot be found in the text, use null for that field.`;

      const userPrompt = `Extract data from this text according to the following schema:
      
Schema:
${JSON.stringify(schema, null, 2)}

Text:
${chunk.text}

Return only the JSON object with the extracted data.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0].message.content;
      if (!content) return null;

      return JSON.parse(content);
    } catch (error) {
      console.error(`Error extracting from chunk ${chunk.chunkIndex}:`, error);
      return null;
    }
  }

  private mergeExtractedData(
    dataArray: any[],
    schema: Record<string, any>
  ): Record<string, any> {
    if (dataArray.length === 0) return {};

    const merged: Record<string, any> = {};

    for (const key in schema) {
      const values = dataArray
        .map(data => data[key])
        .filter(value => value !== null && value !== undefined);

      if (values.length === 0) {
        merged[key] = null;
      } else if (Array.isArray(schema[key])) {
        merged[key] = [...new Set(values.flat())];
      } else if (typeof schema[key] === 'object' && schema[key] !== null) {
        merged[key] = this.mergeExtractedData(values, schema[key]);
      } else {
        merged[key] = values[0];
      }
    }

    return merged;
  }
}