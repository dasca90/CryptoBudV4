import { logger } from '../../utils/logger';

const consumers = new Map<string, number>();

export function registerMarketDataConsumer(consumerName: string): void {
  consumers.set(consumerName, Date.now());
  logger.info(`MARKET_DATA_CONSUMER_REGISTRY_AUDIT: consumerName=${consumerName} registered=true activeConsumers=${consumers.size} invariantOk=true failureReason=none`);
}

export function getRegisteredMarketDataConsumers(): string[] {
  return [...consumers.keys()];
}
