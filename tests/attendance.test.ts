/**
 * 勤怠計算の境界値回帰テスト（丸め・要確認判定・集計・深夜）
 * 実行: npm run test
 * ドメインルールの根拠: docs/DOMAIN_MAP.md / DOMAIN_REFERENCE.md
 */
import { describe, it, expect } from "vitest"
import { applyRounding, calcNeedsReview, calcMetrics, calcNightMinutes } from "../lib/attendance"

/** JST の時刻を UTC Date に変換するヘルパ */
function jst(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000)
}

describe("applyRounding（打刻丸め）", () => {
  const START = "08:30"
  const END   = "17:30"
  // 出勤側・退勤側の設定プリセット
  const IN_NEAR   = { roundEarly: false, roundNear: true,  kind: "in"  } as const
  const IN_EARLY  = { roundEarly: true,  roundNear: false, kind: "in"  } as const
  const OUT_NEAR  = { roundEarly: false, roundNear: true,  kind: "out" } as const

  it("定時前丸めON: 8:15 → 8:30", () => {
    expect(applyRounding(jst(2026, 7, 6, 8, 15), START, IN_EARLY))
      .toEqual(jst(2026, 7, 6, 8, 30))
  })

  it("TZ回帰: JST深夜 0:30 の打刻でも丸めが効く（UTC前日問題）", () => {
    // 過去バグ: getUTCDate() 先行で JST 0:00〜8:59 の基準日が1日ズレ丸め不発
    expect(applyRounding(jst(2026, 7, 6, 0, 30), START, IN_EARLY))
      .toEqual(jst(2026, 7, 6, 8, 30))
  })

  it("出勤・近傍丸めON: 定時前14分 8:16 → 8:30（境界内）", () => {
    expect(applyRounding(jst(2026, 7, 6, 8, 16), START, IN_NEAR))
      .toEqual(jst(2026, 7, 6, 8, 30))
  })

  it("出勤・近傍丸めON: 定時ちょうど 8:30 は 8:30（境界）", () => {
    expect(applyRounding(jst(2026, 7, 6, 8, 30), START, IN_NEAR))
      .toEqual(jst(2026, 7, 6, 8, 30))
  })

  it("出勤・近傍丸めON: 定時後14分 8:44 は丸めない（遅刻を消さない）", () => {
    // 旧仕様は前後対称で 8:30 に丸めていた（遅刻が消える不具合）
    expect(applyRounding(jst(2026, 7, 6, 8, 44), START, IN_NEAR))
      .toEqual(jst(2026, 7, 6, 8, 44))
  })

  it("出勤・近傍丸めON: 定時前15分 8:15 は丸めない（境界外・roundEarly OFF時）", () => {
    expect(applyRounding(jst(2026, 7, 6, 8, 15), START, IN_NEAR))
      .toEqual(jst(2026, 7, 6, 8, 15))
  })

  it("退勤・近傍丸めON: 定時後14分 17:44 → 17:30 / 定時後15分 17:45 は生時刻", () => {
    expect(applyRounding(jst(2026, 7, 6, 17, 44), END, OUT_NEAR))
      .toEqual(jst(2026, 7, 6, 17, 30))
    expect(applyRounding(jst(2026, 7, 6, 17, 45), END, OUT_NEAR))
      .toEqual(jst(2026, 7, 6, 17, 45))
  })

  it("退勤・近傍丸めON: 定時前 17:20 は丸めない（早退を消さない）", () => {
    // 旧仕様は前後対称で 17:30 に丸めていた（早退が消える不具合）
    expect(applyRounding(jst(2026, 7, 6, 17, 20), END, OUT_NEAR))
      .toEqual(jst(2026, 7, 6, 17, 20))
  })

  it("両スイッチOFF・定時未設定は生時刻のまま", () => {
    const raw = jst(2026, 7, 6, 8, 10)
    expect(applyRounding(raw, START, { roundEarly: false, roundNear: false, kind: "in" })).toEqual(raw)
    expect(applyRounding(raw, null, { roundEarly: true, roundNear: true, kind: "in" })).toEqual(raw)
  })
})

describe("calcNeedsReview（要確認判定）", () => {
  const base = {
    workStartTime: "09:00",
    workEndTime: "17:30",
    today: new Date(Date.UTC(2026, 6, 6)), // 2026-07-06
  }
  const yesterday = new Date(Date.UTC(2026, 6, 5))
  const today = new Date(Date.UTC(2026, 6, 6))

  it("遅刻 9:02（許容+1分超）→ 要確認（当日でも）", () => {
    expect(calcNeedsReview({ ...base, date: today, clockIn: jst(2026, 7, 6, 9, 2), clockOut: null })).toBe(true)
  })

  it("9:01（許容+1分以内）→ 問題なし", () => {
    expect(calcNeedsReview({ ...base, date: today, clockIn: jst(2026, 7, 6, 9, 1), clockOut: null })).toBe(false)
  })

  it("当日・退勤未打刻 → 問題なし", () => {
    expect(calcNeedsReview({ ...base, date: today, clockIn: jst(2026, 7, 6, 9, 0), clockOut: null })).toBe(false)
  })

  it("昨日以前・退勤未打刻 → 要確認", () => {
    expect(calcNeedsReview({ ...base, date: yesterday, clockIn: jst(2026, 7, 5, 9, 0), clockOut: null })).toBe(true)
  })

  it("昨日以前・早退 17:28（許容-1分超）→ 要確認 / 17:29 → 問題なし", () => {
    expect(calcNeedsReview({ ...base, date: yesterday, clockIn: jst(2026, 7, 5, 9, 0), clockOut: jst(2026, 7, 5, 17, 28) })).toBe(true)
    expect(calcNeedsReview({ ...base, date: yesterday, clockIn: jst(2026, 7, 5, 9, 0), clockOut: jst(2026, 7, 5, 17, 29) })).toBe(false)
  })

  it("出勤打刻なし → 判定対象外", () => {
    expect(calcNeedsReview({ ...base, date: yesterday, clockIn: null, clockOut: null })).toBe(false)
  })
})

describe("calcMetrics（遅刻・早退・残業）", () => {
  const base = { workStartTime: "09:00", workEndTime: "17:30", scheduledMinutes: 480 }

  it("遅刻10分・早退30分・残業20分", () => {
    expect(calcMetrics({ ...base, clockIn: jst(2026, 7, 6, 9, 10), clockOut: null, workingMinutes: null }).lateMinutes).toBe(10)
    expect(calcMetrics({ ...base, clockIn: null, clockOut: jst(2026, 7, 6, 17, 0), workingMinutes: null }).earlyLeaveMinutes).toBe(30)
    expect(calcMetrics({ ...base, clockIn: null, clockOut: null, workingMinutes: 500 }).overtimeMinutes).toBe(20)
  })

  it("定時後退勤は早退0（残業扱い）", () => {
    expect(calcMetrics({ ...base, clockIn: null, clockOut: jst(2026, 7, 6, 18, 0), workingMinutes: null }).earlyLeaveMinutes).toBe(0)
  })
})

describe("calcNightMinutes（深夜 22:00〜翌5:00）", () => {
  it("21:00〜23:00 → 60分", () => {
    expect(calcNightMinutes(jst(2026, 7, 6, 21, 0), jst(2026, 7, 6, 23, 0))).toBe(60)
  })
  it("4:00〜6:00 → 60分（早朝側）", () => {
    expect(calcNightMinutes(jst(2026, 7, 6, 4, 0), jst(2026, 7, 6, 6, 0))).toBe(60)
  })
  it("9:00〜17:30 → 0分", () => {
    expect(calcNightMinutes(jst(2026, 7, 6, 9, 0), jst(2026, 7, 6, 17, 30))).toBe(0)
  })
})
