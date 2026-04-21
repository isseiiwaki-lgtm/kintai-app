"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"

async function checkAdmin() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function actionUpdateUser(formData: FormData) {
  await checkAdmin()

  const id             = formData.get("id")             as string
  const name           = formData.get("name")           as string
  const role           = formData.get("role")           as string
  const employmentType = formData.get("employmentType") as string
  const department     = formData.get("department")     as string
  const workStartTime  = formData.get("workStartTime")  as string
  const workEndTime    = formData.get("workEndTime")    as string
  const isActive       = formData.get("isActive") === "true"

  await prisma.user.update({
    where: { id },
    data: {
      name:           name           || null,
      role:           role as "EMPLOYEE" | "APPROVER" | "ADMIN",
      employmentType,
      department:     department     || null,
      workStartTime:  workStartTime  || null,
      workEndTime:    workEndTime    || null,
      isActive,
    },
  })

  redirect("/admin/users")
}

export async function actionCreateUser(formData: FormData): Promise<{ error: string } | void> {
  await checkAdmin()

  const email          = (formData.get("email")          as string).trim().toLowerCase()
  const name           = (formData.get("name")           as string).trim()
  const role           = formData.get("role")            as string
  const employmentType = formData.get("employmentType")  as string
  const department     = formData.get("department")      as string
  const workStartTime  = formData.get("workStartTime")   as string
  const workEndTime    = formData.get("workEndTime")     as string

  if (!email) return { error: "メールアドレスは必須です" }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    // すでに存在する場合は編集ページへ
    redirect(`/admin/users/${existing.id}/edit`)
  }

  await prisma.user.create({
    data: {
      email,
      name:           name           || null,
      role:           role as "EMPLOYEE" | "APPROVER" | "ADMIN",
      employmentType: employmentType || "full",
      department:     department     || null,
      workStartTime:  workStartTime  || null,
      workEndTime:    workEndTime    || null,
    },
  })

  redirect("/admin/users")
}
