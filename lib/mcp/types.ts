// lib/mcp/types.ts — shared MCP tool types (lib/mcp/tools, lib/mcp/listingTools).
import type { McpAuth, McpScope } from './tokens';

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type JsonSchema = Record<string, unknown>;
export type McpTool = {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  readOnly: boolean;
  inputSchema: JsonSchema;
  run: (auth: McpAuth, args: Record<string, any>) => Promise<unknown>;
};

