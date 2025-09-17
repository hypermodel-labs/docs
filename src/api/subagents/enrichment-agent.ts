import { Anthropic } from '@anthropic-ai/sdk';
import axios from 'axios';
import type { EnrichmentResult } from '../data-query/types';

export class EnrichmentAgent {
  private anthropic: Anthropic;
  private enrichmentAPIs: Map<string, EnrichmentProvider>;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.enrichmentAPIs = new Map([
      ['linkedin', new LinkedInEnrichment()],
      ['email', new EmailEnrichment()],
      ['company', new CompanyEnrichment()],
      ['phone', new PhoneEnrichment()],
    ]);
  }

  async enrichData(
    data: Record<string, any>,
    enrichmentFields: string[]
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();
    const enrichedData = { ...data };

    for (const field of enrichmentFields) {
      const provider = this.getProviderForField(field);
      if (provider) {
        try {
          const enrichedValue = await provider.enrich(data, field);
          if (enrichedValue) {
            enrichedData[field] = enrichedValue;
          }
        } catch (error) {
          console.error(`Failed to enrich field ${field}:`, error);
        }
      }
    }

    const aiEnrichment = await this.performAIEnrichment(enrichedData, enrichmentFields);
    Object.assign(enrichedData, aiEnrichment);

    return {
      originalData: data,
      enrichedData,
      metadata: {
        source: 'multi-source-enrichment',
        confidence: this.calculateConfidence(data, enrichedData),
        timestamp: Date.now(),
      },
    };
  }

  private getProviderForField(field: string): EnrichmentProvider | undefined {
    if (field.toLowerCase().includes('linkedin')) return this.enrichmentAPIs.get('linkedin');
    if (field.toLowerCase().includes('email')) return this.enrichmentAPIs.get('email');
    if (field.toLowerCase().includes('phone')) return this.enrichmentAPIs.get('phone');
    if (field.toLowerCase().includes('company')) return this.enrichmentAPIs.get('company');
    return undefined;
  }

  private async performAIEnrichment(
    data: Record<string, any>,
    fields: string[]
  ): Promise<Record<string, any>> {
    const missingFields = fields.filter(field => !data[field] || data[field] === null);
    
    if (missingFields.length === 0) return {};

    const prompt = `Based on the following data, infer or find the missing fields:

Current data:
${JSON.stringify(data, null, 2)}

Missing fields needed:
${missingFields.join(', ')}

Return only the missing fields as a JSON object. Use null if you cannot determine a value.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch (error) {
      console.error('AI enrichment failed:', error);
    }

    return {};
  }

  private calculateConfidence(original: Record<string, any>, enriched: Record<string, any>): number {
    const totalFields = Object.keys(enriched).length;
    const enrichedFields = Object.keys(enriched).filter(
      key => enriched[key] !== null && enriched[key] !== original[key]
    ).length;

    return totalFields > 0 ? enrichedFields / totalFields : 0;
  }
}

abstract class EnrichmentProvider {
  abstract enrich(data: Record<string, any>, field: string): Promise<any>;
}

class LinkedInEnrichment extends EnrichmentProvider {
  async enrich(data: Record<string, any>, field: string): Promise<string | null> {
    if (data.email || data.name) {
      return `https://linkedin.com/in/${(data.name || data.email).toLowerCase().replace(/\s+/g, '-')}`;
    }
    return null;
  }
}

class EmailEnrichment extends EnrichmentProvider {
  async enrich(data: Record<string, any>, field: string): Promise<string | null> {
    if (data.name && data.domain) {
      const firstName = data.name.split(' ')[0].toLowerCase();
      const lastName = data.name.split(' ').pop()?.toLowerCase() || '';
      return `${firstName}.${lastName}@${data.domain}`;
    }
    return null;
  }
}

class CompanyEnrichment extends EnrichmentProvider {
  async enrich(data: Record<string, any>, field: string): Promise<any> {
    if (!data.domain) return null;

    try {
      const response = await axios.get(`https://company.clearbit.com/v2/companies/find?domain=${data.domain}`, {
        headers: {
          'Authorization': `Bearer ${process.env.CLEARBIT_API_KEY}`,
        },
        timeout: 5000,
      }).catch(() => null);

      if (response?.data) {
        return {
          name: response.data.name,
          description: response.data.description,
          industry: response.data.category?.industry,
          employees: response.data.metrics?.employees,
          founded: response.data.foundedYear,
        };
      }
    } catch (error) {
      console.error('Company enrichment failed:', error);
    }

    return null;
  }
}

class PhoneEnrichment extends EnrichmentProvider {
  async enrich(data: Record<string, any>, field: string): Promise<string | null> {
    return null;
  }
}