"use client"

import { useState } from "react"

type Props = {
  roundEarlyClockIn:    boolean
  roundNearClockTime:   boolean
  roundQuarterHour:     boolean
  capOvertimeByRequest: boolean
}

const checkClass = "mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"

/**
 * 打刻丸め ①②③ と残業の申請上限 ④ のスイッチ。
 * ③ON のとき②はチェック済み・操作不可（③の切り捨てだけで定時後14分以内も定時に丸まり、②OFF が意味をなさないため）。
 * 無効化したチェックボックスはフォーム送信に含まれないので、②の保存値は hidden で送って保つ
 * （③を後で切ったとき、②が黙って消えないようにする）。
 */
export function RoundingFields(props: Props) {
  const [early, setEarly]     = useState(props.roundEarlyClockIn)
  const [near, setNear]       = useState(props.roundNearClockTime)
  const [quarter, setQuarter] = useState(props.roundQuarterHour)
  const [cap, setCap]         = useState(props.capOvertimeByRequest)

  return (
    <>
      {/* 打刻丸め処理 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">打刻丸め処理</h2>
        <p className="text-xs text-gray-400 mb-4">
          打刻時刻を自動で補正します。ユーザーごとの所定開始・終了時刻が設定されている場合に有効です。
          ①→②→③の順に評価します。切り替えは切り替え後の打刻にだけ効きます（過去の打刻・締め済みは変わりません）。
        </p>
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox" name="roundEarlyClockIn"
              checked={early}
              onChange={(e) => setEarly(e.target.checked)}
              value="true"
              className={checkClass}
            />
            <div>
              <p className="text-sm text-gray-700 font-medium">① 定時前打刻 → 定時扱い</p>
              <p className="text-xs text-gray-400 mt-0.5">例: 9:00始業の人が 8:40 に打刻 → 9:00 で記録</p>
            </div>
          </label>

          <label className={`flex items-start gap-3 ${quarter ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              // ③ON のときは操作不可（チェック済みで表示）。保存値は下の hidden で送る
              name={quarter ? undefined : "roundNearClockTime"}
              checked={quarter ? true : near}
              disabled={quarter}
              onChange={(e) => setNear(e.target.checked)}
              value="true"
              className={`${checkClass} ${quarter ? "opacity-60" : ""}`}
            />
            {quarter && <input type="hidden" name="roundNearClockTime" value={near ? "true" : "false"} />}
            <div>
              <p className="text-sm text-gray-700 font-medium">② 定時14分以内の早出・残業 → 定時きっかり</p>
              <p className="text-xs text-gray-400 mt-0.5">例: 9:00始業の人が 8:55 に出勤打刻 → 9:00 で記録。17:00終業の人が 17:10 に退勤打刻 → 17:00 で記録。遅刻（9:09 出勤）・早退（16:50 退勤）は丸めず実時刻で記録します</p>
              {quarter && <p className="text-xs text-blue-600 mt-0.5">③がONのため②も有効です（操作できません）</p>}
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox" name="roundQuarterHour"
              checked={quarter}
              onChange={(e) => setQuarter(e.target.checked)}
              value="true"
              className={checkClass}
            />
            <div>
              <p className="text-sm text-gray-700 font-medium">③ 全体の15分丸め（出勤は切り上げ・退勤は切り捨て）</p>
              <p className="text-xs text-gray-400 mt-0.5">
                15分の区切りは本人の定時を起点に刻みます（時計の :00/:15 ではありません）。
                例: 9:00始業の人が 9:23 に出勤 → 9:30 で記録（遅刻30分）。終業 17:40 の人が 17:43 に退勤 → 17:40 で記録。
                早出・残業申請がある日も③は効きます。遅刻・早退の分数は丸めた記録時刻から出します
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* 残業の申請上限 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">残業の申請上限</h2>
        <p className="text-xs text-gray-400 mb-4">
          丸めとは別のスイッチです。切り替えは切り替え後の打刻にだけ効きます。
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox" name="capOvertimeByRequest"
            checked={cap}
            onChange={(e) => setCap(e.target.checked)}
            value="true"
            className={checkClass}
          />
          <div>
            <p className="text-sm text-gray-700 font-medium">④ 残業は申請した終了時刻を上限に記録する</p>
            <p className="text-xs text-gray-400 mt-0.5">
              退勤の記録時刻 ＝ 実際の退勤（③まで適用）と上限の早い方。上限は承認済みの残業申請のうち最後に出した申請の終了時刻、
              残業申請が無い日は定時です（早出申請は対象外）。実打刻は書き換えず、勤務時間・遅刻・早退・残業は記録時刻から計算します。
              残業申請が退勤後に承認・削除されたときは、記録時刻を計算し直します。
              月の途中で切り替えると同じ月に旧方式と新方式が混ざるため、締め期間の初日に切り替えてください
            </p>
          </div>
        </label>
      </div>
    </>
  )
}
