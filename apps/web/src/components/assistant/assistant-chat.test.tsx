import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantChat from "./assistant-chat";
import AssistantLauncher from "./assistant-launcher";

const mockMutateAsync = vi.fn();
const mockUseGetConfig = vi.fn();

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  mockMutateAsync.mockReset();
  mockUseGetConfig.mockReset();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useParams: () => ({}),
}));

vi.mock("@/hooks/mutations/assistant/use-send-assistant-message", () => ({
  default: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => mockUseGetConfig(),
}));

async function typeAndSend(text: string) {
  const input = screen.getByLabelText("assistant:placeholder");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByText("assistant:send"));
}

describe("AssistantChat", () => {
  it("digitar e enviar exibe a resposta do assistente", async () => {
    mockMutateAsync.mockResolvedValue({
      reply: "Criei a tarefa para voce.",
      actions: [],
    });

    render(<AssistantChat workspaceId="ws-1" projectId="proj-1" />);

    await typeAndSend("Crie uma tarefa de teste");

    expect(
      await screen.findByText("Criei a tarefa para voce."),
    ).toBeInTheDocument();
    expect(screen.getByText("Crie uma tarefa de teste")).toBeInTheDocument();
    expect(mockMutateAsync).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Crie uma tarefa de teste" }],
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
  });

  it("uma resposta com pendingConfirmation renderiza o bloco de confirmacao e nao mostra resposta final", async () => {
    const conversationState = [
      { role: "system", content: "..." },
      { role: "assistant", tool_calls: [{ id: "call-1" }] },
    ];

    mockMutateAsync.mockResolvedValue({
      reply: "",
      actions: [],
      pendingConfirmation: {
        toolCallId: "call-1",
        tool: "delete_task",
        description: 'delete_task {"id":"task-9"}',
      },
      conversationState,
      conversationSignature: "sig-abc",
    });

    const { container } = render(
      <AssistantChat workspaceId="ws-1" projectId="proj-1" />,
    );

    await typeAndSend("Apague a tarefa 9");

    expect(
      await screen.findByText("assistant:confirmTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText('delete_task {"id":"task-9"}')).toBeInTheDocument();

    // Apenas a mensagem do usuario deve estar na lista: a resposta vazia do
    // assistente (reply: "") nao deve virar uma bolha de mensagem porque o
    // fluxo ficou pendente de confirmacao em vez de finalizar.
    const messageItems = container.querySelectorAll("ul > li");
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]).toHaveTextContent("Apague a tarefa 9");
  });

  it("clicar em confirmar chama a mutacao de novo com os tres campos obrigatorios", async () => {
    const conversationState = [
      { role: "system", content: "..." },
      { role: "assistant", tool_calls: [{ id: "call-1" }] },
    ];

    mockMutateAsync
      .mockResolvedValueOnce({
        reply: "",
        actions: [],
        pendingConfirmation: {
          toolCallId: "call-1",
          tool: "delete_task",
          description: 'delete_task {"id":"task-9"}',
        },
        conversationState,
        conversationSignature: "sig-abc",
      })
      .mockResolvedValueOnce({
        reply: "Tarefa apagada.",
        actions: [{ tool: "delete_task", summary: '{"id":"task-9"}' }],
      });

    render(<AssistantChat workspaceId="ws-1" projectId="proj-1" />);

    await typeAndSend("Apague a tarefa 9");
    await screen.findByText("assistant:confirmTitle");

    fireEvent.click(screen.getByText("assistant:confirm"));

    expect(await screen.findByText("Tarefa apagada.")).toBeInTheDocument();

    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockMutateAsync.mock.calls[1][0];

    // Os tres campos sao obrigatorios: sem resumeFrom o modelo re-deriva a
    // exclusao com um id novo que nunca bate com a confirmacao; sem
    // conversationSignature o servidor responde 400. O toolCallId sozinho
    // nunca e suficiente.
    expect(secondCallArgs.confirmations).toEqual(["call-1"]);
    expect(secondCallArgs.resumeFrom).toBe(conversationState);
    expect(secondCallArgs.resumeFrom).toEqual(conversationState);
    expect(secondCallArgs.conversationSignature).toBe("sig-abc");
  });

  it("cancelar descarta o bloco de confirmacao e o estado guardado", async () => {
    const conversationState = [{ role: "system", content: "..." }];

    mockMutateAsync.mockResolvedValueOnce({
      reply: "",
      actions: [],
      pendingConfirmation: {
        toolCallId: "call-1",
        tool: "delete_task",
        description: 'delete_task {"id":"task-9"}',
      },
      conversationState,
      conversationSignature: "sig-abc",
    });

    render(<AssistantChat workspaceId="ws-1" projectId="proj-1" />);

    await typeAndSend("Apague a tarefa 9");
    await screen.findByText("assistant:confirmTitle");

    fireEvent.click(screen.getByText("assistant:cancel"));

    expect(
      screen.queryByText("assistant:confirmTitle"),
    ).not.toBeInTheDocument();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("mostra assistant:empty quando nao ha mensagens", () => {
    render(<AssistantChat />);

    expect(screen.getByText("assistant:empty")).toBeInTheDocument();
  });

  it("erro da mutacao exibe assistant:error na conversa", async () => {
    mockMutateAsync.mockRejectedValue(new Error("network down"));

    render(<AssistantChat />);

    await typeAndSend("Ola");

    expect(await screen.findByText("assistant:error")).toBeInTheDocument();
  });

  it("lista as acoes executadas abaixo da mensagem, com link quando ha id de tarefa", async () => {
    mockMutateAsync.mockResolvedValue({
      reply: "Feito.",
      actions: [
        {
          tool: "create_task",
          summary: '{"id":"task-42","title":"Nova tarefa"}',
        },
      ],
    });

    render(<AssistantChat workspaceId="ws-1" projectId="proj-1" />);

    await typeAndSend("Crie uma tarefa");

    expect(
      await screen.findByText("assistant:actionsTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText("create_task")).toBeInTheDocument();
    expect(screen.getByText("assistant:viewTask")).toBeInTheDocument();
  });
});

describe("AssistantLauncher", () => {
  it("nao renderiza nada quando o assistente esta desabilitado", () => {
    mockUseGetConfig.mockReturnValue({ data: { hasAssistant: false } });

    const { container } = render(<AssistantLauncher />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("assistant:open")).not.toBeInTheDocument();
  });

  it("alternar entre bolha e painel preserva a conversa (mesma instancia de AssistantChat)", async () => {
    mockUseGetConfig.mockReturnValue({ data: { hasAssistant: true } });
    mockMutateAsync.mockResolvedValue({
      reply: "Resposta preservada apos alternar o modo.",
      actions: [],
    });

    render(<AssistantLauncher />);

    fireEvent.click(screen.getByLabelText("assistant:open"));

    await typeAndSend("Mensagem que deve sobreviver a troca de modo");

    expect(
      await screen.findByText("Resposta preservada apos alternar o modo."),
    ).toBeInTheDocument();

    // Modo inicial e "bolha": o botao do cabecalho oferece expandir para o
    // painel.
    fireEvent.click(screen.getByLabelText("assistant:expand"));

    // Se AssistantChat tivesse sido desmontado e remontado ao trocar de
    // wrapper, a conversa teria sido reiniciada e estas mensagens teriam
    // desaparecido.
    expect(
      screen.getByText("Mensagem que deve sobreviver a troca de modo"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Resposta preservada apos alternar o modo."),
    ).toBeInTheDocument();

    // O cabecalho agora oferece recolher de volta para a bolha, confirmando
    // que o modo realmente mudou para "painel".
    expect(screen.getByLabelText("assistant:collapse")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("assistant:collapse"));

    expect(
      screen.getByText("Mensagem que deve sobreviver a troca de modo"),
    ).toBeInTheDocument();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});
