"use server"

import { prisma } from "@/lib/prisma"

export type LinkState = {
  pendingUserId:    string
  googleEmail:      string
  providerAccountId: string
  name:             string
  image:            string
}

/** 会社メールでユーザー検索（確認画面用）*/
export async function actionFindByCompanyEmail(companyEmail: string) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: companyEmail }, { companyEmail }] },
    select: { id: true, name: true, department: true, email: true, companyEmail: true },
  })
  if (!user) return null
  // 既にリンク済み（email が gmail など）の場合は除外
  if (user.email && !user.email.includes("@iwaki-i.com") && !user.email.startsWith("__pending__")) {
    return null
  }
  return { id: user.id, name: user.name, department: user.department }
}

/** Google アカウントを従業員情報にリンク */
export async function actionLinkAccount(state: LinkState, companyEmail: string) {
  // 事前登録ユーザーを取得
  const preRegistered = await prisma.user.findFirst({
    where: { OR: [{ email: companyEmail }, { companyEmail }] },
    select: {
      id: true, name: true, role: true, employmentType: true,
      department: true, employeeCode: true, jobTitle: true,
      workStartTime: true, workEndTime: true, hireDate: true,
      salaryCode: true, isActive: true,
    },
  })
  if (!preRegistered) throw new Error("ユーザーが見つかりません")

  if (state.pendingUserId) {
    // --- パターン A: pending ユーザーが存在する（旧フロー） ---
    // preRegistered を先に削除して companyEmail の UNIQUE 制約を解放してから pending を昇格
    await prisma.$transaction([
      prisma.user.delete({ where: { id: preRegistered.id } }),
      prisma.user.update({
        where: { id: state.pendingUserId },
        data: {
          email:          state.googleEmail,
          companyEmail,
          name:           preRegistered.name  ?? state.name  ?? null,
          image:          state.image         || null,
          role:           preRegistered.role,
          employmentType: preRegistered.employmentType,
          department:     preRegistered.department,
          employeeCode:   preRegistered.employeeCode,
          jobTitle:       preRegistered.jobTitle,
          workStartTime:  preRegistered.workStartTime,
          workEndTime:    preRegistered.workEndTime,
          hireDate:       preRegistered.hireDate,
          salaryCode:     preRegistered.salaryCode,
          isActive:       preRegistered.isActive,
          linkedAt:       new Date(),
        },
      }),
    ])

  } else {
    // --- パターン B: pending ユーザーなし（NextAuth v5 が signIn → createUser の順で呼ぶため）---
    // Account を preRegistered user に直接作成（または既存を付け替え）
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: state.providerAccountId,
        },
      },
    })

    if (existingAccount) {
      // 既存 Account が別ユーザーを指している場合は付け替え
      if (existingAccount.userId !== preRegistered.id) {
        await prisma.$transaction([
          prisma.account.update({
            where: { id: existingAccount.id },
            data: { userId: preRegistered.id },
          }),
          // 旧ユーザー（pending user 等）を削除
          prisma.user.delete({ where: { id: existingAccount.userId } }),
        ])
      }
    } else {
      // Account を新規作成
      await prisma.account.create({
        data: {
          userId:            preRegistered.id,
          type:              "oauth",
          provider:          "google",
          providerAccountId: state.providerAccountId,
        },
      })
    }

    // プロフィール情報を更新
    await prisma.user.update({
      where: { id: preRegistered.id },
      data: {
        name:        preRegistered.name ?? state.name ?? null,
        image:       state.image || null,
        companyEmail,
        linkedAt:    new Date(),
      },
    })
  }
}
