// lib/messages/platforms.ts — which inbox platforms exist and how they behave. Pure.
// Q&A platforms (Trendyol, Hepsiburada): a product/order question with a one-shot seller answer, rendered from the
// list payload (no thread fetch). Chat platforms (Wix): a conversation with follow-ups, thread fetched on open.

import type { MessagePlatform } from '@/types/messages';
import { HEPSIBURADA_ANSWER_MAX, HEPSIBURADA_ANSWER_MIN, TRENDYOL_ANSWER_MAX, TRENDYOL_ANSWER_MIN, WIX_REPLY_MAX } from './limits';

export const MESSAGE_PLATFORMS: readonly MessagePlatform[] = ['wix', 'trendyol', 'hepsiburada'];

export function isMessagePlatform(v: unknown): v is MessagePlatform {
  return v === 'wix' || v === 'trendyol' || v === 'hepsiburada';
}

/** Trendyol / Hepsiburada: question + one answer. */
export function isQuestionPlatform(p: string | null | undefined): boolean {
  return p === 'trendyol' || p === 'hepsiburada';
}

export function replyLimits(p: MessagePlatform): { min: number; max: number } {
  if (p === 'trendyol') return { min: TRENDYOL_ANSWER_MIN, max: TRENDYOL_ANSWER_MAX };
  if (p === 'hepsiburada') return { min: HEPSIBURADA_ANSWER_MIN, max: HEPSIBURADA_ANSWER_MAX };
  return { min: 1, max: WIX_REPLY_MAX };
}
