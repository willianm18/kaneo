import { useParams } from "@tanstack/react-router";
import { Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AssistantChat from "@/components/assistant/assistant-chat";
import { Button } from "@/components/ui/button";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { cn } from "@/lib/cn";

type AssistantMode = "bubble" | "panel";
type Position = { x: number; y: number };

const MODE_STORAGE_KEY = "kaneo:assistant-mode";
const POSITION_STORAGE_KEY = "kaneo:assistant-position";

// A pointer has to move at least this many pixels before a press is treated
// as a drag rather than a click, so a plain tap still opens the chat.
const DRAG_THRESHOLD_PX = 4;

function readStoredMode(): AssistantMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === "panel"
      ? "panel"
      : "bubble";
  } catch {
    return "bubble";
  }
}

function writeStoredMode(mode: AssistantMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage can be unavailable (private browsing, etc.) — the mode
    // just won't survive a reload, which is not worth failing over.
  }
}

function readStoredPosition(): Position | null {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredPosition(position: Position) {
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Same as the mode above: not persisting a dragged position is not
    // worth failing over.
  }
}

// Keeps a position's top-left corner fully inside the current viewport for
// an element of the given size. Used both while dragging and whenever the
// viewport changes (e.g. resizing from a wide monitor down to a laptop).
export function clampPosition(
  position: Position,
  size: { width: number; height: number },
): Position {
  const maxX = Math.max(0, window.innerWidth - size.width);
  const maxY = Math.max(0, window.innerHeight - size.height);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
  };
}

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositionX: number;
  startPositionY: number;
  moved: boolean;
};

/**
 * Makes `containerRef` draggable via pointer events on whatever handle
 * triggers `onPointerDown`.
 *
 * The button and the chat window are two different-sized views of the SAME
 * position: `sharedPosition`/`setSharedPosition` are lifted to the caller
 * (`AssistantLauncher`) and persisted once, from a single spot, so moving
 * either one moves the other and there is exactly one value in
 * localStorage. This hook only ever *re-clamps that shared value against
 * its own element's size for display* (`position` below) — it never writes
 * a clamped value back to the shared position. If it did, opening the
 * (much larger) window would permanently overwrite a position that was
 * perfectly valid for the (much smaller) button, corrupting where the
 * button reopens later. The shared position only advances on an actual
 * drag of that element, which is a deliberate new position for both.
 *
 * `enabled` controls whether dragging (and the stored position) applies at
 * all — the full-height "panel" mode ignores it and stays docked to the
 * edge of the screen. `visible` marks whether this element is the one
 * currently mounted, so the display position gets recomputed against its
 * real size the moment it appears (e.g. right after the window closes and
 * the button reappears).
 */
function useDraggable(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  visible: boolean,
  sharedPosition: Position | null,
  setSharedPosition: (position: Position) => void,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // Whenever this element becomes the visible one, or the shared position
  // changes (because the other element was just dragged), re-clamp against
  // this element's actual size for display only — see the doc comment above
  // for why this must not be written back to the shared position.
  useEffect(() => {
    if (!enabled || !visible) {
      return;
    }
    if (sharedPosition === null) {
      setPosition(null);
      return;
    }
    const el = containerRef.current;
    if (!el) {
      setPosition(sharedPosition);
      return;
    }
    const rect = el.getBoundingClientRect();
    setPosition(
      clampPosition(sharedPosition, { width: rect.width, height: rect.height }),
    );
  }, [enabled, visible, sharedPosition, containerRef]);

  // Re-clamp on viewport resize so a stranded-off-screen position is pulled
  // back into view rather than left there until the next drag.
  useEffect(() => {
    if (!enabled || !visible) {
      return;
    }
    const handleResize = () => {
      const el = containerRef.current;
      if (!el || sharedPosition === null) {
        return;
      }
      const rect = el.getBoundingClientRect();
      setPosition(
        clampPosition(sharedPosition, {
          width: rect.width,
          height: rect.height,
        }),
      );
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [enabled, visible, sharedPosition, containerRef]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (!enabled) {
        return;
      }
      // O cabecalho inteiro arrasta, mas os botoes de expandir e fechar vivem
      // dentro dele. Sem esta guarda, o setPointerCapture abaixo desvia o
      // pointerup para o cabecalho e o clique no botao nunca acontece — foi
      // assim que a janela do chat ficou impossivel de fechar.
      //
      // A comparacao com currentTarget e o que preserva o arrasto do botao
      // recolhido: ali o proprio elemento arrastavel e um <button>, entao a
      // guarda so pode valer para controles aninhados dentro da area de arrasto.
      const interactive = (event.target as HTMLElement).closest(
        "button, a, input, textarea",
      );
      if (interactive && interactive !== event.currentTarget) {
        return;
      }
      const el = containerRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const current = position ?? { x: rect.left, y: rect.top };
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPositionX: current.x,
        startPositionY: current.y,
        moved: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [enabled, containerRef, position],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - state.startClientX;
      const dy = event.clientY - state.startClientY;
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      state.moved = true;
      setIsDragging(true);
      const el = containerRef.current;
      const next = {
        x: state.startPositionX + dx,
        y: state.startPositionY + dy,
      };
      setPosition(
        el
          ? clampPosition(next, {
              width: el.getBoundingClientRect().width,
              height: el.getBoundingClientRect().height,
            })
          : next,
      );
    },
    [containerRef],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragStateRef.current = null;
      setIsDragging(false);
      if (state.moved) {
        suppressClickRef.current = true;
        setPosition((prev) => {
          if (prev) {
            // A finished drag is a deliberate new position for this
            // element: promote it to the shared position (and persist it)
            // so the other element picks it up too.
            setSharedPosition(prev);
          }
          return prev;
        });
      }
    },
    [setSharedPosition],
  );

  // Consumed once by the click handler on the same element: a drag that
  // just ended must not also fire the underlying click.
  const consumeClickSuppression = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  return {
    position,
    isDragging,
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    consumeClickSuppression,
  };
}

function AssistantLauncher() {
  const { t } = useTranslation();
  const { data: config } = useGetConfig();
  const { workspaceId, projectId } = useParams({ strict: false });

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>(readStoredMode);

  useEffect(() => {
    writeStoredMode(mode);
  }, [mode]);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Single source of truth for the position, shared by the button and the
  // chat window: whichever one gets dragged writes here (and to
  // localStorage), so closing the window leaves the button where the window
  // was and opening it puts it where the button was. See useDraggable's doc
  // comment for why each element still clamps its own display separately.
  const [sharedPosition, setSharedPositionState] = useState<Position | null>(
    readStoredPosition,
  );
  const setSharedPosition = useCallback((next: Position) => {
    setSharedPositionState(next);
    writeStoredPosition(next);
  }, []);

  // The full-height "panel" mode stays docked to the screen edge — only the
  // floating button and the bubble chat window are draggable.
  const buttonDrag = useDraggable(
    buttonRef,
    true,
    !isOpen,
    sharedPosition,
    setSharedPosition,
  );
  const panelDrag = useDraggable(
    panelRef,
    mode === "bubble",
    isOpen && mode === "bubble",
    sharedPosition,
    setSharedPosition,
  );

  if (!config?.hasAssistant) {
    return null;
  }

  if (!isOpen) {
    return (
      <Button
        ref={buttonRef}
        size="icon-lg"
        onClick={() => {
          if (buttonDrag.consumeClickSuppression()) {
            return;
          }
          setIsOpen(true);
        }}
        aria-label={t("assistant:open")}
        className={cn(
          "fixed right-4 bottom-4 z-60 touch-none rounded-full shadow-lg",
          buttonDrag.isDragging && "cursor-grabbing",
        )}
        style={
          buttonDrag.position
            ? {
                left: buttonDrag.position.x,
                top: buttonDrag.position.y,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
        {...buttonDrag.dragHandleProps}
      >
        <MessageCircle className="size-5" />
      </Button>
    );
  }

  // A single wrapper element hosts `AssistantChat` for both modes: only its
  // className changes between "bubble" and "panel". Because it stays the
  // same element at the same position in the tree, React updates it in
  // place instead of unmounting/remounting `AssistantChat` — which would
  // wipe the conversation the user is in the middle of. Do not split this
  // into two branches that each render their own `AssistantChat`.
  //
  // z-60 and pointer-events-auto keep the assistant reachable while a
  // task sheet/dialog is open: those are modal, rendered at z-50 behind a
  // full-viewport backdrop that would otherwise intercept every click at
  // this element's position even though it stays visually on top.
  return (
    <div
      ref={panelRef}
      className={cn(
        "pointer-events-auto fixed z-60 flex flex-col overflow-hidden border border-border bg-card shadow-xl",
        mode === "bubble"
          ? "right-4 bottom-4 h-[min(600px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] rounded-xl"
          : "inset-y-0 right-0 w-full rounded-none border-y-0 border-r-0 sm:w-105 sm:border-l",
      )}
      style={
        mode === "bubble" && panelDrag.position
          ? {
              left: panelDrag.position.x,
              top: panelDrag.position.y,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2",
          mode === "bubble" && "touch-none",
          mode === "bubble" && panelDrag.isDragging
            ? "cursor-grabbing"
            : mode === "bubble" && "cursor-grab",
        )}
        role="toolbar"
        aria-label={mode === "bubble" ? t("assistant:dragHandle") : undefined}
        {...(mode === "bubble" ? panelDrag.dragHandleProps : undefined)}
      >
        <MessageCircle
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              setMode((prev) => (prev === "bubble" ? "panel" : "bubble"))
            }
            aria-label={t(
              mode === "bubble" ? "assistant:expand" : "assistant:collapse",
            )}
          >
            {mode === "bubble" ? (
              <Maximize2 className="size-4" />
            ) : (
              <Minimize2 className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsOpen(false)}
            aria-label={t("assistant:close")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <AssistantChat
        workspaceId={workspaceId}
        projectId={projectId}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default AssistantLauncher;
