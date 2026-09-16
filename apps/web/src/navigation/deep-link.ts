const appUrlSchemes = new Set(["com.tuapp:", "com.travellier.app:"]);

export function resolveDeepLinkUrl(url: string): string | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (!appUrlSchemes.has(parsedUrl.protocol) || parsedUrl.hostname.length === 0) {
    return null;
  }

  return `/${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}
