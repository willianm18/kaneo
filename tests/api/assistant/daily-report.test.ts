import { describe, expect, it } from "vitest";

import {
  buildDailyReportTitle,
  isShiftReport,
} from "../../../apps/api/src/assistant/shift-report";

describe("buildDailyReportTitle", () => {
  it("usa a data do dia, para haver um card por dia", () => {
    expect(buildDailyReportTitle(new Date("2026-08-24T13:00:00"))).toBe(
      "Report diário — 24/08/2026",
    );
  });

  it("mantem o mesmo titulo para horas diferentes do mesmo dia", () => {
    expect(buildDailyReportTitle(new Date("2026-08-24T08:00:00"))).toBe(
      buildDailyReportTitle(new Date("2026-08-24T19:30:00")),
    );
  });
});

describe("isShiftReport", () => {
  it("vale mesmo quando o relato tem um assunto so", () => {
    expect(isShiftReport("report do dia: ajustei o portal do Gustavo")).toBe(
      true,
    );
  });
});
