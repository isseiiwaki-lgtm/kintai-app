# VPSサーバーセットアップ手順書

## 環境情報

| 項目 | 内容 |
|------|------|
| サーバー | KAGOYA VPS |
| OS | Ubuntu 24.04.4 LTS |
| スペック | 2コア / 2GB RAM / 200GB |
| 勤怠アプリ | kintai.iwaki-i.online |
| n8n | n8n.iwaki-i.online |
| ドメイン管理 | ムームードメイン（AレコードでサブドメインをサーバーIPに割り当て済み） |

---

## 1. システム更新と基本ツールのインストール

```bash
# パッケージ情報の更新とシステムアップグレード
sudo apt update && sudo apt upgrade -y

# Git・curl・wget・unzip などの基本ツールをインストール
sudo apt install -y git curl wget unzip ufw
```

---

## 2. ファイアウォール設定（ufw）

```bash
# SSH接続を許可
sudo ufw allow OpenSSH

# HTTP・HTTPSを許可
sudo ufw allow 80
sudo ufw allow 443

# ファイアウォールを有効化（確認メッセージが出たら y を入力）
sudo ufw enable

# 設定内容を確認
sudo ufw status
```

---

## 3. Node.js v20 LTS のインストール

```bash
# NodeSourceのセットアップスクリプトを実行
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Node.js をインストール
sudo apt install -y nodejs

# バージョン確認
node -v
npm -v
```

---

## 4. PM2 と n8n のインストール

```bash
# PM2（Next.jsプロセス管理）とn8n（ワークフロー自動化）をグローバルインストール
sudo npm install -g pm2 n8n

# バージョン確認
pm2 -v
n8n --version
```

---

## 5. PostgreSQL のインストール

```bash
# PostgreSQL 本体と追加モジュールをインストール
sudo apt install -y postgresql postgresql-contrib

# サーバー起動時に自動起動するよう設定
sudo systemctl enable postgresql

# 起動状態を確認
sudo systemctl status postgresql
```

---

## 6. Nginx のインストール

```bash
# Nginx をインストール
sudo apt install -y nginx

# サーバー起動時に自動起動するよう設定
sudo systemctl enable nginx

# 起動状態を確認
sudo systemctl status nginx
```

---

## 7. Certbot（SSL証明書）のインストール

```bash
# Certbot 本体とNginxプラグインをインストール
sudo apt install -y certbot python3-certbot-nginx

# バージョン確認
certbot --version
```

---

## 8. Nginx 仮設定（SSL取得前）

```bash
# 勤怠アプリ用の仮設定ファイルを作成
sudo nano /etc/nginx/sites-available/kintai.iwaki-i.online
```

```nginx
server {
    listen 80;
    server_name kintai.iwaki-i.online;
    root /var/www/html;
}
```

```bash
# n8n用の仮設定ファイルを作成
sudo nano /etc/nginx/sites-available/n8n.iwaki-i.online
```

```nginx
server {
    listen 80;
    server_name n8n.iwaki-i.online;
    root /var/www/html;
}
```

```bash
# 設定ファイルを有効化
sudo ln -s /etc/nginx/sites-available/kintai.iwaki-i.online /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/n8n.iwaki-i.online /etc/nginx/sites-enabled/

# 設定の構文チェック
sudo nginx -t

# Nginx を再読み込み
sudo systemctl reload nginx
```

---

## 9. SSL証明書の取得

```bash
# 2ドメイン分まとめてSSL証明書を取得（Nginxに自動適用される）
# 実行中にメールアドレスの入力・利用規約への同意を求められる
sudo certbot --nginx -d kintai.iwaki-i.online -d n8n.iwaki-i.online
```

> 証明書は自動更新設定済み（有効期限：90日）。更新は certbot のタイマーが自動で処理する。

---

## 10. Nginx 本設定（リバースプロキシ）

### 勤怠アプリ（ポート3000）

```bash
sudo nano /etc/nginx/sites-available/kintai.iwaki-i.online
```

```nginx
server {
    server_name kintai.iwaki-i.online;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/kintai.iwaki-i.online/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/kintai.iwaki-i.online/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = kintai.iwaki-i.online) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name kintai.iwaki-i.online;
    return 404; # managed by Certbot
}
```

### n8n（ポート5678）

```bash
sudo nano /etc/nginx/sites-available/n8n.iwaki-i.online
```

```nginx
server {
    server_name n8n.iwaki-i.online;

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/kintai.iwaki-i.online/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/kintai.iwaki-i.online/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = n8n.iwaki-i.online) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name n8n.iwaki-i.online;
    return 404; # managed by Certbot
}
```

```bash
# 設定の構文チェック
sudo nginx -t

# Nginx を再読み込み
sudo systemctl reload nginx
```

---

## 11. n8n の systemd サービス化

```bash
# n8n のサービスファイルを作成
sudo nano /etc/systemd/system/n8n.service
```

```ini
[Unit]
Description=n8n workflow automation
After=network.target

[Service]
Type=simple
User=ubuntu
Environment=N8N_HOST=n8n.iwaki-i.online
Environment=N8N_PORT=5678
Environment=N8N_PROTOCOL=https
Environment=WEBHOOK_URL=https://n8n.iwaki-i.online/
ExecStart=/usr/bin/n8n start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# systemd にサービスファイルを認識させる
sudo systemctl daemon-reload

# サーバー起動時に自動起動するよう設定
sudo systemctl enable n8n

# n8n を起動
sudo systemctl start n8n

# 起動状態を確認
sudo systemctl status n8n
```

---

## 12. isseiユーザーの作成とSSH設定

```bash
# isseiユーザーを作成
sudo adduser issei

# .ssh ディレクトリを作成
sudo mkdir -p /home/issei/.ssh

# SSH鍵ペアをサーバー上で生成
sudo ssh-keygen -t ed25519 -f /home/issei/.ssh/id_ed25519 -N "" -C "issei@n8n"

# 公開鍵を authorized_keys に登録
sudo cp /home/issei/.ssh/id_ed25519.pub /home/issei/.ssh/authorized_keys

# 所有権とパーミッションを設定
sudo chown -R issei:issei /home/issei/.ssh
sudo chmod 700 /home/issei/.ssh
sudo chmod 600 /home/issei/.ssh/authorized_keys
```

秘密鍵（`/home/issei/.ssh/id_ed25519`）をisseiに安全な方法で渡す。接続手順は [ssh-guide-issei.md](./ssh-guide-issei.md) を参照。

---

## 13. isseiユーザーの sudoers 設定

```bash
# issei用のsudoers設定ファイルを作成
sudo nano /etc/sudoers.d/issei
```

```
issei ALL=(ALL) NOPASSWD: /usr/bin/systemctl start n8n
issei ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop n8n
issei ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart n8n
issei ALL=(ALL) NOPASSWD: /usr/bin/systemctl status n8n
issei ALL=(ALL) NOPASSWD: /usr/bin/apt install *
issei ALL=(ALL) NOPASSWD: /usr/bin/apt update
```

```bash
# パーミッションを設定
sudo chmod 440 /etc/sudoers.d/issei

# 構文チェック
sudo visudo -c
```
