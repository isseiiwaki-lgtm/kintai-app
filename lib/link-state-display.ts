/**
 * 紐づけ画面（/link）が表示用に state の本体を読む（ブラウザで動く。署名の検証はサーバー側の lib/link-state.ts）。
 * ブラウザには Buffer が無いので atob と TextDecoder で読む（氏名などの日本語を壊さない）。
 */
export function decodeLinkStateBody<T>(signedState: string): T | null {
  try {
    const body = signedState.split(".")[0]
    if (!body) return null
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}
