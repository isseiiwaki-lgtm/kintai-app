# Googleログイン設定ガイド

## 概要

勤怠アプリでGoogleログインを有効にするための設定手順です。
Google Cloud ConsoleでOAuthクライアントIDを取得し、アプリに設定します。

---

## セットアップ手順

### STEP 1：Google Cloud Projectを作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 左上のプロジェクトセレクターをクリック
3. 「新しいプロジェクト」をクリック
4. プロジェクト名：「勤怠管理」など
5. 「作成」をクリック

---

### STEP 2：OAuth同意画面を設定

1. 左メニューから「APIとサービス」→「OAuth同意画面」
2. ユーザーの種類：
   - **内部**（Workspaceユーザーのみ）← 推奨
   - または **外部**
3. 「作成」をクリック
4. 必要情報を入力：
   - アプリ名：勤怠打刻
   - ユーザーサポートメール：your-email@iwaki-i.com
   - デベロッパーの連絡先：your-email@iwaki-i.com
5. 「保存して次へ」

---

### STEP 3：OAuthクライアントIDを作成

1. 左メニューから「APIとサービス」→「認証情報」
2. 「+認証情報を作成」→「OAuthクライアントID」
3. アプリケーションの種類：**ウェブアプリケーション**
4. 名前：勤怠アプリ
5. **承認済みのJavaScriptの生成元**に以下を追加：
   - `http://localhost:3000`（開発用）
   - `https://your-domain.com`（本番用）
6. 「作成」をクリック
7. 表示された**クライアントID**をコピー

---

### STEP 4：アプリにクライアントIDを設定

`script.js`の16行目を編集：

```javascript
// 変更前
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

// 変更後（例）
const GOOGLE_CLIENT_ID = '123456789-abcdefg.apps.googleusercontent.com';
```

---

### STEP 5：ドメイン制限を設定（オプション）

`script.js`の19行目でドメインを設定：

```javascript
// 会社ドメインのみ許可
const ALLOWED_DOMAIN = 'iwaki-i.com';

// 制限なし（誰でもログイン可能）
const ALLOWED_DOMAIN = '';
```

---

## 動作確認

1. `http://localhost:3000/kintai-app/` を開く
2. 「ログイン」ボタンをクリック
3. Googleアカウントを選択
4. 社員マスタに登録されているメールアドレスならログイン成功

---

## 開発モード（クライアントID未設定時）

クライアントIDが設定されていない場合、社員選択ダイアログが表示されます。
これを使って開発・テストが可能です。

---

## トラブルシューティング

### エラー：許可されていないドメインです

→ ログインしたGoogleアカウントのドメインが`ALLOWED_DOMAIN`と一致していない

### エラー：社員として登録されていません

→ 社員マスタ（`employees.csv`）にメールアドレスが登録されていない

### ログインポップアップが表示されない

→ ブラウザのポップアップブロックを確認
→ クライアントIDが正しいか確認
→ 承認済みのJSオリジンにURLが登録されているか確認
