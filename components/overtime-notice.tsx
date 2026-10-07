/**
 * 本人向けの注意表示（当日だけ）。残業申請が無いのに定時を15分以上過ぎて退勤した日に出す。
 * 注意を促す程度の文言にとどめ、削った時間・実打刻・上限などの内訳は出さない（内訳は管理者画面のみ）。
 */
export function OvertimeNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
      定時を過ぎて退勤しましたが、残業申請がありません。残業した場合は申請してください。
    </div>
  )
}
