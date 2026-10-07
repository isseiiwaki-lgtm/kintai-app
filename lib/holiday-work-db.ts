/**
 * 休日出勤申請（HOLIDAY_WORK）の DB 側の検証。
 * 休む日（restDate）は、1つの休日出勤申請にしかひも付けられない（同じ人の、審査中・承認済みの申請どうしで重ならない）
 */

import { prisma } from "@/lib/prisma"

/** 休む日がすでに使われているときのエラーメッセージ（画面にそのまま出す） */
export const REST_DATE_TAKEN_MESSAGE = "その休む日は、別の休日出勤申請ですでに指定されています。別の日を選んでください"

/**
 * 同じ人の別の休日出勤申請（審査中・承認済み。却下・削除済みは除く）がその休む日をすでに持っていれば、エラーメッセージを返す。
 * excludeId：修正中の申請自身を除く。休む日が空なら検証しない
 */
export async function restDateTakenError(userId: string, restDate: string | undefined, excludeId?: string): Promise<string | null> {
  if (!restDate) return null
  const count = await prisma.request.count({
    where: {
      userId,
      type: "HOLIDAY_WORK",
      status: { in: ["PENDING", "APPROVED"] },
      detail: { path: ["restDate"], equals: restDate },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  })
  return count > 0 ? REST_DATE_TAKEN_MESSAGE : null
}
