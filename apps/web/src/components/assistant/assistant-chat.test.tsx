import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantChat from "./assistant-chat";
import AssistantLauncher from "./assistant-launcher";

const mockMutateAsync = vi.fn();
const mockUseGetConfig = vi.fn();

beforeEach(() => {
  // Default: voice input disabled, so the mic button stays hidden unless a
  // test explicitly opts in. Tests that need `hasAssistant` still override
  // this with their own mockReturnValue.
  mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: false } });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  mockMutateAsync.mockReset();
  mockUseGetConfig.mockReset();
  mockTranscribeAudio.mockReset();
  mockToastError.mockReset();
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

const mockTranscribeAudio = vi.fn();

vi.mock("@/fetchers/assistant/transcribe", () => ({
  default: (...args: unknown[]) => mockTranscribeAudio(...args),
}));

const mockToastError = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
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
      onProgress: expect.any(Function),
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

  it("nao mostra o botao de microfone quando hasVoiceInput e falso", () => {
    mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: false } });

    render(<AssistantChat />);

    expect(screen.queryByLabelText("assistant:record")).not.toBeInTheDocument();
  });

  it("mostra o botao de microfone quando hasVoiceInput e verdadeiro", () => {
    mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: true } });

    render(<AssistantChat />);

    expect(screen.getByLabelText("assistant:record")).toBeInTheDocument();
  });

  it("exibe um erro quando a permissao de microfone e negada", async () => {
    mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: true } });
    const getUserMediaMock = vi
      .fn()
      .mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    });
    // jsdom has no MediaRecorder global; handleMicClick feature-detects it
    // before calling getUserMedia, so it must be present for this path.
    vi.stubGlobal("MediaRecorder", class {});

    render(<AssistantChat />);

    fireEvent.click(screen.getByLabelText("assistant:record"));

    await vi.waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });
    expect(mockToastError).toHaveBeenCalledWith("assistant:micDenied");

    vi.unstubAllGlobals();
  });

  it("avisa quando gravacao de audio nao esta disponivel no navegador", () => {
    mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: true } });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(<AssistantChat />);

    fireEvent.click(screen.getByLabelText("assistant:record"));

    expect(mockToastError).toHaveBeenCalledWith("assistant:micUnavailable");
  });

  it("transcreve o audio gravado e preenche o campo de mensagem sem enviar", async () => {
    mockUseGetConfig.mockReturnValue({ data: { hasVoiceInput: true } });
    mockTranscribeAudio.mockResolvedValue({ text: "texto transcrito" });

    const stopTrack = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const getUserMediaMock = vi.fn().mockResolvedValue(fakeStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["audio"]) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    render(<AssistantChat />);

    fireEvent.click(screen.getByLabelText("assistant:record"));
    await vi.waitFor(() => {
      expect(
        screen.getByLabelText("assistant:stopRecording"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("assistant:stopRecording"));

    await vi.waitFor(() => {
      expect(screen.getByLabelText("assistant:placeholder")).toHaveValue(
        "texto transcrito",
      );
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(mockMutateAsync).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
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

describe("AssistantLauncher arrastar", () => {
  const POSITION_STORAGE_KEY = "kaneo:assistant-position";

  beforeEach(() => {
    mockUseGetConfig.mockReturnValue({ data: { hasAssistant: true } });
    // The button is a fixed 56x56 box positioned near the bottom-right
    // corner of a 1024x768 jsdom viewport (the default in this test env).
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 56,
      height: 56,
      left: 900,
      top: 600,
      right: 956,
      bottom: 656,
      x: 900,
      y: 600,
      toJSON() {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("um clique sem movimento ainda abre o chat", () => {
    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 600 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 900, clientY: 600 });
    fireEvent.click(button);

    expect(screen.getByLabelText("assistant:placeholder")).toBeInTheDocument();
  });

  it("arrastar move o botao e persiste a posicao, sem disparar o clique", () => {
    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 600 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 930, clientY: 700 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 930, clientY: 700 });
    fireEvent.click(button);

    // dx=30, dy=100 from the button's starting corner (900, 600).
    expect(button.style.left).toBe("930px");
    expect(button.style.top).toBe("700px");
    // A real drag must not also open the chat.
    expect(
      screen.queryByLabelText("assistant:placeholder"),
    ).not.toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem(POSITION_STORAGE_KEY) ?? "null",
    );
    expect(stored).toEqual({ x: 930, y: 700 });
  });

  it("os botoes do cabecalho continuam clicaveis com o painel arrastavel", () => {
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByLabelText("assistant:open"));
    expect(screen.getByLabelText("assistant:placeholder")).toBeInTheDocument();

    // Regressao real: o cabecalho inteiro e area de arrasto e os botoes de
    // fechar/expandir vivem dentro dele. Um pointerdown no botao iniciava o
    // arrasto e o setPointerCapture desviava o pointerup para o cabecalho, de
    // modo que o clique nunca acontecia e a janela ficava impossivel de fechar.
    //
    // O jsdom nao implementa setPointerCapture, entao o sintoma exato (clique
    // engolido) nao e reproduzivel aqui. O que este teste prende e a guarda que
    // o corrige: um gesto iniciado sobre um botao do cabecalho nao pode mover
    // o painel. Se a guarda cair, a posicao muda e o teste falha.
    const closeButton = screen.getByLabelText("assistant:close");
    const panel = closeButton.closest("div[role='toolbar']")
      ?.parentElement as HTMLElement;
    const positionBefore = panel.style.left;

    fireEvent.pointerDown(closeButton, {
      pointerId: 7,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerMove(closeButton, {
      pointerId: 7,
      clientX: 620,
      clientY: 430,
    });
    fireEvent.pointerUp(closeButton, {
      pointerId: 7,
      clientX: 620,
      clientY: 430,
    });

    expect(panel.style.left).toBe(positionBefore);

    fireEvent.click(closeButton);
    expect(
      screen.queryByLabelText("assistant:placeholder"),
    ).not.toBeInTheDocument();
  });

  it("restaura a posicao salva do localStorage", () => {
    window.localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify({ x: 200, y: 150 }),
    );

    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");

    expect(button.style.left).toBe("200px");
    expect(button.style.top).toBe("150px");
  });

  it("reenquadra uma posicao salva fora da tela", () => {
    // Far outside the 1024x768 jsdom viewport, e.g. saved on a much wider
    // monitor.
    window.localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify({ x: 5000, y: 5000 }),
    );

    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");

    expect(button.style.left).toBe(`${1024 - 56}px`);
    expect(button.style.top).toBe(`${768 - 56}px`);
  });

  it("mover o botao e depois abrir a janela reaproveita a mesma posicao", () => {
    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 600 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 930, clientY: 700 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 930, clientY: 700 });
    // The click that immediately follows a real drag is suppressed (see the
    // "sem disparar o clique" test above) — a second, separate click is what
    // actually opens the chat here.
    fireEvent.click(button);
    fireEvent.click(button);

    const closeButton = screen.getByLabelText("assistant:close");
    const panel = closeButton.closest("div[role='toolbar']")
      ?.parentElement as HTMLElement;

    // O botao foi arrastado para (930, 700); a janela deve abrir exatamente
    // ali, nao na posicao antiga guardada separadamente para o painel.
    expect(panel.style.left).toBe("930px");
    expect(panel.style.top).toBe("700px");
  });

  it("mover a janela e depois fechar deixa o botao na mesma posicao", () => {
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByLabelText("assistant:open"));

    const closeButton = screen.getByLabelText("assistant:close");
    const header = closeButton.closest("div[role='toolbar']") as HTMLElement;
    const panel = header.parentElement as HTMLElement;

    fireEvent.pointerDown(header, {
      pointerId: 3,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerMove(header, {
      pointerId: 3,
      clientX: 540,
      clientY: 260,
    });
    fireEvent.pointerUp(header, { pointerId: 3, clientX: 540, clientY: 260 });

    // dx=40, dy=-40 from the panel's mocked starting corner (900, 600).
    expect(panel.style.left).toBe("940px");
    expect(panel.style.top).toBe("560px");

    fireEvent.click(closeButton);

    const button = screen.getByLabelText("assistant:open");
    // A janela foi arrastada para (940, 560) e fechada; o botao deve
    // reaparecer exatamente ali, nao na posicao antiga guardada
    // separadamente para o botao.
    expect(button.style.left).toBe("940px");
    expect(button.style.top).toBe("560px");
  });

  it("uma posicao compartilhada que estouraria a janela maior e reenquadrada ao abrir", () => {
    // The button (56x56) fits fine at (960, 700) on the 1024x768 viewport,
    // but the much larger chat window does not — it must be re-clamped
    // against its own size when it opens, without that clamp corrupting the
    // stored position (which stays valid for the button).
    window.localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify({ x: 960, y: 700 }),
    );

    (
      HTMLElement.prototype.getBoundingClientRect as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockRestore();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const isButton = this.tagName === "BUTTON";
        const width = isButton ? 56 : 380;
        const height = isButton ? 56 : 600;
        return {
          width,
          height,
          left: 960,
          top: 700,
          right: 960 + width,
          bottom: 700 + height,
          x: 960,
          y: 700,
          toJSON() {},
        } as DOMRect;
      },
    );

    render(<AssistantLauncher />);
    const button = screen.getByLabelText("assistant:open");
    expect(button.style.left).toBe("960px");
    expect(button.style.top).toBe("700px");

    fireEvent.click(button);

    const closeButton = screen.getByLabelText("assistant:close");
    const panel = closeButton.closest("div[role='toolbar']")
      ?.parentElement as HTMLElement;

    expect(panel.style.left).toBe(`${1024 - 380}px`);
    expect(panel.style.top).toBe(`${768 - 600}px`);

    // The clamp above must be display-only: the raw shared position stored
    // for the button must stay untouched.
    const stored = JSON.parse(
      window.localStorage.getItem(POSITION_STORAGE_KEY) ?? "null",
    );
    expect(stored).toEqual({ x: 960, y: 700 });
  });
});
