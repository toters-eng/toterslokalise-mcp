export const DEFAULT_API_ORIGIN = 'https://arcade.stage.toters-api.com/toters-lokalise';

export function resolveApiOrigin(
  environment: Record<string, string | undefined> = process.env,
): string {
  const configured = environment.TOTERSLOKALISE_API_ORIGIN?.trim();
  if (!configured) {
    return DEFAULT_API_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      `TOTERSLOKALISE_API_ORIGIN must be an absolute http(s) URL. Received "${configured}".`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `TOTERSLOKALISE_API_ORIGIN must use http or https. Received "${configured}".`,
    );
  }
  return configured.replace(/\/+$/u, '');
}
