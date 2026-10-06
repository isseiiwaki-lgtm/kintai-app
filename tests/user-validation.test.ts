/**
 * ユーザー管理の入力検証（lib/user-validation.ts）のテスト
 */
import { describe, it, expect } from "vitest"
import {
  resolveLoginEmailOnCompanyEmailSave,
  validateWorkTime,
  detectEmployeeCodeConflicts,
} from "../lib/user-validation"

describe("resolveLoginEmailOnCompanyEmailSave（作業B）", () => {
  it("仮アドレスの複製ユーザーに会社メールを保存 → 会社メールに置き換える", () => {
    expect(resolveLoginEmailOnCompanyEmailSave("duplicate_123@temp.invalid", "sato@iwaki-i.com"))
      .toBe("sato@iwaki-i.com")
  })
  it("大文字混じりの会社メールは小文字化して置き換える", () => {
    expect(resolveLoginEmailOnCompanyEmailSave("duplicate_1@temp.invalid", " Sato@Iwaki-i.com "))
      .toBe("sato@iwaki-i.com")
  })
  it("仮アドレスでなければ置き換えない（紐づけ済みの Google アドレスを守る）", () => {
    expect(resolveLoginEmailOnCompanyEmailSave("taro@gmail.com", "taro@iwaki-i.com")).toBeNull()
    expect(resolveLoginEmailOnCompanyEmailSave("yamada@iwaki-i.com", "yamada@iwaki-i.com")).toBeNull()
  })
  it("会社メールが空なら置き換えない", () => {
    expect(resolveLoginEmailOnCompanyEmailSave("duplicate_1@temp.invalid", "")).toBeNull()
    expect(resolveLoginEmailOnCompanyEmailSave("duplicate_1@temp.invalid", null)).toBeNull()
  })
})

describe("validateWorkTime（作業D）", () => {
  it("00/15/30/45 は OK", () => {
    for (const v of ["08:00", "08:15", "08:30", "17:45"]) expect(validateWorkTime(v)).toBeNull()
  })
  it("08:40 は 15分刻みエラー", () => {
    expect(validateWorkTime("08:40")).toBe("15分刻みで入力してください")
    expect(validateWorkTime("17:05")).toBe("15分刻みで入力してください")
    expect(validateWorkTime("08:60")).toBe("15分刻みで入力してください")
  })
  it("空は許可（未設定）", () => {
    expect(validateWorkTime("")).toBeNull()
    expect(validateWorkTime(null)).toBeNull()
  })
  it("形式違いは形式エラー", () => {
    expect(validateWorkTime("8:30")).toBe("HH:MM形式で入力してください")
    expect(validateWorkTime("abc")).toBe("HH:MM形式で入力してください")
  })
})

describe("detectEmployeeCodeConflicts（作業C）", () => {
  const db = [
    { email: "a@x.com", name: "山田", employeeCode: "108" },
    { email: "b@x.com", name: "佐藤", employeeCode: "109" },
  ]
  it("取り込み対象外の他人が使用中の番号 → 行番号付きエラー（使用者名つき）", () => {
    const r = detectEmployeeCodeConflicts([{ row: 2, email: "c@x.com", employeeCode: "108" }], db)
    expect(r).toEqual([{ row: 2, message: '社員番号 "108" はすでに使われています（山田）' }])
  })
  it("同じ人（同メール）の番号はそのまま OK", () => {
    expect(detectEmployeeCodeConflicts([{ row: 2, email: "a@x.com", employeeCode: "108" }], db)).toEqual([])
  })
  it("CSV 内で番号が重複 → 後の行がエラー", () => {
    const r = detectEmployeeCodeConflicts(
      [
        { row: 2, email: "c@x.com", employeeCode: "200" },
        { row: 3, email: "d@x.com", employeeCode: "200" },
      ],
      db,
    )
    expect(r).toHaveLength(1)
    expect(r[0].row).toBe(3)
    expect(r[0].message).toContain("2 行目")
  })
  it("番号が空の行は検査しない", () => {
    expect(detectEmployeeCodeConflicts([{ row: 2, email: "c@x.com", employeeCode: null }], db)).toEqual([])
  })
  it("番号を持つ既存ユーザーも CSV に載っていれば（番号が上書きされるので）衝突扱いにしない", () => {
    const r = detectEmployeeCodeConflicts(
      [
        { row: 2, email: "a@x.com", employeeCode: "300" },
        { row: 3, email: "c@x.com", employeeCode: "108" },
      ],
      db,
    )
    expect(r).toEqual([])
  })
})
