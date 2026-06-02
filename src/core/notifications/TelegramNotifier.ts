import type { TelegramSettings } from '../types';
import { createDefaultTelegramSettings } from '../types';
import { logger } from '../../utils/logger';
import {
  formatBuyNotification,
  formatSellNotification,
  formatWaitBlockNotification,
  formatErrorNotification,
  sanitizeTelegramMessage,
} from './telegram-templates';

export type NotificationEvent =
  | 'BUY_OPENED'
  | 'SELL_CLOSED'
  | 'STOP_LOSS'
  | 'TP_HIT'
  | 'WAIT_BLOCK'
  | 'ERROR'
  | 'DAILY_SUMMARY';

export interface NotificationPayload {
  event: NotificationEvent;
  symbol: string;
  message: string;
  details?: Record<string, unknown>;
  trade?: import('../types').TradeRecord;
  candidate?: import('../types').ScannerCandidate;
}

export class TelegramNotifier {
  private settings: TelegramSettings;

  constructor(settings?: Partial<TelegramSettings>) {
    this.settings = { ...createDefaultTelegramSettings(), ...settings };
  }

  updateSettings(settings: Partial<TelegramSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): TelegramSettings {
    return { ...this.settings };
  }

  private shouldNotify(event: NotificationEvent): boolean {
    if (!this.settings.enabled) return false;
    switch (event) {
      case 'BUY_OPENED': return this.settings.notifyOnBuy;
      case 'SELL_CLOSED': return this.settings.notifyOnSell;
      case 'STOP_LOSS': return this.settings.notifyOnSell && this.settings.notifyOnStopLoss;
      case 'TP_HIT': return this.settings.notifyOnSell && this.settings.notifyOnTakeProfit;
      case 'ERROR': return this.settings.notifyOnError;
      case 'WAIT_BLOCK': return this.settings.notifyOnBlock;
      case 'DAILY_SUMMARY': return this.settings.notifyOnDailySummary;
      default: return true;
    }
  }

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<boolean> {
    if (!this.shouldNotify(event)) return false;
    if (!this.settings.botToken || !this.settings.chatId) {
      logger.warn('TELEGRAM_NOT_CONFIGURED');
      return false;
    }
    try {
      const text = this.formatMessage(payload);
      return this.sendTelegramMessage(text);
    } catch (err) {
      logger.warn(`TELEGRAM_SEND_ERROR: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async sendTelegramMessage(message: string): Promise<boolean> {
    if (!this.settings.botToken || !this.settings.chatId) {
      logger.warn('TELEGRAM_NOT_CONFIGURED');
      return false;
    }
    const safeMessage = sanitizeTelegramMessage(message);
    const url = `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`;
    const body = { chat_id: this.settings.chatId, text: safeMessage };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn(`TELEGRAM_SEND_FAILED: ${res.status}`);
      return false;
    }
    return true;
  }

  async sendTest(): Promise<boolean> {
    if (!this.settings.botToken || !this.settings.chatId) {
      logger.warn('TELEGRAM_NOT_CONFIGURED');
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`;
      const body = {
        chat_id: this.settings.chatId,
        text: '🧪 CryptoBud V4 Test Notification — your Telegram settings work!',
        parse_mode: 'HTML',
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn(`TELEGRAM_TEST_FAILED: ${res.status}`);
        return false;
      }
      logger.info('TELEGRAM_TEST_SENT');
      return true;
    } catch (err) {
      logger.warn(`TELEGRAM_TEST_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private formatMessage(payload: NotificationPayload): string {
    if (payload.trade && payload.event === 'BUY_OPENED') {
      return formatBuyNotification(payload.trade);
    }
    if (payload.trade && (payload.event === 'SELL_CLOSED' || payload.event === 'STOP_LOSS' || payload.event === 'TP_HIT')) {
      return formatSellNotification(payload.trade);
    }
    if (payload.event === 'ERROR') {
      return formatErrorNotification({
        module: payload.details?.module as string | undefined,
        message: payload.message,
        time: payload.details?.time as string | number | Date | undefined,
      });
    }
    if (payload.candidate) {
      return formatWaitBlockNotification(payload.candidate);
    }
    return sanitizeTelegramMessage(payload.message);
  }
}
