import { afterEach, describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "../../../apps/api/src/utils/resolve-api-base-url";

describe("resolveApiBaseUrl", () => {
  const originalEnv = process.env.KANEO_API_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.KANEO_API_URL;
    } else {
      process.env.KANEO_API_URL = originalEnv;
    }
  });

  it("strips a trailing /api from the owner's literal production value", () => {
    // KANEO_API_URL=https://kaneo.willianramthun.store/api in production.
    // Without the strip, tools would request /api/api/... and 404.
    expect(resolveApiBaseUrl("https://example.com/api")).toBe(
      "https://example.com",
    );
  });

  it("strips a trailing /api/ (with slash)", () => {
    expect(resolveApiBaseUrl("https://example.com/api/")).toBe(
      "https://example.com",
    );
  });

  it("leaves a URL without a trailing /api untouched", () => {
    expect(resolveApiBaseUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("falls back to the localhost default when unset", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("http://localhost:1337");
    expect(resolveApiBaseUrl("")).toBe("http://localhost:1337");
  });

  it("reads process.env.KANEO_API_URL when called with no argument", () => {
    process.env.KANEO_API_URL = "https://kaneo.willianramthun.store/api";
    expect(resolveApiBaseUrl()).toBe("https://kaneo.willianramthun.store");
  });

  it("does not touch /api in the middle of a path, only a trailing one", () => {
    expect(resolveApiBaseUrl("https://example.com/api/v2")).toBe(
      "https://example.com/api/v2",
    );
  });
});
