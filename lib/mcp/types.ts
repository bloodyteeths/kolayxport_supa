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
  /** MCP annotations (tools/list): readOnlyHint = readOnly; destructiveHint is always false (no tool deletes or
   * overwrites marketplace data: writes are staged drafts); idempotentHint defaults to readOnly; openWorldHint = the
   * tool reaches outside KolayXport's own data (live marketplace search, the image model). */
  readOnly: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  inputSchema: JsonSchema;
  run: (auth: McpAuth, args: Record<string, any>) => Promise<unknown>;
};

