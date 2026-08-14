import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskTitle from "./task-title";

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  updateTaskTitle: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => mocks.getTask(),
}));
vi.mock("@/hooks/mutations/task/use-update-task-title", () => ({
  useUpdateTaskTitle: () => ({ mutateAsync: mocks.updateTaskTitle }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageTasks: () => true }),
}));

const longTitle =
  "This is a very long task title that should wrap onto multiple lines instead of being clipped or scrolling horizontally when rendered in the task detail header";

beforeEach(() => {
  mocks.getTask.mockReturnValue({
    data: { id: "task-1", title: "Initial title" },
  });
  mocks.updateTaskTitle.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskTitle", () => {
  it("renders a wrapping textarea (not a single-line input) for long titles", () => {
    mocks.getTask.mockReturnValue({
      data: { id: "task-1", title: longTitle },
    });

    render(<TaskTitle taskId="task-1" />);

    const field = screen.getByPlaceholderText("tasks:detail.titlePlaceholder");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveValue(longTitle);
    expect(field.className).toContain("resize-none");
    expect(field).not.toHaveAttribute("type", "text");
  });

  it("does not insert a newline when Enter is pressed, and blurs instead", () => {
    render(<TaskTitle taskId="task-1" />);

    const field = screen.getByPlaceholderText(
      "tasks:detail.titlePlaceholder",
    ) as HTMLTextAreaElement;

    field.focus();
    expect(field).toHaveFocus();

    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

    expect(field.value).not.toContain("\n");
    expect(field).not.toHaveFocus();
  });

  it("collapses a pasted multi-line string into a single line", () => {
    render(<TaskTitle taskId="task-1" />);

    const field = screen.getByPlaceholderText(
      "tasks:detail.titlePlaceholder",
    ) as HTMLTextAreaElement;

    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);

    const pastedText = "line one\nline two\r\nline three";

    fireEvent.paste(field, {
      clipboardData: {
        getData: () => pastedText,
      },
    });

    expect(field.value).not.toContain("\n");
    expect(field.value).not.toContain("\r");
    expect(field.value).toBe("Initial titleline one line two line three");
  });
});
