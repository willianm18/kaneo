import { describe, expect, it } from "vitest";
import {
  collectTools,
  toOpenRouterTools,
} from "../../../apps/api/src/assistant/collect-tools";

describe("collectTools", () => {
  it("captura as ferramentas do MCP sem precisar de um servidor MCP", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");

    expect(tools.length).toBeGreaterThan(30);
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_task");
    expect(names).toContain("search");
    expect(names).toContain("whoami");
  });

  it("cada ferramenta traz descricao, schema e um executor", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");
    const createTask = tools.find((t) => t.name === "create_task");

    expect(createTask).toBeDefined();
    expect(createTask?.description.length).toBeGreaterThan(0);
    expect(typeof createTask?.execute).toBe("function");
    expect(createTask?.inputSchema).toBeDefined();
  });
});

describe("toOpenRouterTools", () => {
  it("converte para o formato de function calling", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");
    const converted = toOpenRouterTools(
      tools.filter((t) => t.name === "create_task"),
    );

    expect(converted).toHaveLength(1);
    expect(converted[0].type).toBe("function");
    expect(converted[0].function.name).toBe("create_task");
    expect(converted[0].function.parameters).toMatchObject({
      type: "object",
    });
  });
});
