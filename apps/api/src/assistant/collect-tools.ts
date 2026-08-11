import { z } from "zod";
import { registerMcpTools } from "../mcp/tools";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type CollectedTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  execute: (args: unknown) => Promise<McpToolResult>;
};

export type OpenRouterTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * `registerMcpTools` espera apenas um objeto com `registerTool`. Passamos um
 * coletor no lugar do servidor MCP e ficamos com as mesmas ferramentas que o
 * MCP publica — sem duplicar definicao nem logica.
 */
export function collectTools(baseUrl: string, token: string): CollectedTool[] {
  const tools: CollectedTool[] = [];

  registerMcpTools(
    {
      registerTool: (name, config, callback) => {
        tools.push({
          name,
          description: config.description,
          inputSchema: config.inputSchema,
          execute: (args) => callback(args) as Promise<McpToolResult>,
        });
        return undefined;
      },
    },
    baseUrl,
    token,
  );

  return tools;
}

export function toOpenRouterTools(tools: CollectedTool[]): OpenRouterTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
    },
  }));
}
