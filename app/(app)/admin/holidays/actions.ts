"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { buildNationalHolidays, parseJstDateString } from "@/lib/date"

async function checkAdmin() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function actionCreateHoliday(formData: FormData) {
  await checkAdmin()

  const dateStr = formData.get("date") as string
  const name    = (formData.get("name") as string).trim()
  const type    = formData.get("type") as string

  if (!dateStr || !name) return

  // 日本時間の日付 → 保存用の UTC 0時（lib/date.ts）
  const date = parseJstDateString(dateStr)
  if (!date) return

  await prisma.holiday.upsert({
    where:  { date },
    update: { name, type },
    create: { date, name, type },
  })

  revalidatePath("/admin/holidays")
}

export async function actionDeleteHoliday(id: number) {
  await checkAdmin()
  await prisma.holiday.delete({ where: { id } })
  revalidatePath("/admin/holidays")
}

// 祝日を年単位で一括シード（日本の国民の祝日）
export async function actionSeedNationalHolidays(formData: FormData) {
  await checkAdmin()

  const year = parseInt(formData.get("year") as string)
  if (!year || year < 2020 || year > 2030) return
  // 日付はすべて「UTC 0時＝その日」で生成（lib/date.ts）。new Date(y, m-1, d) は使わない
  const all = buildNationalHolidays(year)

  await prisma.$transaction(
    all.map((h) =>
      prisma.holiday.upsert({
        where:  { date: h.date },
        update: { name: h.name, type: "NATIONAL" },
        create: { date: h.date, name: h.name, type: "NATIONAL" },
      })
    )
  )

  revalidatePath("/admin/holidays")
}
