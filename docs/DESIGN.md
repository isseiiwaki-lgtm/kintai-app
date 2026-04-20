# 勤怠管理アプリ 設計ドキュメント

## セントラルドグマ：シンプル優先

> **「動くものを最短で作る」が最優先。**
> 設計・実装において複雑にできる選択肢があるときは、常にシンプルな方を選ぶ。
> 拡張性・汎用性・美しさは「動いた後」に考える。

具体的指針：
- テーブル設計はカラムを増やさない。必要になったときに追加する
- 条件分岐は最小限。エッジケースは後回し
- UIはシンプルなHTML/Tailwindで十分。凝ったコンポーネントは作らない
- エラーハンドリングは基本系のみ。完璧にしない
- 型定義は必要な箇所だけ。過剰な抽象化はしない

---

## 技術スタック

| 役割 | 採用 |
|---|---|
| フレームワーク | Next.js 14（App Router） |
| 認証 | NextAuth.js + Google OAuth |
| ORM | Prisma |
| DB | PostgreSQL（VPS構築済み） |
| スタイル | Tailwind CSS |

---

## 締め日ロジック

**25日締め = 勤務月は「前月26日〜当月25日」**

全集計・締め処理でこの期間定義を使う。  
例：2026年4月度 = 2026年3月26日〜2026年4月25日

---

## ロール設計

| ロール | 権限 |
|---|---|
| `employee` | 自分の打刻・申請・月次確認 |
| `approver` | 全申請の承認（部署・種別不問） |
| `admin` | 全操作・締め処理・エクスポート・上書き承認 |

- `approver` は step（1次・2次）を持つ。飛び越し承認は `admin` が対応
- Google OAuth の `@iwaki-i.com` ドメイン制限あり

---

## データモデル

```prisma
model User {
  id               String   @id @default(cuid())
  name             String
  email            String   @unique
  role             Role     @default(EMPLOYEE)
  approverStep     Int?     // approverのみ: 1 or 2
  department       String?
  employmentType   String   // full / part
  workStartTime    String?  // "08:30"
  workEndTime      String?  // "17:30"
  createdAt        DateTime @default(now())
}

model AttendanceRecord {
  id             String   @id @default(cuid())
  userId         String
  date           DateTime // 日付のみ (JST)
  clockIn        DateTime?
  clockOut       DateTime?
  breakStart     DateTime?
  breakEnd       DateTime?
  workingMinutes Int?
  note           String?
  status         AttendanceStatus @default(OPEN)
  createdAt      DateTime @default(now())
}

model Request {
  id         String        @id @default(cuid())
  userId     String
  type       RequestType
  targetDate DateTime
  detail     Json?
  reason     String?
  status     RequestStatus @default(PENDING)
  createdAt  DateTime      @default(now())
  approvals  Approval[]
}

model Approval {
  id         String   @id @default(cuid())
  requestId  String
  approverId String
  step       Int
  action     ApprovalAction
  comment    String?
  actedAt    DateTime @default(now())
}

model LeaveBalance {
  id          String @id @default(cuid())
  userId      String
  fiscalYear  Int
  totalDays   Float
  usedDays    Float  @default(0)
}

enum Role { EMPLOYEE APPROVER ADMIN }
enum AttendanceStatus { OPEN SUBMITTED APPROVED LOCKED }
enum RequestType { OVERTIME LEAVE ABSENCE COMMENT OTHER }
enum RequestStatus { PENDING APPROVED REJECTED }
enum ApprovalAction { APPROVED REJECTED }
```

---

## 画面構成（MVP）

**従業員**
- `/` — ダッシュボード（今日の打刻状態・今月サマリー）
- `/clock` — 打刻（出勤・退勤・休憩開始・終了）
- `/requests/new` — 各種申請
- `/requests` — 申請履歴
- `/attendance/[month]` — 月次勤怠確認

**承認者**
- `/approvals` — 承認待ち一覧・承認操作

**管理者**
- `/admin/employees` — 従業員管理・CSVインポート
- `/admin/attendance` — 全員勤怠一覧
- `/admin/monthly` — 月次集計・締め処理
- `/admin/export` — Excel/CSVエクスポート

---

## 開発フェーズ

| フェーズ | 内容 |
|---|---|
| 1 | プロジェクト初期化・Prismaスキーマ・NextAuth認証 |
| 2 | 打刻機能 |
| 3 | 申請・承認フロー |
| 4 | 月次集計・締め処理・エクスポート |
| 5 | 管理者機能・従業員管理 |

---

## 後回し（MVP対象外）

- 通知（メール・アプリ内）
- CSVインポート（従業員登録）
- TKCフォーマット対応
- シフト管理
- 36協定管理
- 有給自動付与
- 過去データ移行
