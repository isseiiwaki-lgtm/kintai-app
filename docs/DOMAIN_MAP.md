# ドメインマップ（必読）

勤怠ロジックの修正指示を受けたら**コード変更前に必ずこのファイルを読む**。
詳細（file:line 一覧・列構成・全条件分岐）は `docs/DOMAIN_REFERENCE.md` — 必要な節だけ参照し全読み禁止。

---

**打刻時刻・遅刻・早退・残業・休憩・休日出勤に触る作業は、まず `docs/CLOCK_PIPELINE.md`（打刻時刻の決め方）を読むこと。段の順番と規則はそちらが正。**

## 修正指示を受けたら確認する5軸

修正指示は暗黙の適用範囲を含む。着手前に以下を特定し、不明ならユーザーに質問する。

1. **出勤か退勤か** — 丸めルールは非対称。出勤=roundEarly+roundNear、退勤=roundNearのみ
2. **申請有無で変わるか** — 早出申請→出勤丸め全OFF、残業申請→退勤roundNear OFF
3. **雇用形態で変わるか** — part=手動休憩打刻を控除、full=calcLegalBreak(法定)を控除
4. **期間は暦月か締め期間か** — 「今月」=原則締め期間（前月26日〜当月25日）。暦月と混同しない
5. **保存値か表示値か** — workingMinutes/overtimeMinutes=退勤時にDB保存、late/earlyLeave=承認時保存・未承認は表示時計算

## コアルール

- **丸めスイッチ**（Setting、両方 default OFF）
  - `roundEarlyClockIn`: 定時前打刻→定時扱い。**出勤のみ**
  - `roundNearClockTime`: 定時14分以内の**早出・残業側のみ**定時きっかり（出勤=定時前14分、退勤=定時後14分）。**遅刻・早退側は丸めない**（2026-08-19〜。旧仕様は前後対称で遅刻が消えていた）
  - 実体は `lib/attendance.ts` `applyRounding()`。roundEarly→roundNear の順で評価。`kind:"in"|"out"` 必須（呼び出し側が出退勤を明示）
  - **【リリース2・main 統合済み・未デプロイ】打刻パイプライン**（`lib/clock-pipeline.ts`。全経路の打刻・申請・承認・管理者修正がこれを通る。正典は `docs/CLOCK_PIPELINE.md`）: ③15分丸め（出勤切り上げ・退勤切り捨て。区切りは本人の定時が起点。③ON なら②も効く）と④申請の時刻での打ち切り（④ON なら①も効く）を追加。記録ごとに①〜④のスイッチ状態を保存し、切り替えても既存の記録は変わらない
  - **定時は15分刻みが前提**（就業規則・画面）。ただし CSV取り込みとサーバー側保存では未検証（検証追加予定）
  - **打刻時刻は3層**（2026-10-06 整理）: ①**実打刻** `rawClockIn/Out` ＝ボタンを押した瞬間の値。**証跡専用で計算には使わない**（修正申請・管理者編集では書き換わらない）②**記録時刻** `clockIn/Out` ＝丸め・修正を反映した値。**勤務時間・遅刻・早退・残業の計算はすべてこれが基準**③**修正前値** `originalClockIn/Out` ＝初回修正時に退避した記録時刻。実打刻から計算すると修正した日の修正が無視されるので禁止
  - **遅刻・早退の単位は③15分丸めに連動**: ③OFF＝記録時刻から1分単位（遅刻・早退側は①②で丸まらないため）／③ON＝15分丸めした記録時刻から15分単位（2026-10-06 決定）
  - **生打刻**: 丸め前の実時刻を `rawClockIn/rawClockOut` に打刻時のみ常時保存（証跡用・手入力や修正申請では書かれない）。`originalClockIn/Out`（修正前値）とは別概念。表示は差がある日のみ /records・承認詳細に併記、Excel 非出力
- **代理打刻**: 出退勤いずれの打刻もなかった日は `AttendanceRecord` 行自体が存在せず、表にも `/records` にも出ない。管理者は `/admin/approval/[userId]` の代理打刻フォーム（`actionAdminCreateRecord`）で後日打刻する。**生打刻は書かない**・保存後は APPROVED・**休日出勤チェック時のみ遅刻/早退を0**（`calcMetrics` は休日を判定しないため）。既に打刻がある日・LOCKED の日は拒否＝表の編集モーダルの担当
- **締め日**: `Setting.closingDay`（既定25）。締め期間 = 前月(closingDay+1)日〜当月closingDay日。
  計算は `lib/closing.ts` の共通関数を使う。**新規に日付範囲を書くとき暦月ベタ書き禁止**
- **残業の二重基準**: 打刻時保存値=法定8h(480分)超過分。承認・表示時=所定時間超過分。「残業計算を直す」は両方の確認要（**リリース2で解消**：残業＝早出＋終業後に一本化し全経路共通。リリース2のデプロイ後はこの行を削除）
- **休日出勤の考え方**（2026-10-07 熊谷さん）: **休日出勤の場合は**、勤務時間も休憩も上長が確認して承認したときに初めて有効になる。休日は社内に誰もいない可能性が高く、平日のように周りが勤務や休憩を確かめられないため。休日出勤申請の時刻・休憩分数は承認されるまで計算に入れず、申請が無い日は在席時間で休憩を決めて知らせで申請を促す
  - **平日には広げない**（すべての場面で上長の確認を求めると手間が増えすぎるため）。平日の休憩はボタン・規定値・申請で決める従来どおり
- **管理者の確定修正（リリース2）**: 管理者の直接修正・代理打刻の時刻は admin 列に保存し、丸め・④を通さず最後に上書き。「管理者の修正を取り消す」で1つ前に戻せる。詳細 `docs/CLOCK_PIPELINE.md` 段6.5
- **LEAVE反映**: `leaveType="paid"`（有給）のみ勤怠へ反映（paidLeaveMinutes）。substitute（振休）・special・遅刻早退報告は AttendanceRecord 非反映
- **半日有給**: `lib/attendance.ts` の `calcScheduledMinutes()` で算出した本人所定時間の半分（四捨五入）。全休も同関数で本人所定時間そのまま（2026-07-10〜、旧仕様は480/240固定）。半休判定は `halfDay === "am" || === "pm"`（"full" が truthy な点に注意）
- **申請タイプはUIとDBで別**: UI `EARLY_START`→DB `OVERTIME`+`detail.overtimeType="earlyStart"`、UI `LEAVE_PAID/LEAVE_SUB`→DB `LEAVE`+`leaveType="paid"/"substitute"`。DB enum だけ grep すると見落とす
- **除外ユーザー基準**: 一覧/承認/Excel とも部署名 `department notIn ["管理者","管理職"]` に統一（2026-07-06〜）。Excel は加えて `employmentType in ["full","part"]`
- **要確認（従業員向け）は理由ごと**（2026-10-06〜）: 理由＝遅刻・早退・退勤漏れ（`calcReviewReasons`）。遅刻早退申請（ABSENCE、`detail.absenceType` が "late"/"early"。"absent" は欠勤）は承認で該当する理由だけ打ち消す（`resolveEmployeeReview`）。退勤漏れは打刻修正でしか消えない。ホーム件数・/records 表示・修正依頼ボタンは必ず同じ判定を使う。管理者向け（勤務状況一覧・承認詳細）は `calcNeedsReview`＝「管理者自身がまだ勤怠承認していない日」の目印で、申請状態では消さない
- **勤怠承認は経路が2つ**（一覧の承認 `actionApproveMonth`・承認詳細の一括承認 `actionBulkApprove`）。どちらも `lib/approve-records.ts` で遅刻・早退・残業を計算して保存する。**同じ意味の操作は挙動をそろえる**（片方だけ直さない）。締め解除（ADMIN のみ、LOCKED→APPROVED、変更履歴 fieldName="status"）あり。注意：承認し直すと遅刻・早退は再計算で上書きされる（休日出勤の0もリリース2までは消える）
- **Excel（個人別日別勤務報告書）の列の意味**（2026-10-06〜・旧勤怠Reco 準拠）: 出勤・退勤＝実打刻（証跡の表示。無ければ空欄）／勤務時間＝記録時刻の時間帯／変更出勤・退勤＝出退勤の変更履歴がある日だけ両方（直した側は記録時刻、直していない側は実打刻）／遅刻早退＝「遅 0:30」「早 2:00」の文字表記。保存値が無い日は画面と同じく計算する。整形は `lib/export-format.ts`
- **紐づけ（/link）**: state は `lib/link-state.ts` で AUTH_SECRET による HMAC 署名＋15分期限。サーバーアクション側で必ず検証してから使う。紐づけ済みかどうかは `Account` の有無で判定（メールアドレスの形で推測しない）
- **申請承認は部署により多段階**: `ApprovalRoute` に経路がある部署は step 順の承認が必要（最終 step 承認で APPROVED + 勤怠反映）。経路なし部署は一段階。判定は `lib/approval.ts`
- **日付の保存規約（2026-09-29 確認）**: 「その日」を表す日付（勤怠記録の `date`・休日の `date`・締め期間）は**UTC 0時を日付の通し番号として保存**する。**人間は常に日本時間の日付で考えている**ので、入力（画面・CSV・シード）では「日本時間の日付 → UTC 0時」に変換して保存し、表示では日本時間に戻す。`new Date(y, m-1, d)`（サーバーのローカル＝JST 0時）で保存しない — 2026-09 の山の日ずれ（祝日シードだけ JST 0時保存・Excel は UTC 日付で照合）の原因。schema.prisma のコメント「00:00:00 JST」は実態と違う（修正予定）
- **JST↔UTC**: DB は UTC 保存。日付基準を作るとき「+9hしてから日付部品を取り、-9h」する。`getUTCDate()` を先に呼ぶと JST 0:00〜8:59 で前日にズレる（過去に丸め全滅バグの根因）

## ファイルマップ（要点）

- `lib/attendance.ts` — 丸め・calcNeedsReview・getDisplayStatus・calcMetrics・calcScheduledMinutes・calcWorkingMinutes
- `lib/closing.ts` — 締め期間計算の共通関数
- `lib/approval.ts` — 申請の多段階承認判定（経路・現在ステップ・進捗）
- `config/attendance.config.ts` — 法定休憩ルール（ハードコード。Setting の閾値とは別物）
- `app/(app)/clock/actions.ts` — 打刻サーバーアクション（丸め適用・workingMinutes確定）
- `app/(app)/admin/requests/actions.ts` — 申請承認時の勤怠反映
- `app/(app)/admin/approval/[userId]/actions.ts` — 承認・締め・直接編集（late/earlyLeave確定）
- `app/api/admin/export-xlsx/route.ts` — Excel出力（33列）
- 期間基準: records / admin/attendance / admin/approval / home / admin/requests / export-xlsx すべて締め期間

## 修正時の作法

- 変更前に `.claude/skills/kintai-fix` のワークフローに従い、仕様理解を before/after 具体例でユーザーと合意する
- 修正後、このファイルと `DOMAIN_REFERENCE.md` の該当箇所が古くなっていないか確認・更新する
