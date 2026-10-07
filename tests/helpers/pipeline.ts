/**
 * 打刻パイプラインのテスト共通ヘルパ（docs/CLOCK_PIPELINE.md の具体例をなぞる）
 * 基準の日は 2026-10-05（月）。定時は 9:00〜17:30。
 */
import { computeClockPipeline, type PipelineInput, type PipelineRequest, type PipelineSwitches } from "../../lib/clock-pipeline"

/** JST の時刻を UTC Date にする（day は 2026-10 の日） */
export function jst(h: number, mi: number, day = 5): Date {
  return new Date(Date.UTC(2026, 9, day, h, mi) - 9 * 60 * 60 * 1000)
}

/** Date を JST の HH:MM で読む */
export function hm(d: Date | null): string {
  if (!d) return "--:--"
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

/** 記録の日付（UTC 0時＝その日） */
export const DATE = new Date(Date.UTC(2026, 9, 5))

export const SCHEDULE = { start: "09:00", end: "17:30" }

/** スイッチの組み合わせ（①②③④） */
export function sw(on: Partial<Record<keyof PipelineSwitches, boolean>> = {}): PipelineSwitches {
  return { roundEarly: false, roundNear: false, roundQuarter: false, capOvertime: false, ...on }
}

/** 全スイッチ OFF */
export const OFF = sw()
/** ③④ON（①②はOFF） */
export const ON34 = sw({ roundQuarter: true, capOvertime: true })

/** 残業申請（通常） */
export function overtimeReq(endTime: string, createdAt = new Date("2026-10-01T00:00:00Z"), status = "APPROVED"): PipelineRequest {
  return { type: "OVERTIME", status, createdAt, detail: { endTime } }
}

/** 早出申請 */
export function earlyReq(startTime: string, createdAt = new Date("2026-10-01T00:00:00Z"), status = "APPROVED"): PipelineRequest {
  return { type: "OVERTIME", status, createdAt, detail: { overtimeType: "earlyStart", startTime } }
}

/** パイプラインを回す（出勤・退勤は実打刻） */
export function run(p: {
  in?: Date | null
  out?: Date | null
  switches?: PipelineSwitches
  schedule?: PipelineInput["schedule"]
  requests?: PipelineRequest[]
}) {
  return computeClockPipeline({
    inputClockIn: p.in ?? null,
    inputClockOut: p.out ?? null,
    schedule: p.schedule === undefined ? SCHEDULE : p.schedule,
    switches: p.switches ?? OFF,
    requests: p.requests ?? [],
  })
}
