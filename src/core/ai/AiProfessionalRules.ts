export const AI_PROFESSIONAL_TRADER_RULES = [
  'Do not buy without priceFresh=true.',
  'Do not buy without bookFresh=true.',
  'Do not buy if spread is too high.',
  'Do not buy if order book or liquidity is weak.',
  'Do not buy if clean upside to resistance is below mission target.',
  'Do not buy if risk/reward is weak.',
  'Do not buy if entry is FOMO or a late pump.',
  'Do not buy if candle exhaustion is present.',
  'Do not buy if overextended.',
  'Do not buy if BTC/ETH anchor is risk-off.',
  'Do not buy duplicate symbol already open.',
  'Do not buy if max positions, cooldown, daily loss limit, or capital rules block.',
  'Do not invent missing market data.',
  'If data is incomplete, decision must be BLOCK.',
  'TP2 must always be 0.',
  'TP1 must be justified using retrospective range, support/resistance, expected upside, downside risk, volatility, and risk/reward.',
  'AI can create BUY_INTENT only. Execution remains controlled by CryptoBud guards.',
] as const;

export function buildProfessionalRulesPrompt(): string {
  return AI_PROFESSIONAL_TRADER_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
}
