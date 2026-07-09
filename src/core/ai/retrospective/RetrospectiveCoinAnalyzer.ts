import type { AiDecisionInput, AiDecisionOutput } from '../AiTakeoverTypes';

export interface RetrospectiveResult {
  verdict: 'CONFIRM' | 'BLOCK' | 'REDUCE';
  reason: string;
  adjustedConfidenceScore: number;
  warnings: string[];
}

export class RetrospectiveCoinAnalyzer {
  analyze(input: AiDecisionInput, output: AiDecisionOutput): RetrospectiveResult {
    const warnings: string[] = [];
    let adjustedConfidence = output.confidenceScore;

    if (output.action === 'BUY') {
      if (input.change5m < -3) {
        adjustedConfidence -= 15;
        warnings.push('Sharp 5m drop. Reducing confidence.');
      }

      if (input.spreadPct > 0.5) {
        adjustedConfidence -= 10;
        warnings.push('Wide spread > 0.5%. Reducing confidence.');
      }

      if (input.volume24h < 100000) {
        adjustedConfidence -= 20;
        warnings.push('Low 24h volume. High risk of manipulation.');
      }

      if (input.riskGroup === 'very_high_risk' && adjustedConfidence < 70) {
        warnings.push('Very high risk group with low confidence.');
        return {
          verdict: 'BLOCK',
          reason: 'Very high risk group and confidence below 70.',
          adjustedConfidenceScore: adjustedConfidence,
          warnings,
        };
      }

      if (adjustedConfidence < 50) {
        return {
          verdict: 'BLOCK',
          reason: `Confidence ${adjustedConfidence} is below minimum threshold.`,
          adjustedConfidenceScore: adjustedConfidence,
          warnings,
        };
      }

      if (adjustedConfidence < output.confidenceScore) {
        return {
          verdict: 'REDUCE',
          reason: `Confidence reduced from ${output.confidenceScore} to ${adjustedConfidence} by retrospective analysis.`,
          adjustedConfidenceScore: adjustedConfidence,
          warnings,
        };
      }
    }

    return {
      verdict: 'CONFIRM',
      reason: 'Retrospective analysis confirms decision.',
      adjustedConfidenceScore: adjustedConfidence,
      warnings,
    };
  }
}
