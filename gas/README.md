# 勤怠管理システム - Google Apps Script セットアップガイド

## 概要

このガイドでは、勤怠アプリとGoogleスプレッドシートを連携させるためのGoogle Apps Script（GAS）の設定手順を説明します。

---

## セットアップ手順

### STEP 1：Googleスプレッドシートを作成

1. [Google スプレッドシート](https://sheets.google.com/) を開く
2. 「空白」をクリックして新規スプレッドシートを作成
3. 名前を「勤怠管理」などに変更
4. **スプレッドシートID**をメモ（URLの `/d/` と `/edit` の間の文字列）

例：`https://docs.google.com/spreadsheets/d/1ABC123xyz.../edit`
→ ID は `1ABC123xyz...`

---

### STEP 2：Apps Scriptを開く

1. スプレッドシートのメニューから「拡張機能」→「Apps Script」を選択
2. 新しいタブでApps Scriptエディタが開く

---

### STEP 3：コードを貼り付け

1. デフォルトの `Code.gs` の内容をすべて削除
2. `gas/Code.gs` の内容を貼り付け
3. **重要**：`SPREADSHEET_ID` を実際のIDに置き換え

```javascript
const SPREADSHEET_ID = '1ABC123xyz...'; // ← ここを変更
```

---

### STEP 4：初期設定を実行

1. Apps Scriptエディタで関数選択を「setupSpreadsheet」に変更
2. 「▶ 実行」ボタンをクリック
3. 権限の確認ダイアログが表示されたら許可
4. スプレッドシートに以下のシートが作成される：
   - 打刻ログ
   - 社員マスタ
   - 修正ログ

---

### STEP 5：社員マスタをインポート

1. スプレッドシートの「社員マスタ」シートを開く
2. `employees.csv` のデータをコピー＆ペースト
3. または「ファイル」→「インポート」からCSVを読み込み

---

### STEP 6：Webアプリとしてデプロイ

1. Apps Scriptエディタで「デプロイ」→「新しいデプロイ」をクリック
2. 歯車アイコン→「ウェブアプリ」を選択
3. 設定：
   - 説明：勤怠管理API
   - 実行するユーザー：**自分**
   - アクセスできるユーザー：**全員**（または組織内の全員）
4. 「デプロイ」をクリック
5. 表示された **ウェブアプリURL** をメモ

例：`https://script.google.com/macros/s/AKfy.../exec`

---

### STEP 7：アプリにURLを設定

`script.js` と `admin.js` に以下の行を追加（ファイル先頭）：

```javascript
const GAS_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

---

## APIの使い方

### 打刻を記録（POST）

```javascript
fetch(GAS_URL, {
  method: 'POST',
  body: JSON.stringify({
    action: 'punch',
    employeeId: '003',
    employeeName: '鈴木一成',
    punchType: '出勤',
    reason: '',
    latitude: 35.6762,
    longitude: 139.6503,
    locationStatus: 'success',
    email: 'issei@iwaki-i.com'
  })
});
```

### 今日の打刻を取得（GET）

```javascript
fetch(`${GAS_URL}?action=getTodayRecords`)
  .then(res => res.json())
  .then(data => console.log(data.records));
```

### 社員一覧を取得（GET）

```javascript
fetch(`${GAS_URL}?action=getEmployees`)
  .then(res => res.json())
  .then(data => console.log(data.employees));
```

---

## トラブルシューティング

### エラー：アクセス権限がありません

→ デプロイ設定で「アクセスできるユーザー」を確認

### エラー：スプレッドシートが見つかりません

→ `SPREADSHEET_ID` が正しいか確認

### 打刻がスプレッドシートに反映されない

→ Apps Scriptの実行ログを確認（表示→ログ）

---

## 次のステップ

- [ ] Googleログイン実装（OAuth2.0）
- [ ] QRコード生成
- [ ] 自動集計・月次レポート
