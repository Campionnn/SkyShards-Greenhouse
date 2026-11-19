// Discord component embeds: a link preview built from message components
// (https://docs.discord.com/developers/link-previews/component-embeds).
// The page carries `<script id="discord:component-embed" type="application/json">`
// in its <head>; Discord shows it instead of the Open Graph card, and falls
// back to the OG tags whenever the payload is invalid.
//
// Rules this module enforces (validateComponentEmbed):
//   - exactly one top-level Container (17), no nested Containers,
//   - only Action Row 1, Button 2, Section 9, Text Display 10, Thumbnail 11,
//     Media Gallery 12, Separator 14 inside it,
//   - buttons are link buttons (style 5) with only id/type/url/style/label/emoji/disabled,
//   - at most 40 components in total (the Container included),
//   - at most 10 Media Gallery items across the embed,
//   - at most 3,000 bytes of JSON, escapes counted at full length.
//
// Pure and dependency-free: the build (src/wiki/staticPages.ts), the tests and
// the Cloudflare Pages Functions (functions/) all import it.

export const EMBED_SCRIPT_ID = "discord:component-embed";
export const EMBED_MAX_BYTES = 3000;
export const EMBED_MAX_COMPONENTS = 40;
export const EMBED_MAX_GALLERY_ITEMS = 10;
/** Design-system "go" emerald (0x10B981) as Discord's integer colour. */
export const EMBED_ACCENT = 0x10b981;

export interface UnfurledMedia {
  url: string;
}

export interface TextDisplay {
  type: 10;
  content: string;
}

export interface Thumbnail {
  type: 11;
  media: UnfurledMedia;
  description?: string;
}

export interface LinkButton {
  type: 2;
  style: 5;
  url: string;
  label: string;
}

export interface Section {
  type: 9;
  components: TextDisplay[];
  accessory: Thumbnail | LinkButton;
}

export interface MediaGallery {
  type: 12;
  items: { media: UnfurledMedia; description?: string }[];
}

export interface Separator {
  type: 14;
  divider?: boolean;
  spacing?: 1 | 2;
}

export interface ActionRow {
  type: 1;
  components: LinkButton[];
}

export type ContainerChild = TextDisplay | Section | MediaGallery | Separator | ActionRow;

export interface Container {
  type: 17;
  accent_color?: number;
  components: ContainerChild[];
}

export interface ComponentEmbedPayload {
  component: Container;
}

// ---------------------------------------------------------------- builders

export const text = (content: string): TextDisplay => ({ type: 10, content });

export const thumbnail = (url: string, description?: string): Thumbnail =>
  description ? { type: 11, media: { url }, description } : { type: 11, media: { url } };

export const linkButton = (label: string, url: string): LinkButton => ({ type: 2, style: 5, url, label });

export const section = (content: string | string[], accessory: Thumbnail | LinkButton): Section => ({
  type: 9,
  components: (Array.isArray(content) ? content : [content]).map(text),
  accessory,
});

export const gallery = (items: { url: string; description?: string }[]): MediaGallery => ({
  type: 12,
  items: items.map(({ url, description }) => (description ? { media: { url }, description } : { media: { url } })),
});

export const separator = (): Separator => ({ type: 14, divider: true, spacing: 1 });

export const buttons = (list: LinkButton[]): ActionRow => ({ type: 1, components: list });

export const container = (components: ContainerChild[], accent: number = EMBED_ACCENT): Container => ({
  type: 17,
  accent_color: accent,
  components,
});

// ------------------------------------------------------------- markdown

/** Escapes Discord markdown so item names can't open formatting or links. */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_~`|[\]<>]/g, (char) => `\\${char}`).replace(/^([#>-])/, "\\$1");
}

/** `[label](url)` with the label escaped. */
export function mdLink(label: string, url: string): string {
  return `[${escapeMarkdown(label)}](${url})`;
}

/**
 * Joins items with ", " and replaces everything past `max` with "+ N more".
 * `max` counts the shown items; a tail of exactly one item is shown rather than "+ 1 more".
 */
export function truncatedList(items: string[], max: number): string {
  if (items.length <= max + 1) return items.join(", ");
  return `${items.slice(0, max).join(", ")} + ${items.length - max} more`;
}

// ------------------------------------------------------------ serializing

/**
 * The JSON that goes inside the <script>. `<`, `>` and `&` become \u003c,
 * \u003e and \u0026 so the text can never close the script element; Discord
 * counts those escapes at full length, so the size check runs on this string.
 */
export function serializeComponentEmbed(component: Container): string {
  return JSON.stringify({ component }).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The full <script> element for the given serialized payload. */
export function componentEmbedScript(json: string): string {
  return `<script id="${EMBED_SCRIPT_ID}" type="application/json">${json}</script>`;
}

/**
 * The <script> for a component, or null when the payload breaks a rule (the
 * page then keeps only its Open Graph tags, which Discord shows instead).
 */
export function componentEmbedScriptFor(component: Container): string | null {
  const json = serializeComponentEmbed(component);
  return validateComponentEmbed({ component }, json).length === 0 ? componentEmbedScript(json) : null;
}

// ------------------------------------------------------------- validation

const CHILD_TYPES = new Set([1, 9, 10, 12, 14]);
const BUTTON_KEYS = new Set(["id", "type", "url", "style", "label", "emoji", "disabled"]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const isHttpUrl = (value: unknown): boolean =>
  typeof value === "string" && value.length <= 2048 && /^https?:\/\/[^\s]+$/.test(value);

/**
 * Every rule the payload breaks, empty when Discord should accept it. Works on
 * untrusted JSON too (the Pages Function checks API payloads with it).
 * `json` is the serialized form to size; it defaults to serializeComponentEmbed's.
 */
export function validateComponentEmbed(payload: unknown, json?: string): string[] {
  const errors: string[] = [];
  if (!isObject(payload) || Object.keys(payload).length !== 1 || !("component" in payload)) {
    return ["payload must be exactly {component}"];
  }
  const root = payload.component;
  if (!isObject(root) || root.type !== 17 || !Array.isArray(root.components)) {
    return ["component must be a Container (type 17) with components"];
  }
  if (root.accent_color !== undefined && root.accent_color !== null && !Number.isInteger(root.accent_color)) {
    errors.push("accent_color must be an integer");
  }

  let count = 1;
  let galleryItems = 0;

  const checkMedia = (media: unknown, where: string) => {
    if (!isObject(media) || !isHttpUrl(media.url)) errors.push(`${where}: media.url must be an http(s) URL`);
  };
  const checkText = (value: unknown, where: string) => {
    count++;
    if (!isObject(value) || value.type !== 10 || typeof value.content !== "string" || value.content.length === 0) {
      errors.push(`${where}: expected a non-empty Text Display`);
    }
  };
  const checkButton = (value: unknown, where: string) => {
    count++;
    if (!isObject(value) || value.type !== 2) return errors.push(`${where}: expected a Button`);
    for (const key of Object.keys(value)) if (!BUTTON_KEYS.has(key)) errors.push(`${where}: button key "${key}" is not allowed`);
    if (value.style !== 5) errors.push(`${where}: buttons must be link buttons (style 5)`);
    if (!isHttpUrl(value.url)) errors.push(`${where}: button url must be an http(s) URL`);
    if (!value.label && !value.emoji) errors.push(`${where}: button needs a label or an emoji`);
    if (typeof value.label === "string" && value.label.length > 80) errors.push(`${where}: button label over 80 characters`);
  };

  root.components.forEach((child: unknown, i: number) => {
    const where = `components[${i}]`;
    count++;
    if (!isObject(child) || !CHILD_TYPES.has(child.type as number)) {
      errors.push(`${where}: type ${isObject(child) ? String(child.type) : "?"} is not allowed in a component embed`);
      return;
    }
    switch (child.type) {
      case 10:
        count--; // checkText counts it
        checkText(child, where);
        break;
      case 9: {
        const texts = Array.isArray(child.components) ? child.components : [];
        if (texts.length < 1 || texts.length > 3) errors.push(`${where}: a Section holds 1-3 Text Displays`);
        texts.forEach((t: unknown, j: number) => checkText(t, `${where}.components[${j}]`));
        const accessory = child.accessory;
        if (isObject(accessory) && accessory.type === 11) {
          count++;
          checkMedia(accessory.media, `${where}.accessory`);
        } else {
          checkButton(accessory, `${where}.accessory`);
        }
        break;
      }
      case 12: {
        const items = Array.isArray(child.items) ? child.items : [];
        if (items.length < 1) errors.push(`${where}: a Media Gallery needs items`);
        galleryItems += items.length;
        items.forEach((item: unknown, j: number) => checkMedia(isObject(item) ? item.media : null, `${where}.items[${j}]`));
        break;
      }
      case 14:
        break;
      case 1: {
        const row = Array.isArray(child.components) ? child.components : [];
        if (row.length < 1 || row.length > 5) errors.push(`${where}: an Action Row holds 1-5 buttons`);
        row.forEach((b: unknown, j: number) => checkButton(b, `${where}.components[${j}]`));
        break;
      }
    }
  });

  if (count > EMBED_MAX_COMPONENTS) errors.push(`${count} components (max ${EMBED_MAX_COMPONENTS})`);
  if (galleryItems > EMBED_MAX_GALLERY_ITEMS) errors.push(`${galleryItems} media gallery items (max ${EMBED_MAX_GALLERY_ITEMS})`);
  if (errors.length === 0) {
    const bytes = utf8Bytes(json ?? serializeComponentEmbed(root as unknown as Container));
    if (bytes > EMBED_MAX_BYTES) errors.push(`${bytes} bytes (max ${EMBED_MAX_BYTES})`);
  }
  return errors;
}

/** Total number of components (the Container included), as Discord counts them. */
export function countComponents(component: Container): number {
  let count = 1;
  for (const child of component.components) {
    count++;
    if (child.type === 9) count += child.components.length + 1;
    if (child.type === 1) count += child.components.length;
  }
  return count;
}
