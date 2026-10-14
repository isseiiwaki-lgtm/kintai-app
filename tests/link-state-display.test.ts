/**
 * 紐づけ画面がブラウザで state を読めること（Buffer を使わない。2026-10-14 急ぎの修正）
 */
import { describe, it, expect } from "vitest"
import { decodeLinkStateBody } from "../lib/link-state-display"
import { signLinkState } from "../lib/link-state"

describe("decodeLinkStateBody", () => {
  it("署名付き state の本体を、日本語の氏名を含めて読める", () => {
    const signed = signLinkState({ pendingUserId: "", googleEmail: "watanabe.ippc@gmail.com", providerAccountId: "1", name: "渡邉奈穂", image: "" }, "secret")
    const s = decodeLinkStateBody<{ googleEmail: string; name: string }>(signed)
    expect(s?.googleEmail).toBe("watanabe.ippc@gmail.com")
    expect(s?.name).toBe("渡邉奈穂")
  })
  it("ブラウザと同じく Buffer が無くても読める", () => {
    const signed = signLinkState({ pendingUserId: "", googleEmail: "a@example.com", providerAccountId: "1", name: "", image: "" }, "secret")
    const saved = globalThis.Buffer
    // @ts-expect-error ブラウザを模して Buffer を消す
    delete globalThis.Buffer
    try {
      expect(decodeLinkStateBody<{ googleEmail: string }>(signed)?.googleEmail).toBe("a@example.com")
    } finally {
      globalThis.Buffer = saved
    }
  })
  it("壊れた state は null", () => {
    expect(decodeLinkStateBody("!!!")).toBeNull()
    expect(decodeLinkStateBody("")).toBeNull()
  })
})
