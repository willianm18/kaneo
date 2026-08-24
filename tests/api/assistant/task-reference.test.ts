import { describe, expect, it } from "vitest";

import { parseTaskNumberReference } from "../../../apps/api/src/assistant/task-reference";

describe("parseTaskNumberReference", () => {
  it("reconhece o numero do chamado passado no lugar do id", () => {
    expect(parseTaskNumberReference("29")).toBe(29);
    expect(parseTaskNumberReference("#29")).toBe(29);
    expect(parseTaskNumberReference(" 7 ")).toBe(7);
  });

  it("reconhece a referencia no formato slug-numero", () => {
    expect(parseTaskNumberReference("MC-29")).toBe(29);
    expect(parseTaskNumberReference("man-3")).toBe(3);
  });

  it("nao mexe num id de verdade", () => {
    expect(parseTaskNumberReference("djcc221f2sfdeq7od72e5lzg")).toBeNull();
    expect(parseTaskNumberReference("nqvxy76c7ifcx1za1h9jpat1")).toBeNull();
  });

  it("ignora valor vazio ou sem numero", () => {
    expect(parseTaskNumberReference("")).toBeNull();
    expect(parseTaskNumberReference("   ")).toBeNull();
    expect(parseTaskNumberReference("abc")).toBeNull();
  });
});
