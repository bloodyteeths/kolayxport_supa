// GET /.well-known/openai-apps-challenge (rewritten here) — OpenAI apps (ChatGPT) domain verification.
// OpenAI's submission portal gives the founder a challenge token; it is set as OPENAI_APPS_CHALLENGE in the server
// .env and served here as plain text (only the token: no JSON, no list). Unset → 404.
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const token = (process.env.OPENAI_APPS_CHALLENGE || '').trim();
  res.setHeader('Cache-Control', 'no-store');
  if (!token) return res.status(404).end();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(token);
}
