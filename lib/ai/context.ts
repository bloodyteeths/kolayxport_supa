// lib/ai/context.ts — who / what an AI call is for, without threading it through every handler. SERVER ONLY.
// An endpoint wraps its action in `withAiContext({ userId, feature, marketplace, refine }, fn)`; helpers deep inside
// (`askClaude`, vision helpers) read it with `aiContext()` and hand it to lib/ai/gemini.getAiModel.
import { AsyncLocalStorage } from 'async_hooks';
import type { AiModelOptions } from './gemini';

type Ctx = Omit<AiModelOptions, 'json' | 'system'>;
const store = new AsyncLocalStorage<Ctx>();

export function withAiContext<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function aiContext(fallbackFeature: string): Ctx {
  return store.getStore() ?? { feature: fallbackFeature };
}
