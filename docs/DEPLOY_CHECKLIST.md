# デプロイ前チェックリスト

VPS（<https://kintai.iwaki-i.online>）反映前に必ず全項目を確認する。
※ デプロイ実体（deploy.sh 等）は VPS 上にあり本リポジトリ未収録。手順が実態と異なる場合はこのファイルを実態に合わせて更新すること。

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

- [ ] git pull（VPS 側）
- [ ] `npm ci`（依存変更があった場合）
- [ ] `npx prisma migrate deploy`（migration がある場合。**実行前に DB バックアップ**）
- [ ] `npm run build`
- [ ] pm2 restart（プロセス名は VPS の pm2 list で確認）

## 4. 反映後スモーク確認（本番画面）

- [ ] ログイン → ホーム表示
- [ ] 打刻画面: 当日打刻の表示
- [ ] 勤怠記録 `/records`: 当月（締め期間）一覧表示
- [ ] 管理者: 勤務状況一覧・申請承認・Excel出力が開ける
- [ ] 今回変更した機能の動作を実データで1件確認（例: 丸め変更なら翌朝の実打刻で確認）

## 5. ロールバック方針

- 反映後に不具合発見 → git revert して再デプロイ（migration を伴う場合は要個別判断・DB バックアップから復旧）
- 計算式変更で誤集計が保存された場合 → 修正後に `POST /api/admin/recalculate` で再計算（丸めは再適用されない点に注意）
