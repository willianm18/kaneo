import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskRow from "./task-row";

const useExternalLinks = vi.fn((_taskId: string) => ({ data: [] }));
const useGetLabelsByTask = vi.fn((_taskId: string) => ({ data: [] }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/queries/external-link/use-external-links", () => ({
  default: (taskId: string) => useExternalLinks(taskId),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: (taskId: string) => useGetLabelsByTask(taskId),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock(
  "../kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({ default: () => null }),
);

vi.mock("@/store/bulk-selection", () => ({
  default: () => ({
    toggleSelection: vi.fn(),
    isSelected: () => false,
    isFocused: () => false,
  }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({ project: { id: "project-1", slug: "kan" } }),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({
    showAssignees: true,
    showDueDates: true,
    showLabels: true,
    showTaskNumbers: true,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const task: Task = {
  id: "task-1",
  title: "Row from payload",
  number: 7,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  completedAt: null,
  position: 1,
  createdAt: "2026-08-05T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  labels: [{ id: "label-1", name: "Bug", color: "red" }],
  externalLinks: [
    {
      id: "link-1",
      taskId: "task-1",
      integrationId: "integration-1",
      resourceType: "pull_request",
      externalId: "42",
      url: "https://github.com/o/r/pull/42",
      title: "Fix it",
      metadata: { merged: false, draft: false },
    },
  ],
};

describe("TaskRow", () => {
  it("renders labels and pull requests from the task payload without per-row requests", () => {
    render(<TaskRow task={task} projectSlug="kan" />);

    expect(screen.getByText("Bug")).toBeVisible();
    expect(screen.getByText("#42")).toBeVisible();
    expect(useExternalLinks).not.toHaveBeenCalled();
    expect(useGetLabelsByTask).not.toHaveBeenCalled();
  });

  it("renders tracked time and estimate chips when present", () => {
    render(
      <TaskRow
        task={{ ...task, trackedSeconds: 3600, estimatedSeconds: 5400 }}
        projectSlug="kan"
      />,
    );

    expect(screen.getByText("1h 0m")).toBeVisible();
    expect(screen.getByText("1h 30m")).toBeVisible();
  });

  it("renders neither chip when tracked time and estimate are absent", () => {
    render(<TaskRow task={task} projectSlug="kan" />);

    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+h( \d+m)?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+m$/)).not.toBeInTheDocument();
  });

  it("shows the completion date when completedAt is present", () => {
    render(
      <TaskRow
        task={{ ...task, completedAt: "2026-08-09T12:00:00.000Z" }}
        projectSlug="kan"
      />,
    );

    expect(screen.getByText("Aug 9")).toBeVisible();
    expect(screen.getByTitle("tasks:popover.completedAt.label")).toBeVisible();
  });

  it("renders no completion element when completedAt is absent", () => {
    render(<TaskRow task={task} projectSlug="kan" />);

    expect(
      screen.queryByTitle("tasks:popover.completedAt.label"),
    ).not.toBeInTheDocument();
  });
});
