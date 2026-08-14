import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskCard from "./task-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
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

vi.mock("./task-card-context-menu/task-card-context-menu-content", () => ({
  default: () => null,
}));

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
    showPriority: true,
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
  title: "Card from payload",
  number: 7,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  completedAt: null,
  estimatedSeconds: null,
  trackedSeconds: null,
  position: 1,
  createdAt: "2026-08-05T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  labels: [],
  externalLinks: [],
};

describe("TaskCard", () => {
  it("shows the completion date when completedAt is present", () => {
    render(
      <TaskCard task={{ ...task, completedAt: "2026-08-09T12:00:00.000Z" }} />,
    );

    expect(screen.getByText("Aug 9")).toBeVisible();
    expect(screen.getByTitle("tasks:popover.completedAt.label")).toBeVisible();
  });

  it("renders no completion element when completedAt is absent", () => {
    render(<TaskCard task={task} />);

    expect(
      screen.queryByTitle("tasks:popover.completedAt.label"),
    ).not.toBeInTheDocument();
  });
});
