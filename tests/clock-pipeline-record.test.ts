/**
 * 打刻パイプラインの DB 側の入口（lib/clock-pipeline-db.ts）
 * - 入力が変わったとき（申請の承認・取り消し・修正、打刻修正、承認）に、同じ計算で最初から出し直す
 * - 記録に保存したスイッチ状態を使う（遡及しない）・LOCKED は計算し直さない
 * prisma をモックして、update へ渡るデータを確認する
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recordFind: vi.fn(),
  update: vi.fn((args: unknown) => args),
  userFind: vi.fn(),
  settingFind: vi.fn(),
  holidayFindMany: vi.fn(),
  requestFindMany: vi.fn(),
  logFindMany: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findUnique: mocks.recordFind, update: mocks.update },
    user: { findUnique: mocks.userFind },
    setting: { findUnique: mocks.settingFind },
    holiday: { findMany: mocks.holidayFindMany },
    request: { findMany: mocks.requestFindMany },
    attendanceChangeLog: { findMany: mocks.logFindMany },
    $transaction: mocks.transaction,
  },
}))

import { buildRecordUpdate, recomputeDay, recomputeRecords, type PipelineContext } from "../lib/clock-pipeline-db"
import { DATE, hm, jst } from "./helpers/pipeline"

type RecordRow = Parameters<typeof buildRecordUpdate>[0]
type Data = Record<string, unknown>

const USER = {
  workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null,
  workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false,
}
const SETTING = {
  id: 1, closingDay: 25, break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: true, capOvertimeByRequest: true,
  lunchStartTime: "12:00", legalHolidayWeekday: 0, weekStartDay: 0,
}

/** 19:51 に退勤打刻した日（③④ON で保存。申請が無かったので記録は定時 17:30 に頭打ち済み） */
function rec(over: Record<string, unknown> = {}): RecordRow {
  return {
    id: "r1", userId: "u1", date: DATE, status: "OPEN", isHolidayWork: false, isAbsent: false,
    clockIn: jst(9, 0), clockOut: jst(17, 30), rawClockIn: jst(9, 0), rawClockOut: jst(19, 51),
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null,
    lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, workingMinutes: null,
    switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: true, switchCapOvertime: true,
    ...over,
  } as unknown as RecordRow
}

function ctx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    user: USER,
    setting: SETTING as unknown as PipelineContext["setting"],
    holidayKeys: new Set(),
    requests: [],
    logs: [],
    ...over,
  }
}

const approved = (endTime: string) => ({
  type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-05T10:00:00Z"), detail: { endTime }, targetDate: DATE,
})

function build(r: RecordRow, c: PipelineContext, opts = {}) {
  const built = buildRecordUpdate(r, c, opts)
  return built ? { ...built, data: built.data as Data } : null
}

describe("buildRecordUpdate：申請の承認・取り消しで同じ計算を最初からやり直す", () => {
  it("退勤後に残業申請（19:30）が承認された → 記録時刻 19:30・勤務時間 570・残業 120（終業後のみ）", () => {
    const r = build(rec(), ctx({ requests: [approved("19:30")] }))!
    expect(hm(r.data.clockOut as Date)).toBe("19:30")
    expect(r.data.workingMinutes).toBe(570)  // 9:00〜19:30 の拘束630 − 法定休憩60
    expect(r.data.overtimeMinutes).toBe(120) // 段8：記録した退勤 − 定時の終業（19:30 − 17:30）。実働−480 ではない
    // 未承認の日は遅刻・早退の保存値が無い（表示時に記録時刻から計算）ので書かない
    expect(r.data).not.toHaveProperty("lateMinutes")
    // 実打刻は書き換えない
    expect(r.data).not.toHaveProperty("rawClockOut")
    expect(r.data).not.toHaveProperty("rawClockIn")
  })

  it("承認が取り消されて申請が無くなった → 定時 17:30 に戻る・残業0", () => {
    const r = build(rec({ clockOut: jst(19, 30) }), ctx())!
    expect(hm(r.data.clockOut as Date)).toBe("17:30")
    expect(r.data.overtimeMinutes).toBe(0)
  })

  it("記録時刻はどの順で計算し直しても同じ（冪等：出力を保存した記録をもう一度通しても変わらない）", () => {
    const c = ctx({ requests: [approved("19:30")] })
    const first = build(rec(), c)!
    const second = build(rec({ clockIn: first.data.clockIn, clockOut: first.data.clockOut }), c)!
    expect(second.data.clockIn).toEqual(first.data.clockIn)
    expect(second.data.clockOut).toEqual(first.data.clockOut)
    expect(second.data.overtimeMinutes).toBe(first.data.overtimeMinutes)
  })

  it("早出申請（承認済み 8:00）・④ON：実打刻 7:40 → 記録 8:00・残業60（早出）", () => {
    const early = {
      type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-04T10:00:00Z"),
      detail: { overtimeType: "earlyStart", startTime: "08:00" }, targetDate: DATE,
    }
    const r = build(rec({ rawClockIn: jst(7, 40), clockIn: jst(9, 0), rawClockOut: jst(17, 30), clockOut: jst(17, 30) }), ctx({ requests: [early] }))!
    expect(hm(r.data.clockIn as Date)).toBe("08:00")
    expect(r.data.overtimeMinutes).toBe(60)
  })

  it("早出申請を却下／削除 → 申請が無い日と同じ（①ON 保存なら 7:40 → 9:00）", () => {
    const r = build(rec({ rawClockIn: jst(7, 40), clockIn: jst(8, 0), switchRoundEarly: true, rawClockOut: jst(17, 30) }), ctx())!
    expect(hm(r.data.clockIn as Date)).toBe("09:00")
  })

  it("②は申請の有無に関係なく効く（残業申請 19:00 の日・保存値 ②ON・③OFF・④OFF：17:40 → 17:30）", () => {
    const r = build(
      rec({ switchRoundNear: true, switchRoundQuarter: false, switchCapOvertime: false, rawClockOut: jst(17, 40) }),
      ctx({ requests: [approved("19:00")] }),
    )!
    expect(hm(r.data.clockOut as Date)).toBe("17:30")
  })
})

describe("buildRecordUpdate：スイッチ状態は記録に保存した値を使う（遡及しない）", () => {
  it("保存値が ④OFF なら、いまの設定が ④ON でも打ち切らない（19:51 → ③で 19:45）", () => {
    const r = build(rec({ switchCapOvertime: false }), ctx())!
    expect(hm(r.data.clockOut as Date)).toBe("19:45")
  })

  it("保存値が無い既存の記録は「③④OFF・①②は現在値」：いまの設定が ③④ON でも 19:51 のまま", () => {
    const old = rec({ switchRoundEarly: null, switchRoundNear: null, switchRoundQuarter: null, switchCapOvertime: null })
    const r = build(old, ctx())!
    expect(hm(r.data.clockOut as Date)).toBe("19:51")
  })

  it("保存値が無い既存の記録の ②は現在値（②ON なら 17:40 → 17:30）", () => {
    const old = rec({
      switchRoundEarly: null, switchRoundNear: null, switchRoundQuarter: null, switchCapOvertime: null, rawClockOut: jst(17, 40),
    })
    const setting = { ...SETTING, roundNearClockTime: true } as unknown as PipelineContext["setting"]
    const r = build(old, ctx({ setting }))!
    expect(hm(r.data.clockOut as Date)).toBe("17:30")
  })

  it("出勤打刻時の保存（snapshot: overwrite）：現在の設定の ①〜④ を記録に書く", () => {
    const r = build(rec({ switchRoundQuarter: null }), ctx(), { snapshot: "overwrite" })!
    expect(r.data).toMatchObject({ switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: true, switchCapOvertime: true })
  })

  it("snapshot: ifMissing は保存値が無いときだけ書く（既存の保存値は変えない）", () => {
    const has = build(rec({ switchCapOvertime: false }), ctx(), { snapshot: "ifMissing" })!
    expect(has.data).not.toHaveProperty("switchCapOvertime")
    const none = build(rec({ switchRoundEarly: null, switchRoundNear: null, switchRoundQuarter: null, switchCapOvertime: null }), ctx(), { snapshot: "ifMissing" })!
    expect(none.data).toMatchObject({ switchRoundQuarter: true, switchCapOvertime: true })
  })

  it("保存値を指定しなければスイッチ列は書かない（保存値をそのまま使う）", () => {
    expect(build(rec(), ctx())!.data).not.toHaveProperty("switchRoundEarly")
  })
})

describe("buildRecordUpdate：計算し直さない日・入力の決め方", () => {
  it("締め済み（LOCKED）は遡及しない", () => {
    expect(build(rec({ status: "LOCKED" }), ctx({ requests: [approved("19:30")] }))).toBeNull()
  })

  it("出勤・退勤の時刻が無い記録（欠勤・有給だけ）は触らない", () => {
    expect(build(rec({ clockIn: null, clockOut: null, rawClockIn: null, rawClockOut: null }), ctx())).toBeNull()
  })

  it("打刻修正で直した退勤時刻（変更履歴）が入力：実打刻 19:51 でも修正 18:07 → ③で 18:00（④OFF 保存）", () => {
    const logs = [{ recordId: "r1", fieldName: "clockOut", newValue: "18:07", changedAt: jst(21, 0) }]
    const r = build(rec({ switchCapOvertime: false }), ctx({ logs }))!
    expect(hm(r.data.clockOut as Date)).toBe("18:00")
  })

  it("他の記録・他の項目の変更履歴は入力にしない", () => {
    const logs = [
      { recordId: "other", fieldName: "clockOut", newValue: "18:07", changedAt: jst(21, 0) },
      { recordId: "r1", fieldName: "clockIn", newValue: "10:00", changedAt: jst(21, 0) },
    ]
    const r = build(rec({ switchCapOvertime: false }), ctx({ logs }))!
    expect(hm(r.data.clockOut as Date)).toBe("19:45")
  })

  it("実打刻も修正履歴も無い既存の記録は丸めない（記録時刻のまま）", () => {
    const r = build(rec({ rawClockIn: null, rawClockOut: null, clockIn: jst(9, 7), clockOut: jst(19, 51) }), ctx())!
    expect(hm(r.data.clockIn as Date)).toBe("09:07")
    expect(hm(r.data.clockOut as Date)).toBe("19:51")
  })

  it("段6：上限が出勤より前（18:00 出勤・申請なし）→ 勤務時間0分・残業0", () => {
    const r = build(rec({ rawClockIn: jst(18, 0), rawClockOut: jst(20, 0), clockIn: jst(18, 0), clockOut: jst(20, 0) }), ctx())!
    expect(r.out.capBeforeClockIn).toBe(true)
    expect(r.data.workingMinutes).toBe(0)
    expect(r.data.overtimeMinutes).toBe(0)
  })
})

describe("buildRecordUpdate：段6.5 管理者の確定修正は後の再計算でも最後に勝つ", () => {
  it("管理者の退勤 19:00（adminClockOut）は、後で残業申請 19:30 が承認されて計算し直しても 19:00 のまま", () => {
    const r = build(rec({ adminClockOut: jst(19, 0) }), ctx({ requests: [approved("19:30")] }), { status: "APPROVED" })!
    expect(hm(r.data.clockOut as Date)).toBe("19:00")
    expect(r.data.overtimeMinutes).toBe(90)
  })
  it("管理者の値が無い日は従来どおり（④で 17:30）", () => {
    expect(hm(build(rec(), ctx())!.data.clockOut as Date)).toBe("17:30")
  })
})

describe("buildRecordUpdate：承認済みの日は遅刻・早退も保存し直す", () => {
  it("承認処理：9:20 出勤・14:00 退勤（③OFF 保存）→ 遅刻20・早退210・残業0・状態 APPROVED", () => {
    const r = build(
      rec({ rawClockIn: jst(9, 20), rawClockOut: jst(14, 0), switchRoundQuarter: false, switchCapOvertime: false }),
      ctx(), { status: "APPROVED" },
    )!
    expect(r.data).toMatchObject({ status: "APPROVED", lateMinutes: 20, earlyLeaveMinutes: 210, overtimeMinutes: 0 })
  })

  it("休日出勤の印がある日は定時なし：遅刻・早退・残業とも0（承認し直しても0）", () => {
    const r = build(
      rec({ isHolidayWork: true, rawClockIn: jst(9, 20), rawClockOut: jst(14, 0), switchRoundQuarter: false, switchCapOvertime: false }),
      ctx(), { status: "APPROVED" },
    )!
    expect(r.data).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  it("休日カレンダーの日は定時なし：打刻があっても遅刻・早退を付けない", () => {
    const r = build(
      rec({ rawClockIn: jst(10, 0), rawClockOut: jst(15, 0), switchRoundQuarter: false, switchCapOvertime: false }),
      ctx({ holidayKeys: new Set(["2026-10-05"]) }), { status: "APPROVED" },
    )!
    expect(r.data).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0 })
  })

  it("承認済みの午前半休の日は定時 13:00〜17:30：13:10 出勤 → 遅刻10", () => {
    const leave = {
      type: "LEAVE", status: "APPROVED", createdAt: new Date("2026-10-01T00:00:00Z"),
      detail: { leaveType: "paid", halfDay: "am" }, targetDate: DATE,
    }
    const r = build(
      rec({ rawClockIn: jst(13, 10), rawClockOut: jst(17, 30), switchRoundQuarter: false, switchCapOvertime: false }),
      ctx({ requests: [leave] }), { status: "APPROVED" },
    )!
    expect(r.data).toMatchObject({ lateMinutes: 10, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  it("OPEN でも遅刻・早退の保存値が残っている日（承認取り消し後）は保存し直す", () => {
    const r = build(rec({ lateMinutes: 99, earlyLeaveMinutes: 99, switchCapOvertime: false }), ctx())!
    expect(r.data).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0 })
  })
})

describe("recomputeDay / recomputeRecords：保存まで", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFind.mockResolvedValue(USER)
    mocks.settingFind.mockResolvedValue(SETTING)
    mocks.holidayFindMany.mockResolvedValue([])
    mocks.requestFindMany.mockResolvedValue([approved("19:30")])
    mocks.logFindMany.mockResolvedValue([])
    mocks.recordFind.mockResolvedValue(rec())
  })

  it("recomputeDay：その日の記録を計算し直して update する（退勤後の承認 → 19:30）", async () => {
    await recomputeDay("u1", DATE)
    const arg = mocks.update.mock.calls[0][0] as { where: { id: string }; data: Data }
    expect(arg.where.id).toBe("r1")
    expect(hm(arg.data.clockOut as Date)).toBe("19:30")
  })

  it("記録が無い日は何もしない", async () => {
    mocks.recordFind.mockResolvedValue(null)
    await recomputeDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("LOCKED は何も書かない", async () => {
    mocks.recordFind.mockResolvedValue(rec({ status: "LOCKED" }))
    await recomputeDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("勤怠承認（一括）：OPEN/SUBMITTED を APPROVED にし、遅刻・早退・残業を同じ計算で保存する", async () => {
    mocks.requestFindMany.mockResolvedValue([])
    const recs = [
      rec({ id: "a", rawClockIn: jst(9, 20), rawClockOut: jst(18, 0), switchRoundQuarter: false, switchCapOvertime: false }),
      rec({ id: "b", rawClockIn: jst(9, 0), rawClockOut: jst(14, 0), switchRoundQuarter: false, switchCapOvertime: false }),
      // 出退勤の時刻が無い記録は状態だけ APPROVED
      rec({ id: "c", clockIn: null, clockOut: null, rawClockIn: null, rawClockOut: null }),
    ]
    await recomputeRecords("u1", recs, { status: "APPROVED" })
    const byId = Object.fromEntries(
      mocks.update.mock.calls.map(([arg]) => [(arg as { where: { id: string } }).where.id, (arg as { data: Data }).data]),
    )
    expect(byId.a).toMatchObject({ status: "APPROVED", lateMinutes: 20, earlyLeaveMinutes: 0, overtimeMinutes: 30 })
    expect(byId.b).toMatchObject({ status: "APPROVED", lateMinutes: 0, earlyLeaveMinutes: 210, overtimeMinutes: 0 })
    expect(byId.c).toEqual({ status: "APPROVED" })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})
