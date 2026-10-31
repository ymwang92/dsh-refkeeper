/**
 * Lossless command payload encoding shared by the composer panel.
 *
 * The command line is whitespace/quote tokenized by the host, so JSON cannot be
 * embedded verbatim: a payload containing `'` or `"` would either break the
 * tokenizer or force a lossy rewrite of the field text. Base64url sidesteps the
 * grammar entirely — every byte of the field survives the round trip.
 */

const BASE64URL: Record<string, string> = { '+': '-', '/': '_' }

/** Encode a JSON value as `<name>=<base64url>`; safe for any command text. */
export function encodeFlag(name: string, value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary).replace(/[+/]/gu, (char) => BASE64URL[char] ?? char)
  return `--${name}=${base64.replace(/=+$/u, '')}`
}

/** Encode a JSON payload as `--payload=<base64url>`, safe for any command text. */
export function payloadFlag(value: unknown): string {
  return encodeFlag('payload', value)
}
