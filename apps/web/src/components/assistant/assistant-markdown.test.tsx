import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AssistantMarkdown from "./assistant-markdown";

afterEach(() => {
  cleanup();
});

describe("AssistantMarkdown", () => {
  it("renderiza negrito", () => {
    render(<AssistantMarkdown content="O projeto e **Meta.X**." />);

    const strong = screen.getByText("Meta.X");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renderiza italico", () => {
    render(<AssistantMarkdown content="Isso e *importante*." />);

    const em = screen.getByText("importante");
    expect(em.tagName).toBe("EM");
  });

  it("renderiza lista nao ordenada", () => {
    render(<AssistantMarkdown content={"- Nome: Meta.X\n- ID: abc123"} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Nome: Meta.X");
    expect(screen.getByRole("list").tagName).toBe("UL");
  });

  it("renderiza lista ordenada", () => {
    render(<AssistantMarkdown content={"1. Primeiro\n2. Segundo"} />);

    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renderiza codigo inline", () => {
    render(<AssistantMarkdown content="Rode `pnpm dev` para iniciar." />);

    const code = screen.getByText("pnpm dev");
    expect(code.tagName).toBe("CODE");
  });

  it("renderiza bloco de codigo cercado", () => {
    render(<AssistantMarkdown content={"```\nconst x = 1;\n```"} />);

    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renderiza titulo", () => {
    render(<AssistantMarkdown content="## Resumo" />);

    const heading = screen.getByText("Resumo");
    expect(heading.tagName).toBe("H2");
  });

  it("renderiza link valido como ancora com rel e target corretos", () => {
    render(
      <AssistantMarkdown content="[abrir tarefa](https://kaneo.example/task/1)" />,
    );

    const link = screen.getByRole("link", { name: "abrir tarefa" });
    expect(link).toHaveAttribute("href", "https://kaneo.example/task/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("nao transforma URL javascript: em ancora", () => {
    render(<AssistantMarkdown content="[clique aqui](javascript:alert(1))" />);

    expect(
      screen.queryByRole("link", { name: "clique aqui" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/clique aqui/)).toBeInTheDocument();
  });

  it("markdown malformado renderiza como texto sem lancar excecao", () => {
    expect(() =>
      render(<AssistantMarkdown content="Isto tem ** solto e sem fechar" />),
    ).not.toThrow();

    expect(
      screen.getByText(/Isto tem \*\* solto e sem fechar/),
    ).toBeInTheDocument();
  });

  it("fence de codigo nao fechado nao lanca excecao e mostra o conteudo", () => {
    expect(() =>
      render(<AssistantMarkdown content={"```\nconst x = 1;"} />),
    ).not.toThrow();

    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });
});
