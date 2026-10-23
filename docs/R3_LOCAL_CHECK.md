# リリース3 デプロイ前の確認（本番の複製で DB の変更を試し、手元で画面を確認する）

作成 2026-10-15。リリース2の確認（一時 DB `db_kintai_r2ui`）と同じ方法。本番には一切触れない。`db_kintai_dev` は使わない。

- 一時 DB：`db_kintai_r3ui`／使い捨てのユーザー：`r3ui`（パスワードは実施時に決める。`@` `:` `/` は使わない）
- 手元のトンネルは **15432 番**（本番用の 5432 番と取り違えないため）

---

## 1. VPS で（熊谷さん）

```bash
ssh -i "C:\Users\kumag\.ssh\kagoya\kagoya.key" ubuntu@133.18.123.23
```

ログインしてから、1行ずつ実行する（まとめて貼らない）。`YYYYMMDD` は当日の日付、`<PW>` は決めたパスワード。

```bash
# 本番のバックアップ（所有者・権限の情報を含めない形。一時 DB に入れるため）
pg_dump -h 127.0.0.1 -U ippcdb --no-owner --no-privileges db_kintai > ~/backup_YYYYMMDD_r3check.sql
ls -lh ~/backup_YYYYMMDD_r3check.sql

# 使い捨てのユーザーと一時 DB
sudo -u postgres psql -c "CREATE USER r3ui WITH PASSWORD '<PW>';"
sudo -u postgres createdb -O r3ui db_kintai_r3ui

# 一時 DB へ流し込む（r3ui で入れるので、テーブルの持ち主も r3ui になる）
PGPASSWORD='<PW>' psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U r3ui -d db_kintai_r3ui -f ~/backup_YYYYMMDD_r3check.sql > /dev/null && echo RESTORE_OK
```

`RESTORE_OK` が出たら、VPS からログアウトしてよい。

## 2. 手元で（Claude が実行）

1. 熊谷さんがトンネルを張る（別の端末で開いたままにする）
   ```
   ssh -i "C:\Users\kumag\.ssh\kagoya\kagoya.key" -N -L 15432:127.0.0.1:5432 ubuntu@133.18.123.23
   ```
2. Claude が、一時 DB を指定して DB の変更を流す（**本番の deploy.sh と同じ `prisma migrate deploy` の試験**）
   ```
   DATABASE_URL="postgresql://r3ui:<PW>@localhost:15432/db_kintai_r3ui" npx prisma migrate deploy
   ```
   - **DATABASE_URL を必ずコマンドの先頭で指定する**。指定を忘れると `prisma.config.ts` が `.env` を読み、`db_kintai_dev` に流れてしまう（使わない約束の DB）。指定した値は `.env` より優先される
   - 流れるのは `20261013000000_approval_route_multi_approver` の1本だけのはず。エラーが出たら止めて報告する
   - 確認：承認経路の一意キーが「部署×step×承認者」に変わったこと、既存の経路の行数が変わらないこと
3. Claude が、同じ一時 DB を指定してアプリを起動する（`.env.local` の DATABASE_URL は書き換えない。起動するときだけ指定する）
   ```
   DATABASE_URL="postgresql://r3ui:<PW>@localhost:15432/db_kintai_r3ui" npm run dev
   ```
4. 熊谷さんが手元のブラウザで http://localhost:3000 を開き、Google でログインする
   - ログインできないときは、Google の設定に localhost の戻り先が残っているかを確認する（リリース2では使えた）

## 3. 画面の確認（熊谷さん。一時 DB なので、申請・設定を自由に変えてよい）

### 時刻入力のスピナー（申請 → 新規申請）
- [ ] 残業申請：終了時刻の初期値が自分の退勤時刻になっている
- [ ] ▲▼ を1回押すと時は1、分は15ずつ変わる。押し続けると連続で変わる
- [ ] 時・分の数字を直接入力し、欄から離れると分が近い15分に直る（例：07 → 00、08 → 15）
- [ ] 時刻を空欄のまま送ろうとすると止まる（定時の無い人の残業開始時刻など）
- [ ] 早出・遅刻早退・打刻修正・休日出勤の時刻も、同じように選べる
- [ ] 休日出勤：開始・終了を変えると、休憩の初期値が追従する
- ※ iPhone での確認はデプロイ後（手元の PC 経由では見られない）

### 定時の無いパート（ユーザー管理で、誰か1人の定時を空欄にして試す）
- [ ] ユーザー編集画面に「シフト勤務の人は空欄に」の説明が出る
- [ ] その人に切り替えて（またはその人の申請として）残業申請を開くと「残業開始時刻」が出る
- [ ] 申請一覧に「残業 16:00〜18:00」のように表示される

### 承認経路の複数名（承認経路の画面）
- [ ] 同じ部署・同じ step に2人目を追加できる（上書きされない）
- [ ] 一覧で2人目の行に step 名が繰り返されず、「いずれか1名」と出る
- [ ] その部署の人の申請で、どちらか1人が承認すると次の step に進む（進捗が 1/2 になる）

### 計算（承認詳細で何人かを見る。数字は計算し直した記録だけ変わる）
- [ ] パートの所定休憩を60分にして、その人の承認詳細で「一括承認」→ 休憩の記録が無い日に60分引かれる
- [ ] パートが定時を過ぎて退勤した日、残業申請が無ければ残業0（8時間を超えた日を除く）
- [ ] 正社員が早退した日、休憩が60分になる（早退申請で答えた日はその値）
- [ ] 会社設定の⑤の説明が「正社員の残業の式」になっている
- [ ] Excel の上部の「有給使用」が日数だけになっている

### マニュアル
- [ ] /manual と /admin/manual が新しい内容で表示される

## 4. 後片付け（VPS で）

```bash
sudo -u postgres dropdb db_kintai_r3ui
sudo -u postgres psql -c "DROP USER r3ui;"
```

- バックアップ `~/backup_YYYYMMDD_r3check.sql` は消さずに残す（社員の個人データを含むので、手元にダウンロードする場合はリポジトリの外へ）
- 手元のアプリを止め、トンネルを閉じる

## 5. この確認のあとに（デプロイ当日）

- 深夜か休日に行う（リリース3は計算の決め方が変わるため。打刻・承認した記録から順に新しい計算になる）
- `git push origin main` → VPS で `bash ~/deploy.sh`（ssh でログインしてから打つ）
- デプロイ前のバックアップと、`docs/DEPLOY_CHECKLIST.md` の「リリース3」の項目に従う
