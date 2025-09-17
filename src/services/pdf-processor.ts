import { GoogleGenAI } from '@google/genai';
import { PDFExtractionRequest, ExtractionResult } from '../types/pdf-extraction';
import dotenv from 'dotenv';

dotenv.config();

let genAI: GoogleGenAI | null = null;

function getGenAI() {
  if (!genAI) {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (process.env.GOOGLE_API_KEY && process.env.GEMINI_API_KEY) {
      console.log('Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.');
    }
    genAI = new GoogleGenAI({
      apiKey: apiKey,
    });
  }
  return genAI;
}

export async function extractFromPDF(request: PDFExtractionRequest): Promise<ExtractionResult> {
  const ai = getGenAI();
  
  // Build the prompt based on schema and custom prompt
  const schemaDescription = JSON.stringify(request.schema, null, 2);
  
  const systemPrompt = request.prompt || 
    `Extract information from the PDF document according to the following schema.
     Return the data as a valid JSON object that matches the schema structure.
     If a field cannot be found or is not applicable, use null for that field.`;
  
  const fullPrompt = `${systemPrompt}
  
  PDF URL: ${request.pdfUrl}
  
  Expected Schema:
  ${schemaDescription}
  
  IMPORTANT: Return only the JSON object with extracted data, no other text or explanation.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [fullPrompt],
      config: {
        tools: [{ urlContext: {} }],
      },
    });

    // Extract the JSON from the response
    let extractedData = {};
    const responseText = response.text || '';
    
    try {
      // Try to parse the response as JSON
      // First, try to find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, try parsing the entire response
        extractedData = JSON.parse(responseText);
      }
    } catch (parseError) {
      console.error('Failed to parse response as JSON:', parseError);
      // Return the raw text if JSON parsing fails
      extractedData = { rawResponse: responseText };
    }

    return {
      url: request.pdfUrl,
      extractedData,
      urlContextMetadata: response.candidates?.[0]?.urlContextMetadata,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error extracting from PDF:', error);
    throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}