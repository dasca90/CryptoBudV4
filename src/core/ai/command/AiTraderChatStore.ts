import type { AiMissionResult } from './AiMissionResult';

export interface AiTraderChatMessage {
  id: string;
  at: number;
  role: 'user' | 'system';
  text: string;
  result?: AiMissionResult;
}

export class AiTraderChatStore {
  private messages: AiTraderChatMessage[] = [];

  add(message: Omit<AiTraderChatMessage, 'id' | 'at'>): AiTraderChatMessage {
    const saved = { ...message, id: `ai_chat_${Date.now()}_${this.messages.length}`, at: Date.now() };
    this.messages = [saved, ...this.messages].slice(0, 100);
    return saved;
  }

  getMessages(): readonly AiTraderChatMessage[] {
    return this.messages;
  }
}
