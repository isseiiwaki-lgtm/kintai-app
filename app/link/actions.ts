"use server"

import { prisma } from "@/lib/prisma"
import { verifyLinkState, type LinkState } from "@/lib/link-state"

const EXPIRED_MESSAGE = "リンクの有効期限が切れました。もう一度ログインしてください"

/** 署名付き state を検証して中身を返す。不正・期限切れは例外 */
function requireLinkState(signedState: string): LinkState {
  const state = verifyLinkState(signedState, process.env.AUTH_SECRET ?? "")
  if (!state) throw new Error(EXPIRED_MESSAGE)
  return state
}

/** 会社メールでユーザー検索（確認画面用）*/
export async function actionFindByCompanyEmail(signedState: string, companyEmail: string) {
  // 署名・期限の検証（失敗時は例外）
  requireLinkState(signedState)
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: companyEmail }, { companyEmail }] },
    select: {
      id: true, name: true, department: true,
      // 紐づけ済みかどうかは Account（Google 連携）の実在で判定する（メールの形で推測しない）
      _count: { select: { accounts: true } },
    },
  })
  if (!user) return null
  // 既に Google アカウントと紐づけ済みの場合は除外
  if (user._count.accounts > 0) return null
  return { id: user.id, name: user.name, department: user.department }
}

/** Google アカウントを従業員情報にリンク */
export async function actionLinkAccount(signedState: string, companyEmail: string) {
  // 署名・期限の検証（以降は検証済みの state のみ使う）
  const state = requireLinkState(signedState)

  // 事前登録ユーザーを取得
  const preRegistered = await prisma.user.findFirst({
    where: { OR: [{ email: companyEmail }, { companyEmail }] },
    select: {
      id: true, name: true, role: true, employmentType: true,
      department: true, employeeCode: true, jobTitle: true,
      workStartTime: true, workEndTime: true, hireDate: true,
      salaryCode: true, isActive: true,
      _count: { select: { accounts: true } },
    },
  })
  if (!preRegistered) throw new Error("ユーザーが見つかりません")
  // 既に Google 連携済みの社員には紐づけさせない（検索側の判定に頼らない）
  if (preRegistered._count.accounts > 0) throw new Error("このユーザーは既に紐づけ済みです")

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
