export interface MarketEdgeSymbolMapping {
  spotSymbol: string;
  futuresSymbol: string | null;
  hasPerpetualPair: boolean;
  spotTradingActive: boolean;
  futuresTradingActive: boolean;
  edgeAvailability: 'SPOT_AND_PERPETUAL' | 'SPOT_ONLY';
}

function symbols(info: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(info.symbols) ? info.symbols as Array<Record<string, unknown>> : [];
}

export function buildMarketEdgeSymbolMappings(spotInfo: Record<string, unknown>, futuresInfo: Record<string, unknown>, allowedSpotSymbols?: ReadonlySet<string>): MarketEdgeSymbolMapping[] {
  const futuresBySymbol = new Map(symbols(futuresInfo).map(row => [String(row.symbol ?? ''), row]));
  return symbols(spotInfo)
    .filter(row => String(row.quoteAsset ?? '') === 'USDT')
    .filter(row => !allowedSpotSymbols || allowedSpotSymbols.has(String(row.symbol ?? '')))
    .map(row => {
      const spotSymbol = String(row.symbol ?? '');
      const futures = futuresBySymbol.get(spotSymbol);
      const futuresTradingActive = !!futures && String(futures.status ?? '') === 'TRADING' && String(futures.contractType ?? '') === 'PERPETUAL';
      return {
        spotSymbol,
        futuresSymbol: futuresTradingActive ? spotSymbol : null,
        hasPerpetualPair: futuresTradingActive,
        spotTradingActive: String(row.status ?? '') === 'TRADING' && row.isSpotTradingAllowed !== false,
        futuresTradingActive,
        edgeAvailability: futuresTradingActive ? 'SPOT_AND_PERPETUAL' as const : 'SPOT_ONLY' as const,
      };
    })
    .filter(mapping => mapping.spotSymbol.length > 0);
}
