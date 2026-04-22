"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

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

  await prisma.holiday.upsert({
    where:  { date: new Date(dateStr) },
    update: { name, type },
    create: { date: new Date(dateStr), name, type },
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

  // 固定祝日（振替休日は含まない）
  const fixed: { month: number; day: number; name: string }[] = [
    { month: 1,  day: 1,  name: "元日" },
    { month: 2,  day: 11, name: "建国記念の日" },
    { month: 2,  day: 23, name: "天皇誕生日" },
    { month: 4,  day: 29, name: "昭和の日" },
    { month: 5,  day: 3,  name: "憲法記念日" },
    { month: 5,  day: 4,  name: "みどりの日" },
    { month: 5,  day: 5,  name: "こどもの日" },
    { month: 8,  day: 11, name: "山の日" },
    { month: 11, day: 3,  name: "文化の日" },
    { month: 11, day: 23, name: "勤労感謝の日" },
  ]

  // 移動祝日（ハッピーマンデー）
  function nthMonday(y: number, m: number, n: number): Date {
    const d = new Date(y, m - 1, 1)
    const dow = d.getDay()
    const first = dow === 1 ? 1 : (8 - dow) % 7 + 1
    return new Date(y, m - 1, first + (n - 1) * 7)
  }

  const moving = [
    { date: nthMonday(year, 1, 2),  name: "成人の日" },
    { date: nthMonday(year, 7, 3),  name: "海の日" },
    { date: nthMonday(year, 9, 3),  name: "敬老の日" },
    { date: nthMonday(year, 10, 2), name: "スポーツの日" },
  ]

  // 秋分の日（簡易計算）
  const shubun = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

  const all = [
    ...fixed.map((h) => ({ date: new Date(year, h.month - 1, h.day), name: h.name })),
    ...moving,
    { date: new Date(year, 2, shunbun), name: "春分の日" },
    { date: new Date(year, 8, shubun),  name: "秋分の日" },
  ]

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
