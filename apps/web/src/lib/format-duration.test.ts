import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationCompact } from "./format-duration";

describe("formatDuration", () => {
  it("formats seconds as HH:MM:SS, including while a timer is running", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(59)).toBe("00:00:59");
    expect(formatDuration(3661)).toBe("01:01:01");
  });
});

describe("formatDurationCompact", () => {
  it("shows hours and minutes once an hour or more has been tracked", () => {
    expect(formatDurationCompact(8100)).toBe("2h 15m");
  });

  it("shows only minutes under an hour", () => {
    expect(formatDurationCompact(2700)).toBe("45m");
  });

  it("shows seconds under a minute so a few tracked seconds aren't shown as nothing", () => {
    expect(formatDurationCompact(30)).toBe("30s");
  });

  it("shows 0m when nothing was tracked", () => {
    expect(formatDurationCompact(0)).toBe("0m");
  });
});
