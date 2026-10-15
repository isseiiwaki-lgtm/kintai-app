# デプロイ前チェックリスト

VPS（<https://kintai.iwaki-i.online>）反映前に必ず全項目を確認する。
※ デプロイ実体は VPS の `~/deploy.sh`（本リポジトリ未収録）。接続情報・運用メモは `.resource/.secret/.for-human.md` 参照。

## 1. ローカル検証（コミット前）

- [ ] `npx tsc --noEmit` — 型エラーなし
- [ ] `npm run test` — 回帰テスト全PASS（丸め・休憩・要確認・締め期間の境界値）
- [ ] `npm run build` — 本番ビルド成功
- [ ] 変更が勤怠ロジックの場合: `docs/DOMAIN_MAP.md` / `DOMAIN_REFERENCE.md` の該当箇所を更新済み
- [ ] `docs/STATUS.md` 変更履歴に追記済み

## 2. データ影響の確認（勤怠ロジック変更時のみ）

- [ ] 過去データへの遡及影響があるか判断した（丸め・計算式・控除の変更は原則あり）
- [ ] 遡及影響ありの場合: `docs/DATA_SPEC_HISTORY.md` に記録した
- [ ] 遡及補正が必要な場合: `POST /api/admin/recalculate` の実行要否・タイミングを決めた
- [ ] schema.prisma 変更ありの場合: migration ファイル生成済み・本番 DB バックアップ計画あり

## 3. VPS 反映

- 注意（2026-10-14）：`git push` と `ssh ...` と `bash ~/deploy.sh` を1回で貼ると、ssh でログインした時点で `deploy.sh` が手元側に残り、VPS では実行されない。**ssh でログインしてから `bash ~/deploy.sh` を打つ**

- [ ] git push 済み（VPS は origin から pull する）
- [ ] migration がある場合: **実行前に DB バックアップ** `pg_dump -h 127.0.0.1 -U ippcdb db_kintai > ~/backup_$(date +%Y%m%d).sql`
      - VPS の `~/.pgpass`（2026-10-06 作成・chmod 600）に DB パスワードを保存済みなので、パスワード入力は不要。手元から1行で実行できる：`ssh -i "C:\Users\kumag\.ssh\kagoya\kagoya.key" ubuntu@133.18.123.23 'pg_dump -h 127.0.0.1 -U ippcdb db_kintai > ~/backup_YYYYMMDD.sql && chmod 600 ~/backup_YYYYMMDD.sql && ls -lh ~/backup_YYYYMMDD.sql'`（PowerShell では外側をシングルクォートに。`$(date)` は手元で解釈されるので日付は直接書く）
      - DB の接続 URL はパスワードに `@` を含むため、URL 形式のまま psql/pg_dump に渡すと失敗する。`-h/-U` で渡す
      - **バックアップはサーバー内に残し、手元にもダウンロードする**（リリース2のようにデータを大きく変える回は必須）。Git Bash から：
        `scp -i "C:/Users/kumag/.ssh/kagoya/kagoya.key" ubuntu@133.18.123.23:backup_YYYYMMDD.sql "D:/backup/kintai/"`
        - 保存先はリポジトリの外（社員の個人データを含むため、git に入れない）。ダウンロード後にファイルサイズがサーバー側と同じか確認する
        - サーバー側のバックアップは消さない（2026-10-07 の複製テスト用 `~/backup_20261007_r2check.sql` も残す）
- [ ] **リリース2のみ：移行（migration）の前に次の2点を確認する。どちらかが満たせなければ deploy.sh を実行しない**
      - 本番の PostgreSQL のバージョン：`psql -h 127.0.0.1 -U ippcdb -d db_kintai -tAc "SHOW server_version;"`
        - 移行の SQL（20261007000000 の再帰 CTE）は PostgreSQL 18.3 でだけ実行を確認済み（`docs/REVIEW_R2_PIPELINE_2026-10-07.md`）
        - 18 以外なら、下の「バックアップの複製で試す」を先に行う
        - 2026-10-07 時点の本番は **16.15**（Ubuntu 16.15-0ubuntu0.24.04.1）
        - 2026-10-07 に複製で実施済み：リリース2 の4本（20261006・20261007×3）すべて成功。admin 列へ写ったのは7記録（出勤2・退勤6）で、いずれも申請に由来しない管理者の修正・代理打刻と確認（`docs/REVIEW_R2_PIPELINE_2026-10-07.md`）。当日はバージョンが 16.15 のままで、migration に変更が無ければ複製テストは省略してよい
        - 2026-10-07 23:56 に6本（20261006・20261007000000〜000400）で再実施し成功：admin 列へ写るのは7記録、スイッチ状態①〜⑤の書き込みは1,613件（⑤はすべて OFF）、休日出勤の印は0件。バックアップ `backup_20261007_r2check2.sql` を VPS と `D:/backup/kintai/` に保管。**以後 migration を足した・変えた場合は複製テストをやり直す**
        - 2026-10-08 18:53 に7本（＋20261008000100_add_is_full_time_part）で再実施し成功：記録1,728件、admin 列へ写るのは7記録、⑤OFF の書き込み1,629件、休日出勤の印0件、フルタイムパート0人（デプロイ後に野﨑・羽山へ設定）。バックアップ `backup_20261008_r2check3.sql` を VPS と `D:/backup/kintai/` に保管
        - 手元の PowerShell から ssh 越しに打つと内側の引用符が崩れる。VPS にログインしてから打つか、Git Bash から `ssh ... "psql ... -tAc 'SHOW server_version;'"` の形で打つ
      - 20261007 の migration が本番 DB に未適用であること（途中で中身を書き換えたため、適用済みだと不一致になる）：
        `psql -h 127.0.0.1 -U ippcdb -d db_kintai -tAc "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '20261007%';"` → 0行であること
      - バックアップの複製で試す（バージョンが 18 以外のとき）：
        1. 上のバックアップを取ったあと、複製用の DB を作る：`createdb -h 127.0.0.1 -U ippcdb db_kintai_r2check`
           （権限が無くて作れないときは `sudo -u postgres createdb -O ippcdb db_kintai_r2check`）
        2. 複製へ流し込む：`psql -h 127.0.0.1 -U ippcdb -d db_kintai_r2check -f ~/backup_YYYYMMDD.sql`
        3. git pull 後のリポジトリで、20261007 の3本を名前順に適用する：
           `for f in prisma/migrations/20261007*/migration.sql; do psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U ippcdb -d db_kintai_r2check -f "$f" || break; done`
        4. エラーなく終わること。admin 列に写った件数を見て、多すぎないか確認する：
           `psql -h 127.0.0.1 -U ippcdb -d db_kintai_r2check -tAc 'SELECT count(*) FROM "AttendanceRecord" WHERE "adminClockIn" IS NOT NULL OR "adminClockOut" IS NOT NULL;'`
        5. 複製を消す：`dropdb -h 127.0.0.1 -U ippcdb db_kintai_r2check`
        - エラーが出たら deploy.sh を実行せず、Claude に出力を渡して判断する
- [ ] `ssh -i "C:\Users\kumag\.ssh\kagoya\kagoya.key" ubuntu@133.18.123.23` でログインし `bash ~/deploy.sh` を実行
      （git pull → npm ci → prisma generate → migrate deploy → build → pm2 restart を一括実行）
- [ ] 注意: pm2 のプロセス名は `kintai`・**ubuntu ユーザーで操作**（`sudo pm2` は root 側の別リストを見てしまう）
- [ ] ログ確認: `pm2 logs kintai --lines 50` にエラーがない

## 4. 反映後スモーク確認（本番画面）

- [ ] ログイン → ホーム表示
- [ ] 打刻画面: 当日打刻の表示
- [ ] 勤怠記録 `/records`: 当月（締め期間）一覧表示
- [ ] 管理者: 勤務状況一覧・申請承認・Excel出力が開ける
- [ ] 今回変更した機能の動作を実データで1件確認（例: 丸め変更なら翌朝の実打刻で確認）
- [ ] **リリース2では一括再計算（`/api/admin/recalculate`）を押さない**（2026-10-08 熊谷さん了承。過去のデータはなるべく変えない）。新しい計算にそろえる必要が出たときは、変えたくない期間を先に一括締め（LOCKED）してから押す
- [ ] **リリース2のみ・デプロイ後**：ユーザー管理で野﨑・羽山に「フルタイムパート」のチェックを入れる（半日有給を取れるパート）
- [ ] **リリース2のみ・上の後に**：管理者が 8/26 野﨑の有給申請を管理者の申請画面で開いて保存し直す（種類 "annual" → "paid" で Excel の有給集計に入る。午後休として計算し直され、早退が消え有給は午後の時間になる見込み）

- [ ] **リリース3（作業O を含む）**：migration は1本（`20261013000000_approval_route_multi_approver`。承認経路の一意キーを「部署×step」から「部署×step×承認者」へ付け替えるだけ）。デプロイ前に本番の複製で流して成功を確認する
- [ ] **リリース3・デプロイ後**：申請フォームの時刻入力（スピナー）を iPhone と PC で確認（▲▼・長押し・直接入力・欄を離れたときの15分補正）／定時を空欄にしたパートで残業申請に「残業開始時刻」が出ること
- [ ] **リリース3・デプロイ後も一括再計算を押さない**。今期の計算し直しは作業O5（1人ずつドライランを熊谷さんに見せてから書き込む）

## 4.5 締め期間の初日の切り替え（リリース2：2026-10-26 の朝、業務開始前）

- [ ] **前提（ON にする前）**：シフト勤務のパート（岡田さんなど）の定時が空欄になっていること。定時が実際と違うまま④を ON にすると、申請の無い日は定時で打ち切られ、勤務0分・遅刻が毎日付く（`docs/ADMIN_BREAK_RULE_CONFIRM_2026-10.md` の 3）
- [ ] 設定画面でスイッチ③④⑤を ON にする（①②は ON のまま）
- [ ] 同じ画面で、休憩時間控除ルールの**ルール1を「360分超で60分」**に変える（ルール2は「480分超で60分」のまま。ルール1と同じ値でも結果は同じ）
  - 判定は定時の拘束時間に対する「超」。9:00〜17:00（480分）→ 60分・所定7:00、6時間以下 → 0分
  - 効くのは⑤ON の記録の正社員だけ（⑤OFF の過去の記録は法定の値のまま）。例外の人はユーザー設定の所定休憩で個別に決める
  - ルール2を空にしない（空は0として扱われ、全員の休憩が0分になる。サーバー側でも断るよう修正予定）
  - 将来、会社の休憩の決まりが変わったときもこのルールで対応する（2026-10-08 熊谷さん了承）
- [ ] **⑤ON の後・管理者が 9/26〜10/25 を承認する前に**：櫻田さんの 10/14〜10/25 の記録を⑤ON で計算し直す（2026-10-13 に 9/28〜10/13 の10件は実施済み。経緯は STATUS 2026-10-13）
  - SSH トンネル（手元 5432 → VPS 5432）を張り、`.env.local` の本番 DATABASE_URL で実行：`npx tsx --tsconfig tsconfig.json scripts/fix-sakurada-newcalc-2026-10.ts`（ドライラン）→ 結果を確認して `--apply`（対象行を `.resource/backup/` に JSON 退避してから書き込む）
  - 確認：`scripts/survey-newcalc-diff-2026-10.ts` の差分一覧に櫻田さんが出ないこと
  - 終わったら管理者に「櫻田さんの補正が終わったので今月分を承認してよい」と知らせる（`docs/ADMIN_BREAK_RULE_CONFIRM_2026-10.md` の 4 で約束済み）

## 5. トラブルシュート（実例）

- **デプロイしたのに旧画面のまま / CSSが崩れる / 一部ページだけ表示不能 / pm2 restart が効かない**（2026-07-06 発生・2026-09-28 再発）
  - **根本原因**: pm2 管理外の **systemd ユニット `kintai.service`**（`/etc/systemd/system/kintai.service`・`enabled`・2026-06-17作成）が存在し、**VPS再起動のたびに自動起動してポート3000を先に占有**する。pm2側の`kintai`はEADDRINUSEで起動失敗ループに陥る。旧プロセスが稼働中に`npm run build`で`.next`を上書きすると、一部ページでモジュール解決に失敗し個別に表示不能になることがある（2026-09-28は`/admin/users`で発生）
  - 2026-07-06時点ではプロセスを`kill`しただけで**systemdユニット自体を無効化していなかった**ため、9/28の再起動で再発した。**恒久対応は kill ではなくユニットの停止・無効化**
  - 確認: `systemctl status kintai.service`（active になっていないか）/ `ss -ltnp | grep 3000`（PIDを見る）+ `pm2 logs kintai --lines 20`（EADDRINUSE が出ていないか）
  - 恒久処置: `sudo systemctl stop kintai.service && sudo systemctl disable kintai.service` → `pm2 restart kintai` → `pm2 save`
  - **再起動作業（サーバー再起動・障害復旧等）の前後は必ず `systemctl status kintai.service` で `disabled`/`inactive` のままか確認する**
  - **自動起動は pm2 の systemd ユニット `pm2-ubuntu` が担当**（2026-10-06 に `pm2 startup systemd -u ubuntu --hp /home/ubuntu` → `pm2 save` で設定。kintai.service を止めてから未設定だったため、それまでは再起動するとアプリが起動しない状態だった）。pm2 のプロセス構成を変えたら `pm2 save` を忘れない。再起動後は `systemctl is-enabled pm2-ubuntu` が enabled、`pm2 list` で kintai が online を確認
- **OS 更新**（2026-10-06 実施）：`sudo apt update && sudo apt full-upgrade -y && sudo apt autoremove -y` → `/var/run/reboot-required` があれば再起動。`cloud-init` は hold 設定のため更新されずに1件残るのが正常
- pm2 に kintai が見えない → `sudo pm2` を使っていないか確認（root側の別リストを見てしまう。**ubuntu ユーザーで操作**）

## 6. ロールバック方針

- 反映後に不具合発見 → git revert して再デプロイ（migration を伴う場合は要個別判断・DB バックアップから復旧）
- 計算式変更で誤集計が保存された場合 → 修正後に `POST /api/admin/recalculate` で再計算（丸めは再適用されない点に注意）
