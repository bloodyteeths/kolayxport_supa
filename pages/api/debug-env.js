export default function handler(req, res) {
  console.log('[DEBUG_ENV] Attempting to read environment variables.');

  const databaseUrl = process.env.DATABASE_URL;
  const nextauthSecret = process.env.NEXTAUTH_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const nextauthUrl = process.env.NEXTAUTH_URL;

  console.log(`[DEBUG_ENV] DATABASE_URL: ${databaseUrl ? databaseUrl.substring(0, 30) + '...' : 'NOT SET'}`);
  console.log(`[DEBUG_ENV] NEXTAUTH_SECRET: ${nextauthSecret ? 'SET' : 'NOT SET'}`);
  console.log(`[DEBUG_ENV] GOOGLE_CLIENT_ID: ${googleClientId ? 'SET' : 'NOT SET'}`);
  console.log(`[DEBUG_ENV] NEXTAUTH_URL: ${nextauthUrl ? nextauthUrl : 'NOT SET'}`);

  res.status(200).json({
    databaseUrlStatus: databaseUrl ? `SET (starts with: ${databaseUrl.substring(0, 30)}...)` : 'NOT SET',
    nextauthSecretStatus: nextauthSecret ? 'SET' : 'NOT SET',
    googleClientIdStatus: googleClientId ? 'SET' : 'NOT SET',
    nextauthUrlStatus: nextauthUrl ? `SET (${nextauthUrl})` : 'NOT SET',
  });
} 