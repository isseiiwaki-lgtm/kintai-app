/**
 * 勤怠アプリ - メインスクリプト
 * 打刻機能、位置情報取得、Googleログイン、ローカルストレージ管理
 */

// ========================================
// 定数・設定
// ========================================
const STORAGE_KEY = 'kintai_records';
const EMPLOYEES_KEY = 'kintai_employees';
const USER_KEY = 'kintai_user';

// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwddm7bng-cpFydXcwiOuOQrnIP5p2sk7TUFkMYAjdFaYLKpN-fFXckjdJIcieqt75O/exec';

// Google OAuth クライアントID（Google Cloud Consoleで取得）
// 本番環境では実際のクライアントIDに置き換えてください
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

// 許可するメールドメイン（Workspaceの場合）
const ALLOWED_DOMAIN = 'iwaki-i.com';

// 社員データ（CSVから読み込む想定）
const EMPLOYEES = [
    { id: '003', name: '鈴木一成', email: 'issei@iwaki-i.com' },
    { id: '004', name: '鈴木亜佐子', email: 'a-suzuki@iwaki-i.com' },
    { id: '108', name: '坂本緩奈', email: 'k-sakamoto@iwaki-i.com' },
    { id: '119', name: '小河原裕美', email: 'y-ogawara@iwaki-i.com' },
    { id: '120', name: '石井章子', email: 's-ishii@iwaki-i.com' },
    { id: '121', name: '根本桜子', email: 'nemoto@iwaki-i.com' },
    { id: '122', name: '須田育美', email: 'suda@iwaki-i.com' },
    { id: '223', name: '山崎公', email: 'yamazaki@iwaki-i.com' },
    { id: '229', name: '国井明日香', email: 'a-kunii@iwaki-i.com' },
    { id: '239', name: '小林匠', email: 't-kobayashi@iwaki-i.com' },
    { id: '240', name: '古田部暁欧', email: 'a-kotabe@iwaki-i.com' },
    { id: '302', name: '半沢昇一', email: 'hanzawa@iwaki-i.com' },
    { id: '334', name: '野木理絵', email: 'nogi@iwaki-i.com' },
    { id: '337', name: '羽山明子', email: 'hayama@iwaki-i.com' },
    { id: '606', name: '布施由美', email: '' },
    { id: '610', name: '岡田友美', email: '' },
    { id: '620', name: '野崎瑤子', email: 'y-nozaki@iwaki-i.com' },
    { id: '622', name: '工藤三帆', email: 'm-kudo@iwaki-i.com' },
    { id: '705', name: '櫻田千恵美', email: 'sakurada@iwaki-i.com' },
    { id: '706', name: '熊谷和樹', email: 'kumagai@iwaki-i.com' },
    { id: '707', name: '櫻井祐輔', email: 'sakurai@iwaki-i.com' }
];

// 打刻タイプの定義
const PUNCH_TYPES = {
    'punch-in': { label: '出勤', icon: '🌅', class: 'punch-in' },
    'punch-out': { label: '退勤', icon: '🌆', class: 'punch-out' },
    'break-start': { label: '中抜け開始', icon: '☕', class: 'break-start' },
    'break-end': { label: '中抜け終了', icon: '💼', class: 'break-end' }
};

// ========================================
// 状態管理
// ========================================
let currentUser = null;
let googleUser = null;

// ========================================
// 初期化
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initPunchButtons();
    initReasonSelect();
    initModal();
    initGoogleAuth();
    initPhoto();
    initRequest();
    loadTodayHistory();

    // 保存されたユーザー情報を復元
    restoreUser();

    // ステータスに基づいてボタンを更新
    updatePunchButtonStates();
});

// ========================================
// Googleログイン機能
// ========================================

/**
 * Googleログインの初期化
 */
function initGoogleAuth() {
    const loginBtn = document.getElementById('login-btn');

    // Google Identity Servicesが読み込まれるまで待機
    if (typeof google === 'undefined') {
        // ライブラリ読み込み待ち（開発用フォールバック）
        loginBtn.addEventListener('click', handleLoginClick);
        return;
    }

    try {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
            auto_select: true,
            cancel_on_tap_outside: false
        });

        loginBtn.addEventListener('click', handleLoginClick);
    } catch (error) {
        console.error('Google Auth初期化エラー:', error);
        loginBtn.addEventListener('click', handleLoginClick);
    }
}

/**
 * ログインボタンクリック処理
 */
function handleLoginClick() {
    if (currentUser) {
        // ログアウト
        handleLogout();
    } else {
        // ログイン
        if (typeof google !== 'undefined' && GOOGLE_CLIENT_ID !== 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
            google.accounts.id.prompt((notification) => {
                if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                    // ポップアップが表示されない場合はデモモード
                    showEmployeeSelect();
                }
            });
        } else {
            // 開発モード：社員選択ダイアログを表示
            showEmployeeSelect();
        }
    }
}

/**
 * Google認証レスポンス処理
 */
function handleGoogleCredentialResponse(response) {
    try {
        // JWTトークンをデコード
        const payload = parseJwt(response.credential);

        googleUser = {
            email: payload.email,
            name: payload.name,
            picture: payload.picture
        };

        // ドメイン制限チェック
        if (ALLOWED_DOMAIN && !payload.email.endsWith('@' + ALLOWED_DOMAIN)) {
            showToast('許可されていないドメインです');
            return;
        }

        // 社員マスタと照合
        const employee = EMPLOYEES.find(emp => emp.email === payload.email);

        if (employee) {
            setCurrentUser({
                id: employee.id,
                name: employee.name,
                email: payload.email,
                picture: payload.picture,
                authType: 'google'
            });
            showToast(`ようこそ、${employee.name}さん！`);
        } else {
            // 社員マスタにない場合
            showToast('社員として登録されていません');
            console.warn('未登録のメールアドレス:', payload.email);
        }
    } catch (error) {
        console.error('認証エラー:', error);
        showToast('ログインに失敗しました');
    }
}

/**
 * JWTトークンをデコード
 */
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

/**
 * 社員選択ダイアログを表示（開発モード用）
 */
function showEmployeeSelect() {
    // 既存のダイアログがあれば削除
    const existing = document.getElementById('employee-select-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'employee-select-overlay';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal" style="max-height: 80vh; overflow-y: auto;">
            <div class="modal-header">
                <h2 class="modal-title">👤 ログイン</h2>
            </div>
            <div class="modal-body" style="text-align: left;">
                <p style="margin-bottom: 16px; color: #6B7280; font-size: 0.9rem;">
                    社員を選択してください
                </p>
                <div class="employee-list" style="max-height: 300px; overflow-y: auto;">
                    ${EMPLOYEES.map(emp => `
                        <div class="employee-item" data-id="${emp.id}" data-name="${emp.name}" data-email="${emp.email}"
                             style="padding: 12px; border-bottom: 1px solid #E5E7EB; cursor: pointer; display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 1.5rem;">👤</span>
                            <div>
                                <div style="font-weight: 500;">${emp.name}</div>
                                <div style="font-size: 0.8rem; color: #6B7280;">${emp.email || '(メールなし)'}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="modal-actions">
                <button class="modal-btn cancel" id="employee-select-cancel">キャンセル</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ホバースタイル
    overlay.querySelectorAll('.employee-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
            item.style.background = '#F3F4F6';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = '';
        });
        item.addEventListener('click', () => {
            const user = {
                id: item.dataset.id,
                name: item.dataset.name,
                email: item.dataset.email,
                authType: 'manual'
            };
            setCurrentUser(user);
            overlay.remove();
            showToast(`ようこそ、${user.name}さん！`);
        });
    });

    // キャンセルボタン
    document.getElementById('employee-select-cancel').addEventListener('click', () => {
        overlay.remove();
    });

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

/**
 * 現在のユーザーを設定
 */
function setCurrentUser(user) {
    currentUser = user;

    // UIを更新
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-email').textContent = user.email || '(メールなし)';
    document.getElementById('login-btn').textContent = 'ログアウト';
    document.getElementById('login-btn').classList.add('logged-in');

    // プロフィール画像
    const avatarEl = document.getElementById('user-avatar');
    if (user.picture) {
        avatarEl.innerHTML = `<img src="${user.picture}" alt="" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    } else {
        avatarEl.textContent = '👤';
    }

    // ローカルストレージに保存
    localStorage.setItem(USER_KEY, JSON.stringify(user));

    // 履歴を再読み込み（ユーザーの打刻のみ表示する場合）
    loadTodayHistory();
}

/**
 * 保存されたユーザー情報を復元
 */
function restoreUser() {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) {
        try {
            const user = JSON.parse(saved);
            setCurrentUser(user);
        } catch (e) {
            localStorage.removeItem(USER_KEY);
        }
    }
}

/**
 * ログアウト処理
 */
function handleLogout() {
    currentUser = null;
    googleUser = null;

    // UI更新
    document.getElementById('user-name').textContent = 'ゲスト';
    document.getElementById('user-email').textContent = 'ログインしてください';
    document.getElementById('login-btn').textContent = 'ログイン';
    document.getElementById('login-btn').classList.remove('logged-in');
    document.getElementById('user-avatar').textContent = '👤';

    // ローカルストレージから削除
    localStorage.removeItem(USER_KEY);

    // Googleログアウト
    if (typeof google !== 'undefined') {
        google.accounts.id.disableAutoSelect();
    }

    showToast('ログアウトしました');
}

// ========================================
// 時計機能
// ========================================
function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('current-time').textContent = timeStr;
}

// ========================================
// 打刻ステータス管理（重複打刻防止）
// ========================================

/**
 * 現在のユーザーの打刻ステータスを取得
 * @returns {string} 'not-punched' | 'working' | 'on-break'
 */
async function getEmployeeStatus() {
    if (!currentUser) {
        console.log('📊 ステータス取得: ユーザー未ログイン');
        return 'not-punched';
    }

    const records = await getRecords();

    // 今日の日付（JST）
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = jstNow.toISOString().split('T')[0];

    console.log('📊 今日の日付(JST):', today);
    console.log('📊 全レコード数:', records.length);
    console.log('📊 ログインユーザーID:', currentUser.id);

    // 今日の自分の打刻を取得
    const myTodayRecords = records.filter(r => {
        // レコードの日付をJSTで取得
        const recordDate = r.date || (() => {
            const d = new Date(r.timestamp);
            const jstD = new Date(d.getTime() + 9 * 60 * 60 * 1000);
            return jstD.toISOString().split('T')[0];
        })();

        // 社員番号を数値で比較（先頭ゼロを無視）
        const recordUserId = parseInt(r.user?.id, 10);
        const currentUserId = parseInt(currentUser.id, 10);
        const userIdMatch = recordUserId === currentUserId;
        const dateMatch = recordDate === today;

        if (userIdMatch) {
            console.log('  📋 レコード:', r.time, r.typeLabel || r.type, '日付:', recordDate, '一致:', dateMatch);
        }

        return dateMatch && userIdMatch;
    });

    console.log('📊 今日の自分の打刻数:', myTodayRecords.length);
    myTodayRecords.forEach(r => {
        console.log('  - ', r.time, r.typeLabel || r.type);
    });

    if (myTodayRecords.length === 0) {
        return 'not-punched'; // 未出勤
    }

    // 最新の打刻を取得
    const lastRecord = myTodayRecords[myTodayRecords.length - 1];
    const lastType = lastRecord.type || lastRecord.typeLabel;

    console.log('📊 最新打刻:', lastType);

    if (lastType === 'punch-out' || lastType === '退勤') {
        return 'not-punched'; // 退勤済み（再出勤可能）
    } else if (lastType === 'break-start' || lastType === '中抜け開始') {
        return 'on-break'; // 中抜け中
    } else if (lastType === 'punch-in' || lastType === '出勤' || lastType === 'break-end' || lastType === '中抜け終了') {
        return 'working'; // 出勤中
    }

    return 'not-punched';
}

/**
 * ステータスに基づいてボタンの有効/無効を更新
 */
async function updatePunchButtonStates() {
    const status = await getEmployeeStatus();

    const punchInBtn = document.getElementById('btn-punch-in');
    const punchOutBtn = document.getElementById('btn-punch-out');
    const breakStartBtn = document.getElementById('btn-break-start');
    const breakEndBtn = document.getElementById('btn-break-end');

    // 全ボタンを一旦無効化
    [punchInBtn, punchOutBtn, breakStartBtn, breakEndBtn].forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('disabled');
        }
    });

    // ステータスに応じて有効化
    if (status === 'not-punched') {
        // 未出勤: 出勤のみ可能
        if (punchInBtn) {
            punchInBtn.disabled = false;
            punchInBtn.classList.remove('disabled');
        }
    } else if (status === 'working') {
        // 出勤中: 退勤・中抜け開始が可能
        if (punchOutBtn) {
            punchOutBtn.disabled = false;
            punchOutBtn.classList.remove('disabled');
        }
        if (breakStartBtn) {
            breakStartBtn.disabled = false;
            breakStartBtn.classList.remove('disabled');
        }
    } else if (status === 'on-break') {
        // 中抜け中: 中抜け終了のみ可能
        if (breakEndBtn) {
            breakEndBtn.disabled = false;
            breakEndBtn.classList.remove('disabled');
        }
    }

    console.log('📊 ステータス更新:', status);
}

// ========================================
// 打刻ボタン機能
// ========================================
function initPunchButtons() {
    document.querySelectorAll('.punch-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            // ログインチェック
            if (!currentUser) {
                showToast('ログインしてください');
                return;
            }

            // ボタンが無効化されている場合は処理しない
            if (btn.disabled) {
                showToast('この操作は現在できません');
                return;
            }

            const type = btn.id.replace('btn-', '');
            showPunchModal(type);
        });
    });
}

// ========================================
// 理由選択機能
// ========================================
function initReasonSelect() {
    const select = document.getElementById('reason-select');
    const noteContainer = document.getElementById('note-container');

    select.addEventListener('change', () => {
        noteContainer.style.display = select.value === 'その他' ? 'block' : 'none';
    });
}

// ========================================
// モーダル機能
// ========================================
let pendingPunchType = null;

function initModal() {
    document.getElementById('modal-cancel').addEventListener('click', hideModal);
    document.getElementById('modal-confirm').addEventListener('click', confirmPunch);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideModal();
    });
}

function showPunchModal(type) {
    try {
        pendingPunchType = type;
        const typeInfo = PUNCH_TYPES[type];
        if (!typeInfo) throw new Error('不明な打刻タイプ: ' + type);

        const now = new Date();
        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        document.getElementById('modal-title').textContent = typeInfo.label;
        document.getElementById('modal-time').textContent = timeStr;

        // 詳細情報の表示
        const reason = document.getElementById('reason-select').value;
        const note = document.getElementById('note-input').value;
        let details = [];

        details.push(`社員: ${currentUser.name}`);
        if (reason) details.push(`理由: ${reason}`);
        if (note) details.push(`備考: ${note}`);

        document.getElementById('modal-details').innerHTML = details.join('<br>');
        document.getElementById('modal-overlay').classList.add('active');
    } catch (e) {
        console.error(e);
        showToast('エラー: ' + e.message);
    }
}

function hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    pendingPunchType = null;
}

async function confirmPunch() {
    if (!pendingPunchType) return;
    if (!currentUser) {
        showToast('ログインしてください');
        hideModal();
        return;
    }

    const now = new Date();
    const typeInfo = PUNCH_TYPES[pendingPunchType];
    const reason = document.getElementById('reason-select').value;
    const note = document.getElementById('note-input').value;

    const record = {
        id: generateId(),
        timestamp: now.toISOString(),
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        type: pendingPunchType,
        typeLabel: typeInfo.label,
        reason: reason || null,
        note: note || null,
        photo: currentPhoto || null,
        user: currentUser,
        location: null,
        locationStatus: ''
    };

    // 保存（非同期処理を待つ）
    await saveRecord(record);

    // UIリセット
    document.getElementById('reason-select').value = '';
    document.getElementById('note-input').value = '';
    document.getElementById('note-container').style.display = 'none';

    // 写真リセット
    currentPhoto = null;
    const photoPreview = document.getElementById('photo-preview');
    if (photoPreview) {
        photoPreview.innerHTML = '<span class="photo-placeholder">タップして撮影</span>';
    }
    const clearPhotoBtn = document.getElementById('clear-photo');
    if (clearPhotoBtn) {
        clearPhotoBtn.style.display = 'none';
    }
    const photoInput = document.getElementById('photo-input');
    if (photoInput) {
        photoInput.value = '';
    }

    // モーダル閉じる
    hideModal();

    // トースト表示
    showToast(`${typeInfo.label}を打刻しました`);

    // 履歴更新
    loadTodayHistory();

    // ボタン状態を更新（重複打刻防止）
    updatePunchButtonStates();
}

// ========================================
// データ保存機能
// ========================================
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function saveRecord(record) {
    // LocalStorageにも保存（オフライン対応）
    const records = await getRecords();
    records.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    console.log('✅ LocalStorageに保存:', record);

    // Google Apps Scriptに送信（オンライン）
    if (GAS_URL) {
        try {
            // ----------------------------------------
            // 確実な送信のためのForm送信（iFrameターゲット）
            // ----------------------------------------

            // 送信用の隠しiFrameを作成（なければ）
            const iframeId = 'gas-hidden-frame';
            let iframe = document.getElementById(iframeId);
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = iframeId;
                iframe.name = iframeId;
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
            }

            // 送信用のFormを作成
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = GAS_URL;
            form.target = iframeId; // レスポンスで画面遷移しないようにiFrameに向ける
            form.style.display = 'none';

            // データをInputタグとして追加
            const data = {
                action: 'punch',
                employeeId: record.user.id,
                employeeName: record.user.name,
                punchType: record.typeLabel,
                reason: record.reason || '',
                latitude: record.location?.latitude || '',
                longitude: record.location?.longitude || '',
                locationStatus: record.locationStatus || '',
                isTemporary: 'false',
                email: record.user.email || ''
            };

            for (const key in data) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = data[key];
                form.appendChild(input);
            }

            document.body.appendChild(form);

            // 送信実行
            form.submit();
            console.log('☁️ Googleスプレッドシートへ送信実行（Form送信）');

            // フォームは用済みなので少し待ってから削除
            setTimeout(() => {
                document.body.removeChild(form);
            }, 1000);

        } catch (error) {
            console.error('⚠️ GAS保存エラー:', error);
            console.log('💾 LocalStorageのみに保存しました');
        }
    } else {
        console.log('ℹ️ GAS_URLが未設定のため、LocalStorageのみに保存');
    }
}

async function getRecords() {
    // 1. LocalStorageから取得（常に取得しておく）
    console.log('💾 LocalStorageから取得');
    const localData = localStorage.getItem(STORAGE_KEY);
    const localRecords = localData ? JSON.parse(localData) : [];

    // GAS_URLがない場合はローカルのみ返す
    if (!GAS_URL) {
        return localRecords;
    }

    // 2. GASから取得
    let gasRecords = [];
    try {
        const response = await fetch(`${GAS_URL}?action=getTodayRecords`);
        const data = await response.json();
        if (data.records && data.records.length > 0) {
            console.log('☁️ Googleスプレッドシートから取得:', data.records.length, '件');
            // GASのデータ形式をローカル形式に変換
            gasRecords = data.records.map(r => ({
                id: r.timestamp, // GASデータはタイムスタンプをIDとする
                timestamp: r.timestamp,
                date: new Date(r.timestamp).toISOString().split('T')[0],
                time: new Date(r.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                type: convertPunchType(r.punchType),
                typeLabel: r.punchType,
                reason: r.reason || null,
                note: null,
                photo: null,
                user: {
                    id: r.employeeId,
                    name: r.employeeName,
                    email: r.email
                },
                location: r.latitude ? {
                    latitude: r.latitude,
                    longitude: r.longitude
                } : null,
                locationStatus: r.locationStatus
            }));
        }
    } catch (error) {
        console.error('⚠️ GAS取得エラー:', error);
        // エラー時はローカルデータを返す
        return localRecords;
    }

    // 3. マージと重複排除
    // GASのデータを正とするが、GASに無い（反映待ちの）ローカルデータを追加する
    const mergedRecords = [...gasRecords];

    localRecords.forEach(localRecord => {
        // 今日のデータのみ対象
        const today = new Date().toISOString().split('T')[0];
        if (localRecord.date !== today) return;

        // 重複チェック: 同じユーザー、同じタイプ、時刻が近い(±2分)データがGASにあれば、それは反映済みとみなす
        const isSynced = gasRecords.some(gasRecord => {
            if (gasRecord.user.id !== localRecord.user.id) return false;
            // タイプ比較（localRecord.type は 'punch-in' 等。gasRecord.type も変換済みなので 'punch-in' 等）
            if (gasRecord.type !== localRecord.type) return false;

            const gasTime = new Date(gasRecord.timestamp).getTime();
            const localTime = new Date(localRecord.timestamp).getTime();

            // サーバー時刻とクライアント時刻のズレを考慮し、2分以内の誤差なら同一とみなす
            return Math.abs(gasTime - localTime) < 120 * 1000;
        });

        if (!isSynced) {
            console.log('➕ 未反映のローカルデータを表示に追加:', localRecord.time, localRecord.typeLabel);
            mergedRecords.push(localRecord);
        }
    });

    // 時間順にソートして返す
    return mergedRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// 打刻タイプを変換（GAS → ローカル形式）
function convertPunchType(typeLabel) {
    const typeMap = {
        '出勤': 'punch-in',
        '退勤': 'punch-out',
        '中抜け開始': 'break-start',
        '中抜け終了': 'break-end'
    };
    return typeMap[typeLabel] || 'punch-in';
}

async function getTodayRecords() {
    const today = new Date().toISOString().split('T')[0];
    const records = await getRecords();
    return records.filter(r => r.date === today);
}

// ========================================
// 履歴表示機能
// ========================================
async function loadTodayHistory() {
    const records = await getTodayRecords();
    const listEl = document.getElementById('history-list');

    // ログイン中のユーザーの打刻のみ表示
    let filteredRecords = records;
    if (currentUser) {
        console.log('👤 ユーザーフィルタ:', currentUser.id);
        filteredRecords = records.filter(r => r.user?.id === currentUser.id);
    }

    console.log('📜 表示件数:', filteredRecords.length);

    if (filteredRecords.length === 0) {
        listEl.innerHTML = '<p class="no-history">まだ打刻がありません</p>';
        return;
    }

    // 時間順にソート
    filteredRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    listEl.innerHTML = filteredRecords.map(record => {
        const typeInfo = PUNCH_TYPES[record.type];
        let reasonText = '';
        if (record.reason) {
            reasonText = `<span class="history-reason">(${record.reason})</span>`;
        }

        return `
            <div class="history-item">
                <span class="history-time">${record.time}</span>
                <span class="history-type">${record.typeLabel} ${reasonText}</span>
                <span class="history-tag ${typeInfo.class}">${typeInfo.icon}</span>
            </div>
        `;
    }).join('');
}

// ========================================
// トースト通知
// ========================================
function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').textContent = message;
    toast.classList.add('active');

    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

// ========================================
// ユーティリティ
// ========================================
function formatDate(date) {
    return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// ========================================
// 写真撮影機能
// ========================================
let currentPhoto = null;

function initPhoto() {
    const photoInput = document.getElementById('photo-input');
    const photoPreview = document.getElementById('photo-preview');
    const takePhotoBtn = document.getElementById('take-photo');
    const clearPhotoBtn = document.getElementById('clear-photo');

    if (!photoInput || !photoPreview) return;

    // プレビューエリアクリックでカメラ起動
    photoPreview.addEventListener('click', () => {
        photoInput.click();
    });

    // 撮影ボタン
    takePhotoBtn.addEventListener('click', () => {
        photoInput.click();
    });

    // ファイル選択時
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                currentPhoto = event.target.result;
                photoPreview.innerHTML = `<img src="${currentPhoto}" alt="撮影写真">`;
                clearPhotoBtn.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });

    // 削除ボタン
    clearPhotoBtn.addEventListener('click', () => {
        currentPhoto = null;
        photoPreview.innerHTML = '<span class="photo-placeholder">タップして撮影</span>';
        clearPhotoBtn.style.display = 'none';
        photoInput.value = '';
    });
}

// ========================================
// 申請機能
// ========================================
const REQUEST_STORAGE_KEY = 'kintai_requests';
let currentRequestType = null;

const REQUEST_TYPES = {
    'absence': { label: '欠勤申請', icon: '🏠', showEndDate: true },
    'paid-leave': { label: '有給休暇申請', icon: '🏖️', showEndDate: true },
    'half-day': { label: '半休申請', icon: '🌓', showHalfDay: true },
    'overtime': { label: '残業申請', icon: '🌙', showTime: true, showEndTime: true },
    'holiday-work': { label: '休日出勤申請', icon: '📅', showTime: true, showEndTime: true },
    'compensatory': { label: '代休申請', icon: '🔄', showEndDate: true },
    'special-leave': { label: '特別休暇申請', icon: '🎊', showEndDate: true, showLeaveType: true },
    'late-early': { label: '遅刻・早退申請', icon: '⏰', showTime: true },
    'direct': { label: '直行直帰申請', icon: '🚗', showTime: true }
};

function initRequest() {
    // 申請ボタン
    document.querySelectorAll('.request-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!currentUser) {
                showToast('ログインしてください');
                return;
            }
            const type = btn.dataset.type;
            showRequestModal(type);
        });
    });

    // キャンセルボタン
    document.getElementById('request-cancel')?.addEventListener('click', hideRequestModal);

    // 申請ボタン
    document.getElementById('request-submit')?.addEventListener('click', submitRequest);

    // オーバーレイクリックで閉じる
    document.getElementById('request-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideRequestModal();
    });
}

function showRequestModal(type) {
    currentRequestType = type;
    const typeInfo = REQUEST_TYPES[type];

    if (!typeInfo) return;

    // タイトル設定
    document.getElementById('request-modal-title').textContent = typeInfo.label;

    // 日付を今日に設定
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('request-date').value = today;
    document.getElementById('request-end-date').value = today;
    document.getElementById('request-reason').value = '';
    document.getElementById('request-time').value = '';
    document.getElementById('request-end-time').value = '';

    // 終了日フィールドの表示制御
    const endDateGroup = document.getElementById('request-end-date-group');
    endDateGroup.style.display = typeInfo.showEndDate ? 'block' : 'none';

    // 半休区分フィールドの表示制御
    const halfDayGroup = document.getElementById('request-half-day-group');
    halfDayGroup.style.display = typeInfo.showHalfDay ? 'block' : 'none';

    // 時刻フィールドの表示制御
    const timeGroup = document.getElementById('request-time-group');
    timeGroup.style.display = typeInfo.showTime ? 'block' : 'none';

    // 終了時刻フィールドの表示制御
    const endTimeGroup = document.getElementById('request-end-time-group');
    endTimeGroup.style.display = typeInfo.showEndTime ? 'block' : 'none';

    // 休暇種別フィールドの表示制御
    const leaveTypeGroup = document.getElementById('request-leave-type-group');
    leaveTypeGroup.style.display = typeInfo.showLeaveType ? 'block' : 'none';

    // モーダル表示
    document.getElementById('request-modal-overlay').classList.add('active');
}

function hideRequestModal() {
    document.getElementById('request-modal-overlay').classList.remove('active');
    currentRequestType = null;
}

function submitRequest() {
    if (!currentRequestType || !currentUser) {
        showToast('エラーが発生しました');
        return;
    }

    const typeInfo = REQUEST_TYPES[currentRequestType];
    const date = document.getElementById('request-date').value;
    const endDate = document.getElementById('request-end-date').value;
    const time = document.getElementById('request-time').value;
    const endTime = document.getElementById('request-end-time').value;
    const halfDayType = document.getElementById('request-half-day-type').value;
    const leaveType = document.getElementById('request-leave-type').value;
    const reason = document.getElementById('request-reason').value;

    if (!date) {
        showToast('日付を選択してください');
        return;
    }

    if (!reason.trim()) {
        showToast('理由を入力してください');
        return;
    }

    const request = {
        id: generateId(),
        type: currentRequestType,
        typeLabel: typeInfo.label,
        date: date,
        endDate: typeInfo.showEndDate ? endDate : null,
        time: typeInfo.showTime ? time : null,
        endTime: typeInfo.showEndTime ? endTime : null,
        halfDayType: typeInfo.showHalfDay ? halfDayType : null,
        leaveType: typeInfo.showLeaveType ? leaveType : null,
        reason: reason,
        user: currentUser,
        status: '申請中',
        createdAt: new Date().toISOString()
    };

    // 保存
    saveRequest(request);

    // モーダル閉じる
    hideRequestModal();

    // 完了通知
    showToast(`${typeInfo.label}を提出しました`);
}

async function saveRequest(request) {
    // LocalStorageにも保存
    const requests = getRequests();
    requests.push(request);
    localStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify(requests));
    console.log('✅ LocalStorageに申請保存:', request);

    // GASに送信
    if (GAS_URL) {
        try {
            // 送信用の隠しiFrame
            const iframeId = 'gas-hidden-frame-request';
            let iframe = document.getElementById(iframeId);
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = iframeId;
                iframe.name = iframeId;
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
            }

            // 送信用のForm
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = GAS_URL;
            form.target = iframeId;
            form.style.display = 'none';

            // データ構築
            const data = {
                action: 'request',
                employeeId: request.user.id,
                employeeName: request.user.name,
                typeLabel: request.typeLabel,
                date: request.date,
                endDate: request.endDate || '',
                time: request.time || '',
                endTime: request.endTime || '',
                halfDayType: request.halfDayType || '',
                leaveType: request.leaveType || '',
                reason: request.reason,
                status: request.status,
                email: request.user.email || ''
            };

            for (const key in data) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = data[key];
                form.appendChild(input);
            }

            document.body.appendChild(form);
            form.submit();
            console.log('☁️ 申請データを送信実行');

            setTimeout(() => {
                document.body.removeChild(form);
            }, 1000);

        } catch (error) {
            console.error('⚠️ GAS送信エラー:', error);
        }
    }
}

function getRequests() {
    const data = localStorage.getItem(REQUEST_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
}

