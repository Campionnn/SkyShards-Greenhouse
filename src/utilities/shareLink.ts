/** Share links for layouts (`https://api.skyshards.com/share/<code>`), used by the Calculator and Designer. */

export const SHARE_BASE_URL = "https://api.skyshards.com/share";

/** The share URL of an encoded layout. */
export function shareUrlFor(code: string): string {
  return `${SHARE_BASE_URL}/${code}`;
}

/**
 * Copies a layout's share link to the clipboard and asks the API to pre-render its share image,
 * so it is ready when Discord crawls the link. Rejects when the clipboard write fails.
 */
export async function copyShareLink(code: string): Promise<string> {
  const url = shareUrlFor(code);
  await navigator.clipboard.writeText(url);
  fetch(`${SHARE_BASE_URL}/prepare?layout=${code}`, { method: "POST" }).catch((err) => {
    // Non-fatal: the image is generated on demand.
    console.warn("Failed to pre-generate share image:", err);
  });
  return url;
}
