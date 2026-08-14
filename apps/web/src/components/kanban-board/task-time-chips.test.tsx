import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskTimeChips } from "./task-time-chips";

afterEach(() => {
  cleanup();
});

describe("TaskTimeChips", () => {
  it("renders tracked time and estimate when both are present", () => {
    render(<TaskTimeChips trackedSeconds={3600} estimatedSeconds={5400} />);

    expect(screen.getByText("1h 0m")).toBeVisible();
    expect(screen.getByText("1h 30m")).toBeVisible();
  });

  it("renders neither chip when both values are absent", () => {
    const { container } = render(
      <TaskTimeChips trackedSeconds={null} estimatedSeconds={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders neither chip when both values are zero", () => {
    const { container } = render(
      <TaskTimeChips trackedSeconds={0} estimatedSeconds={0} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders only the tracked chip when only tracked time is present", () => {
    render(<TaskTimeChips trackedSeconds={90} estimatedSeconds={null} />);

    expect(screen.getByText("1m")).toBeVisible();
    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}$/)).not.toBeInTheDocument();
  });

  it("renders only the estimate chip when only the estimate is present", () => {
    render(<TaskTimeChips trackedSeconds={undefined} estimatedSeconds={60} />);

    expect(screen.getByText("1m")).toBeVisible();
    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}$/)).not.toBeInTheDocument();
  });
});
