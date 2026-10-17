// Gemini model names in one place, overridable per environment (server .env).
// New Google projects can't use gemini-2.5-flash any more: when production moves to a new (billed) key,
// set GEMINI_TEXT_MODEL (e.g. gemini-3.8-flash or gemini-3.5-flash) — no code change needed.
export const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
