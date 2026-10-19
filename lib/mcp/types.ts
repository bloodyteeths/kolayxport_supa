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
  /** MCP annotations (tools/list): readOnlyHint = readOnly; destructiveHint = destructive (default false: no tool
   * deletes marketplace data, writes are staged drafts; set on tools whose draft carries price/quantity changes so
   * the AI client asks the seller before calling them); idempotentHint defaults to readOnly; openWorldHint = the
   * tool reaches outside KolayXport's own data (live marketplace search, the image model). */
  readOnly: boolean;
  idempotent?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  inputSchema: JsonSchema;
  run: (auth: McpAuth, args: Record<string, any>) => Promise<unknown>;
};

