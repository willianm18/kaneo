const API_SUFFIX_PATTERN = /\/api\/?$/;
const DEFAULT_API_BASE_URL = "http://localhost:1337";

/**
 * Normalizes KANEO_API_URL (or any raw base URL) into the origin internal
 * HTTP clients should target. Tool clients such as `ApiClient` append paths
 * that already start with `/api/...`, so a trailing `/api` segment on the
 * configured base URL must be stripped here — otherwise every request
 * doubles up as `/api/api/...` and 404s.
 *
 * This mirrors the production configuration
 * (KANEO_API_URL=https://kaneo.willianramthun.store/api), which resolves
 * to https://kaneo.willianramthun.store.
 */
export function resolveApiBaseUrl(
  rawUrl: string | undefined = process.env.KANEO_API_URL,
): string {
  return (rawUrl || DEFAULT_API_BASE_URL).replace(API_SUFFIX_PATTERN, "");
}
