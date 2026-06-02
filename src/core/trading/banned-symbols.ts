import { logger } from '../../utils/logger';

export const HARD_BLOCKED_ASSETS = new Set([
  'EURI', 'EUR', 'FDUSD', 'TUSD', 'USDC', 'USDP', 'DAI', 'BUSD', 'AEUR', 'PAXG',
]);

export function normalizeBannedCoinInput(input: string): { raw: string; symbol: string | null; baseAsset: string | null; quoteAsset: string | null } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return null;
  const symbol = normalized.endsWith('USDT') ? normalized : null;
  const baseAsset = symbol ? normalized.slice(0, -4) : normalized;
  const quoteAsset = symbol ? 'USDT' : null;
  logger.info(`BANNED_COIN_NORMALIZED: input=${raw} symbol=${symbol ?? 'none'} baseAsset=${baseAsset ?? 'none'} quoteAsset=${quoteAsset ?? 'none'}`);
  return { raw, symbol, baseAsset, quoteAsset };
}

export function isSymbolBannedForTrading(
  symbol: string,
  baseAsset?: string | null,
  quoteAsset?: string | null,
  banlist?: string[],
): { banned: boolean; reason: string } {
  const sym = String(symbol ?? '').toUpperCase().trim();
  const base = (baseAsset ?? (sym.endsWith('USDT') ? sym.slice(0, -4) : sym)).toUpperCase();
  const quote = (quoteAsset ?? (sym.endsWith('USDT') ? 'USDT' : '')).toUpperCase();
  const normalizedBanlist = new Set((banlist ?? []).map((x) => String(x).toUpperCase().trim()).filter(Boolean));
  if (normalizedBanlist.has(sym) || (base && normalizedBanlist.has(base))) return { banned: true, reason: 'banned_symbol_or_base' };
  if (HARD_BLOCKED_ASSETS.has(base)) return { banned: true, reason: 'hard_blocked_asset' };
  if (HARD_BLOCKED_ASSETS.has(sym)) return { banned: true, reason: 'hard_blocked_asset' };
  if (quote && quote !== 'USDT') return { banned: true, reason: 'blocked_quote' };
  return { banned: false, reason: 'none' };
}
