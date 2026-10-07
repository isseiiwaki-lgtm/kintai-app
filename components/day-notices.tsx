import { OvertimeNotice } from "@/components/overtime-notice"
import type { DayNotices } from "@/lib/clock-out-cap"

const noticeClass = "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4"

/**
 * 本人向けの当日の注意表示をまとめて出す（打刻画面・ホーム）。注意を促す程度の文言にとどめ、要確認の状態・件数には入れない。
 * 翌日以降は出ない（呼び出し側が当日だけ判定する）。
 */
export function DayNoticeList({ notices }: { notices: DayNotices }) {
  return (
    <>
      {notices.overtime && <OvertimeNotice />}
      {notices.breakRecord && (
        <div className={noticeClass}>
          休憩の記録がありません。休憩を取った場合は、打刻画面の休憩ボタンで分数を選んでください（60分を超える場合・押し忘れは休憩申請）。
        </div>
      )}
      {notices.holidayWork && (
        <div className={noticeClass}>
          休日に打刻しましたが、休日出勤申請がありません。休日に出勤した場合は申請してください。
        </div>
      )}
    </>
  )
}
