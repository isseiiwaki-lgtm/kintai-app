/**
 * ユーザー管理（編集・新規・CSV取り込み）の入力検証用 純粋関数
 * サーバーアクションから呼ぶ。DB アクセスは持たない（テスト容易性のため）
 */

/** 仮アドレス（複製ユーザー用）の末尾 */
export const TEMP_EMAIL_SUFFIX = "@temp.invalid"

/**
 * 会社メール保存時に、ログイン用 email を置き換える先を返す。
 * 置き換え不要なら null。
 * - 現在の email が仮アドレス（@temp.invalid 終わり）かつ会社メールが入力されている場合のみ置き換える
 */
export function resolveLoginEmailOnCompanyEmailSave(
  currentEmail: string | null | undefined,
  companyEmail: string | null | undefined,
): string | null {
  const company = (companyEmail ?? "").trim().toLowerCase()
  if (!company) return null
  if (!currentEmail || !currentEmail.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX)) return null
  return company
}

/**
 * 出勤・退勤時刻（"HH:MM"）の検証。問題なければ null、あればエラーメッセージを返す。
 * 空（未設定）は許可。分は 00/15/30/45 のみ許可（就業規則が15分刻みのため）
 */
export function validateWorkTime(value: string | null | undefined): string | null {
  const v = (value ?? "").trim()
  if (!v) return null
  if (!/^\d{2}:\d{2}$/.test(v)) return "HH:MM形式で入力してください"
  const minute = Number(v.slice(3))
  if (minute % 15 !== 0 || minute > 45) return "15分刻みで入力してください"
  return null
}

export type CsvCodeRow = { row: number; email: string; employeeCode: string | null }
export type DbCodeHolder = { email: string; name: string | null; employeeCode: string | null }
export type CodeConflict = { row: number; message: string }

/**
 * CSV 取り込み時の社員番号（employeeCode）重複を検出する。
 * 1. CSV 内で同じ番号が複数行にある → 後の行をエラー（先に出た行番号を示す）
 * 2. 取り込み対象外（CSV に載っていない）の既存ユーザーが同じ番号を使っている → エラー（使用者の氏名を示す）
 *    ※ 他人の番号を黙って消さない。取り込み対象の既存ユーザーは、その行で番号が上書きされるので衝突扱いにしない
 */
export function detectEmployeeCodeConflicts(
  rows: CsvCodeRow[],
  dbHolders: DbCodeHolder[],
): CodeConflict[] {
  const conflicts: CodeConflict[] = []
  const importEmails = new Set(rows.map((r) => r.email))
  const firstRowByCode = new Map<string, number>()

  for (const r of rows) {
    const code = r.employeeCode
    if (!code) continue

    const first = firstRowByCode.get(code)
    if (first !== undefined) {
      conflicts.push({
        row: r.row,
        message: `社員番号 "${code}" が CSV 内の ${first} 行目と重複しています`,
      })
      continue
    }
    firstRowByCode.set(code, r.row)

    const holder = dbHolders.find(
      (u) => u.employeeCode === code && u.email !== r.email && !importEmails.has(u.email),
    )
    if (holder) {
      conflicts.push({
        row: r.row,
        message: `社員番号 "${code}" はすでに使われています（${holder.name ?? holder.email}）`,
      })
    }
  }
  return conflicts
}

/** 画面入力（編集・新規）用: 他人が使用中の社員番号のエラーメッセージ */
export function employeeCodeInUseMessage(holderName: string | null, holderEmail: string): string {
  return `この社員番号はすでに使われています（${holderName ?? holderEmail}）`
}
