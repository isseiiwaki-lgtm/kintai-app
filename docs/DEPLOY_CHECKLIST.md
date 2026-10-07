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
