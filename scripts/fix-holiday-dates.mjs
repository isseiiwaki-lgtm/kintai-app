/**
 * 祝日データ補正スクリプト（2026-10 山の日ずれ対応）
 *
 * 背景: Holiday.date は「UTC 0時＝その日」で保存する規約。
 *       旧シード（new Date(year, m-1, d)）が JST 0時（= 前日 UTC 15:00）で保存していたため、
 *       Excel など UTC 日付で照合する箇所で 1 日ずれた（山の日が 8/10 扱い）。
 *
 * 使い方（DATABASE_URL の指す DB が対象。.env を読む）:
 *   node scripts/fix-holiday-dates.mjs            読み取りモード（一覧を出すだけ。何も書き換えない）
 *   node scripts/fix-holiday-dates.mjs --apply    補正を実行（トランザクション）
 *
 * 補正内容:
 *   - UTC 15:00:00 で保存された行 → +9時間して UTC 0時（=本来の日付）にする
 *   - 補正後の日付に既に正しい行がある場合（重複）→ 古い（ずれた）行を削除し、既存の正しい行を残す
 *   - UTC 0:00 でも 15:00 でもない行は触らず「想定外」として表示する
 *
 * 注意: 本番に対して --apply する前に、必ず対象一覧を確認し、DB バックアップを取ること。
 */
import "dotenv/config"
import pg from "pg"

const apply = process.argv.includes("--apply")
const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL が設定されていません")
  process.exit(1)
}

// 接続先の確認用（パスワードは出さない）
try {
  const u = new URL(url)
  console.log(`接続先: ${u.hostname}:${u.port || "5432"}${u.pathname}`)
} catch {
  console.log("接続先: (DATABASE_URL を解析できません)")
}
console.log(`モード: ${apply ? "実行 (--apply)" : "読み取りのみ（書き換えません）"}\n`)

// timestamp(3) without time zone は node-pg がローカル時刻として解釈してしまうため、文字列で受け取る
const SELECT_SQL = `
  SELECT id, name, type,
         to_char(date, 'YYYY-MM-DD"T"HH24:MI:SS') AS date_text,
         to_char(date + interval '9 hours', 'YYYY-MM-DD') AS jst_date
  FROM "Holiday"
  ORDER BY date ASC`

const client = new pg.Client({ connectionString: url })
await client.connect()

try {
  const { rows } = await client.query(SELECT_SQL)

  const okByDate = new Map() // "YYYY-MM-DD" → 既に正しい（UTC 0時）行
  const shifted = []          // UTC 15:00 の行（補正対象）
  const unexpected = []       // それ以外の時刻
  for (const r of rows) {
    const [day, time] = r.date_text.split("T")
    if (time === "00:00:00") okByDate.set(day, r)
    else if (time === "15:00:00") shifted.push(r)
    else unexpected.push(r)
  }

  const plan = shifted.map((r) => {
    const dup = okByDate.get(r.jst_date)
    return { ...r, action: dup ? "delete" : "update", dup }
  })

  console.log(`全 ${rows.length} 件 / 正常(UTC 0時) ${okByDate.size} 件 / 補正対象(UTC 15:00) ${shifted.length} 件 / 想定外 ${unexpected.length} 件\n`)

  if (plan.length > 0) {
    console.log("【補正対象】 現在の保存値(UTC) → 補正後の日付")
    for (const p of plan) {
      const note = p.action === "delete"
        ? `重複: ${p.jst_date} に既存行 id=${p.dup.id}「${p.dup.name}」あり → このずれた行を削除`
        : "日付を +9時間（UTC 0時）に更新"
      console.log(`  id=${p.id}  ${p.date_text}  →  ${p.jst_date}  「${p.name}」(${p.type})  ${note}`)
    }
    console.log("")
  }
  if (unexpected.length > 0) {
    console.log("【想定外の時刻（触りません）】")
    for (const r of unexpected) console.log(`  id=${r.id}  ${r.date_text}  「${r.name}」(${r.type})`)
    console.log("")
  }

  if (!apply) {
    console.log("読み取りモードのため変更していません。実行するには --apply を付けてください。")
  } else if (plan.length === 0) {
    console.log("補正対象がないため何もしません。")
  } else {
    await client.query("BEGIN")
    try {
      let updated = 0
      let deleted = 0
      for (const p of plan) {
        if (p.action === "delete") {
          await client.query(`DELETE FROM "Holiday" WHERE id = $1`, [p.id])
          deleted++
        } else {
          await client.query(`UPDATE "Holiday" SET date = date + interval '9 hours' WHERE id = $1`, [p.id])
          updated++
        }
      }
      await client.query("COMMIT")
      console.log(`補正完了: 更新 ${updated} 件 / 重複削除 ${deleted} 件`)
    } catch (e) {
      await client.query("ROLLBACK")
      console.error("エラーのためロールバックしました:", e)
      process.exitCode = 1
    }
  }
} finally {
  await client.end()
}
