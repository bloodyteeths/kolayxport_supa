-- "Connect your own AI" (MCP): connections (hashed tokens), OAuth clients and codes
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "refreshHash" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiConnection_tokenHash_key" ON "AiConnection"("tokenHash");
CREATE UNIQUE INDEX "AiConnection_refreshHash_key" ON "AiConnection"("refreshHash");
CREATE INDEX "AiConnection_userId_idx" ON "AiConnection"("userId");
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpOAuthCode" (
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthCode_pkey" PRIMARY KEY ("codeHash")
);
CREATE INDEX "McpOAuthCode_userId_idx" ON "McpOAuthCode"("userId");
