/**
 * 管理者ダッシュボード - スクリプト
 * 出勤一覧、アラート、TKC CSV出力
 */

// ========================================
// 定数・設定
// ========================================
const STORAGE_KEY = 'kintai_records';
const DELETED_KEY = 'kintai_deleted_ids'; // 削除済みレコードのキー(タイムスタンプ+名前+種別)を保管

/**
 * 削除済みリストに追加
 */
function addToDeletedList(timestamp, userName, typeLabel) {
    const raw = localStorage.getItem(DELETED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push({ timestamp, userName, typeLabel, deletedAt: Date.now() });
    localStorage.setItem(DELETED_KEY, JSON.stringify(list));
}

/**
 * レコードが削除済みかチェック
 */
function isDeleted(record) {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw);
    const rTs = new Date(record.timestamp).getTime();
    const rName = record.user?.name || record.employeeName || '';
    const rType = record.typeLabel || record.punchType || '';
    return list.some(d => {
        const dTs = new Date(d.timestamp).getTime();
        return Math.abs(dTs - rTs) < 120000 && d.userName === rName && d.typeLabel === rType;
    });
}

// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwddm7bng-cpFydXcwiOuOQrnIP5p2sk7TUFkMYAjdFaYLKpN-fFXckjdJIcieqt75O/exec';

// 社員データ（GASから取得）
let EMPLOYEES = [];
const EMPLOYEES_KEY = 'kintai_employees';

/**
 * 社員データを取得
 */
async function fetchEmployees() {
    // 1. LocalStorageからキャッシュを取得
    const stored = localStorage.getItem(EMPLOYEES_KEY);
    if (stored) {
        try {
            EMPLOYEES = JSON.parse(stored);
        } catch (e) {
            console.error(e);
        }
    }

    if (!GAS_URL) {
        return;
    }

    // 2. GASから最新データを取得
    try {
        const response = await fetch(`${GAS_URL}?action=getEmployees`);
        const data = await response.json();

        if (data.employees && data.employees.length > 0) {
            EMPLOYEES = data.employees;
            localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(EMPLOYEES));
            // 所定労働時間設定の更新などが必要ならここで行う
        }
    } catch (error) {
        console.error('社員データ取得エラー:', error);
    }
}

// 打刻タイプのアイコン
const TYPE_ICONS = {
    'punch-in': '🌅',
    'punch-out': '🌆',
    'break-start': '☕',
    'break-end': '💼'
};

// ========================================
// 社員別 所定労働時間設定（分単位）
// ========================================
// 社員マスタの雇用区分に基づいて自動計算します
// 正社員: 8時間 (480分)
// パート: 5時間 (300分)

// デフォルト所定労働時間（リストにない人）
const DEFAULT_SCHEDULED_WORK_MINUTES = 480; // 8時間

// ========================================
// 初期化
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    initDate();
    await fetchEmployees();
    loadData();
    initFilters();
    initExport();
});

/**
 * 日付の初期化
 */
function initDate() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    document.getElementById('current-date').textContent = dateStr;
}

/**
 * データの読み込みと表示
 */
async function loadData() {
    const todayRecords = await getTodayRecords();
    const attendanceData = calculateAttendance(todayRecords);

    updateSummary(attendanceData);
    updateAlerts(attendanceData);
    updateAttendanceList(attendanceData, 'all');
    updateAttendanceList(attendanceData, 'all');
    updateLogList(todayRecords);
    loadRequests();
}

/**
 * 申請データの読み込み
 */
async function loadRequests() {
    const listEl = document.getElementById('request-list');

    if (!GAS_URL) {
        // GASがない場合はLocalStorageから取得（デバッグ用）
        const localData = localStorage.getItem('kintai_requests');
        if (localData) {
            updateRequestList(JSON.parse(localData));
        } else {
            listEl.innerHTML = '<p class="no-data">申請データがありません</p>';
        }
        return;
    }

    try {
        const response = await fetch(`${GAS_URL}?action=getRequests`);
        const data = await response.json();

        if (data.requests && data.requests.length > 0) {
            updateRequestList(data.requests);
        } else {
            listEl.innerHTML = '<p class="no-data">申請データがありません</p>';
        }
    } catch (error) {
        console.error('申請データ取得エラー:', error);
        listEl.innerHTML = '<p class="no-data error">データの取得に失敗しました</p>';
    }
}

/**
 * 申請一覧を更新
 */
function updateRequestList(requests) {
    const listEl = document.getElementById('request-list');

    if (requests.length === 0) {
        listEl.innerHTML = '<p class="no-data">申請データがありません</p>';
        return;
    }

    // 新しい順にソート
    requests.sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));

    listEl.innerHTML = requests.map(req => {
        let details = [];
        if (req.date) details.push(`対象日: ${req.date}`);
        if (req.time) details.push(`時間: ${req.time}〜${req.endTime || ''}`);
        if (req.reason) details.push(`理由: ${req.reason}`);

        // 承認・却下済み以外の場合にボタンを表示（より堅牢な判定）
        const isProcessed = req.status === '承認' || req.status === '却下';
        console.log('申請ステータス:', req.status, '| 処理済み:', isProcessed, '| ボタン表示:', !isProcessed);
        const actionsHtml = !isProcessed ? `
            <div class="request-actions">
                <button class="approve-btn" data-timestamp="${req.timestamp}" onclick="handleApprove(this)">✓ 承認</button>
                <button class="reject-btn" data-timestamp="${req.timestamp}" onclick="handleReject(this)">✗ 却下</button>
            </div>
        ` : '';

        return `
            <div class="request-item" data-timestamp="${req.timestamp}">
                <div class="request-header">
                    <span class="request-type">${req.typeLabel}</span>
                    <span class="request-status ${req.status === '承認' ? 'approved' : req.status === '却下' ? 'rejected' : 'pending'}">${req.status}</span>
                </div>
                <div class="request-user">
                    <span class="user-icon">👤</span>
                    <span class="user-name">${req.employeeName || req.user?.name || '不明'}</span>
                </div>
                <div class="request-details">
                    ${details.join('<br>')}
                </div>
                <div class="request-footer">
                    <span class="request-date">申請日: ${new Date(req.timestamp || req.createdAt).toLocaleString('ja-JP')}</span>
                </div>
                ${actionsHtml}
            </div>
        `;
    }).join('');
}

/**
 * 承認ボタンのハンドラ
 */
async function handleApprove(button) {
    const timestamp = button.dataset.timestamp;
    await updateRequestStatus(timestamp, '承認');
}

/**
 * 却下ボタンのハンドラ
 */
async function handleReject(button) {
    const timestamp = button.dataset.timestamp;
    if (confirm('この申請を却下しますか？')) {
        await updateRequestStatus(timestamp, '却下');
    }
}

/**
 * 申請ステータスを更新
 */
async function updateRequestStatus(requestTimestamp, status) {
    if (!GAS_URL) {
        alert('GAS URLが設定されていません');
        return;
    }

    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'updateRequestStatus',
                requestTimestamp: requestTimestamp,
                status: status
            })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            // 一覧を再読み込み
            loadRequests();
        } else {
            alert('エラー: ' + (result.error || '不明なエラー'));
        }
    } catch (error) {
        console.error('申請ステータス更新エラー:', error);
        alert('通信エラーが発生しました');
    }
}

/**
 * 今日の打刻記録を取得
 */
async function getTodayRecords() {
    // GASから取得を試みる
    if (GAS_URL) {
        try {
            const response = await fetch(`${GAS_URL}?action=getTodayRecords`);
            const data = await response.json();
            console.log('🔍 LocalStorageから取得:', JSON.stringify(data).substring(0, 100) + '...');
            console.log('🔑 ストレージキー:', STORAGE_KEY);

            if (data.records && data.records.length > 0) {
                console.log('☁️ Googleスプレッドシートから取得');
                console.log('📦 全データ件数:', data.records.length);
                const today = new Date().toISOString().split('T')[0];
                console.log('📅 今日のデータ件数:', data.records.length);
                console.log('📅 今日の日付:', today);

                // GASのデータ形式をローカル形式に変換し、削除済みをフィルタリング
                return data.records
                    .filter(r => !isDeleted({ timestamp: r.timestamp, user: { name: r.employeeName }, typeLabel: r.punchType }))
                    .map(r => ({
                        id: r.timestamp,
                        timestamp: r.timestamp,
                        date: new Date(r.timestamp).toISOString().split('T')[0],
                        time: new Date(r.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                        type: convertPunchType(r.punchType),
                        typeLabel: r.punchType,
                        reason: r.reason || null,
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
        }
    }

    // フォールバック: LocalStorageから取得
    const data = localStorage.getItem(STORAGE_KEY);
    console.log('🔍 LocalStorageから取得:', data);
    console.log('🔑 ストレージキー:', STORAGE_KEY);
    if (!data) {
        console.log('❌ データが見つかりません');
        return [];
    }

    const today = new Date().toISOString().split('T')[0];
    const records = JSON.parse(data);
    console.log('📦 全データ件数:', records.length);
    const todayRecords = records.filter(r => r.date === today);
    console.log('📅 今日のデータ件数:', todayRecords.length);
    console.log('📅 今日の日付:', today);
    return todayRecords;
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

/**
 * 出勤状況を計算
 */
function calculateAttendance(records) {
    const attendance = {};

    // 社員ごとに初期化
    EMPLOYEES.forEach(emp => {
        attendance[emp.id] = {
            employee: emp,
            status: 'absent', // absent, present, break, left
            punchIn: null,
            punchOut: null,
            breakStart: null,
            breakEnd: null,
            records: []
        };
    });

    console.log('📊 calculateAttendance - レコード数:', records.length);

    // 打刻記録を処理
    records.forEach(record => {
        let empId = record.user?.id;
        console.log('🔍 レコード処理:', empId, record.type, record.typeLabel);

        if (!empId) {
            console.log('⚠️ 社員IDがありません');
            return;
        }

        // 社員IDを文字列に変換（数値の場合に対応）
        empId = String(empId);

        // 社員IDの照合（先頭ゼロの有無を考慮）
        let matchedId = empId;
        if (!attendance[empId]) {
            // 先頭ゼロを除去して再検索
            const numericId = String(parseInt(empId, 10));
            const paddedId = empId.padStart(3, '0');

            if (attendance[numericId]) {
                matchedId = numericId;
            } else if (attendance[paddedId]) {
                matchedId = paddedId;
            } else {
                // 名前でフォールバック検索
                const emp = EMPLOYEES.find(e => e.name === record.user?.name);
                if (emp) {
                    matchedId = emp.id;
                    console.log('📛 名前でマッチ:', record.user?.name, '→', emp.id);
                } else {
                    console.log('⚠️ 社員が見つかりません:', empId, record.user?.name);
                    return;
                }
            }
        }

        attendance[matchedId].records.push(record);

        // record.type が未設定の場合、typeLabel から変換
        let punchType = record.type;
        if (!punchType || punchType === 'undefined') {
            punchType = convertPunchType(record.typeLabel);
            console.log('🔄 タイプ変換:', record.typeLabel, '→', punchType);
        }

        switch (punchType) {
            case 'punch-in':
                attendance[matchedId].punchIn = record.time;
                attendance[matchedId].status = 'present';
                console.log('✅ 出勤:', matchedId, record.time);
                break;
            case 'punch-out':
                attendance[matchedId].punchOut = record.time;
                attendance[matchedId].status = 'left';
                break;
            case 'break-start':
                attendance[matchedId].breakStart = record.time;
                if (attendance[matchedId].status === 'present') {
                    attendance[matchedId].status = 'break';
                }
                break;
            case 'break-end':
                attendance[matchedId].breakEnd = record.time;
                if (attendance[matchedId].status === 'break') {
                    attendance[matchedId].status = 'present';
                }
                break;
        }
    });

    return attendance;
}

/**
 * サマリーを更新
 */
function updateSummary(attendanceData) {
    const counts = { present: 0, absent: 0, break: 0, left: 0 };

    Object.values(attendanceData).forEach(data => {
        counts[data.status]++;
    });

    document.getElementById('total-employees').textContent = EMPLOYEES.length;
    document.getElementById('present-count').textContent = counts.present;
    document.getElementById('absent-count').textContent = counts.absent;
    document.getElementById('break-count').textContent = counts.break;
}

/**
 * アラートを更新
 */
function updateAlerts(attendanceData) {
    const alerts = [];
    const now = new Date();
    const currentHour = now.getHours();

    // 9時以降で未出勤の社員
    if (currentHour >= 9) {
        const absentEmployees = Object.values(attendanceData)
            .filter(d => d.status === 'absent')
            .map(d => d.employee.name);

        if (absentEmployees.length > 0) {
            alerts.push({
                type: 'danger',
                icon: '🚨',
                title: '未出勤',
                description: `${absentEmployees.slice(0, 3).join('、')}${absentEmployees.length > 3 ? ` 他${absentEmployees.length - 3}名` : ''}`
            });
        }
    }

    // 長時間中抜け（1時間以上）
    Object.values(attendanceData).forEach(data => {
        if (data.status === 'break' && data.breakStart) {
            const breakTime = parseTime(data.breakStart);
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (nowMinutes - breakTime > 60) {
                alerts.push({
                    type: 'warning',
                    icon: '⚠️',
                    title: '長時間中抜け',
                    description: `${data.employee.name}：${data.breakStart}から中抜け中`
                });
            }
        }
    });

    // アラート表示
    const alertSection = document.getElementById('alert-section');
    const alertList = document.getElementById('alert-list');

    if (alerts.length > 0) {
        alertSection.style.display = 'block';
        alertList.innerHTML = alerts.map(alert => `
            <div class="alert-item ${alert.type === 'warning' ? 'warning' : ''}">
                <span class="alert-icon">${alert.icon}</span>
                <div class="alert-content">
                    <div class="alert-title">${alert.title}</div>
                    <div class="alert-description">${alert.description}</div>
                </div>
            </div>
        `).join('');
    } else {
        alertSection.style.display = 'none';
    }
}

/**
 * 時刻文字列を分に変換
 */
function parseTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

/**
 * 出勤一覧を更新
 */
function updateAttendanceList(attendanceData, filter) {
    const list = document.getElementById('attendance-list');

    let filteredData = Object.values(attendanceData);

    if (filter !== 'all') {
        filteredData = filteredData.filter(d => d.status === filter);
    }

    if (filteredData.length === 0) {
        list.innerHTML = '<p class="no-data">該当する社員がいません</p>';
        return;
    }

    const statusLabels = {
        'present': '出勤中',
        'absent': '未出勤',
        'break': '中抜け中',
        'left': '退勤済'
    };

    const avatars = ['👤', '👩', '👨', '🧑', '👩‍💼', '👨‍💼'];

    list.innerHTML = filteredData.map((data, index) => {
        const detail = data.punchIn
            ? `出勤 ${data.punchIn}${data.punchOut ? ` → 退勤 ${data.punchOut}` : ''}`
            : '—';

        return `
            <div class="attendance-item" data-status="${data.status}">
                <div class="attendance-avatar">${avatars[index % avatars.length]}</div>
                <div class="attendance-info">
                    <div class="attendance-name">${data.employee.name}</div>
                    <div class="attendance-detail">${detail}</div>
                </div>
                <span class="attendance-status ${data.status}">${statusLabels[data.status]}</span>
            </div>
        `;
    }).join('');
}

/**
 * 打刻ログを更新
 */
function updateLogList(records) {
    const list = document.getElementById('log-list');

    if (records.length === 0) {
        list.innerHTML = '<p class="no-data">今日の打刻データがありません</p>';
        return;
    }

    // 時間順にソート（新しい順）
    const sorted = [...records].sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    list.innerHTML = sorted.map(record => `
        <div class="log-item" data-ts="${record.timestamp}">
            <span class="log-time">${record.time}</span>
            <span class="log-name">${record.user?.name || '不明'}</span>
            <span class="log-type">${record.typeLabel}${record.reason ? ` (${record.reason})` : ''}</span>
            <span class="log-tag">${TYPE_ICONS[record.type] || '📌'}</span>
            <button class="log-delete-btn" title="削除" onclick="confirmDeleteRecord('${encodeURIComponent(record.timestamp)}', '${record.user?.name || '不明'}', '${record.typeLabel}', '${record.time}')">🗑️</button>
        </div>
    `).join('');
}

/**
 * 打刻削除の確認ダイアログ
 */
function confirmDeleteRecord(encodedTimestamp, userName, typeLabel, time) {
    const timestamp = decodeURIComponent(encodedTimestamp);
    const confirmed = window.confirm(`以下の打刻を削除しますか？\n\n${userName} ／ ${typeLabel} ／ ${time}\n\n※この操作は元に戻せません`);
    if (confirmed) {
        deleteRecord(timestamp, userName, typeLabel);
    }
}

/**
 * 打刻をGASから削除する（ローカルも即座に削除）
 */
async function deleteRecord(timestamp, userName, typeLabel) {
    // ========================================
    // 0. 削除済みリストに登録（最重要：GAS再取得時もフィルタされる）
    // ========================================
    addToDeletedList(timestamp, userName, typeLabel);
    console.log('🚫 削除済みリストに登録:', userName, typeLabel, timestamp);

    // ========================================
    // 1. ローカルストレージから即削除
    // ========================================
    try {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (localRaw) {
            const localRecords = JSON.parse(localRaw);
            const targetTs = new Date(timestamp).getTime();

            const filtered = localRecords.filter(r => {
                const rName = r.user?.name || '';
                const rType = r.typeLabel || '';
                const rTs = new Date(r.timestamp).getTime();
                const timeDiff = Math.abs(rTs - targetTs);
                // 同じ人・同じ種別・2分以内の誤差 → 削除対象
                const isMatch = rName === userName && rType === typeLabel && timeDiff < 120000;
                return !isMatch;
            });

            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
            console.log('🗑️ ローカルStorage削除完了:', userName, typeLabel);
        }
    } catch (e) {
        console.error('ローカル削除エラー:', e);
    }


    // ========================================
    // 2. GASにも削除リクエスト（非同期・失敗してもOK）
    // ========================================
    if (GAS_URL) {
        try {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = GAS_URL;
            form.style.display = 'none';
            form.target = 'delete-result-frame';

            const params = {
                action: 'deleteRecord',
                timestamp: timestamp,
                employeeName: userName,
                punchType: typeLabel
            };

            for (const key in params) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = params[key];
                form.appendChild(input);
            }

            let frame = document.getElementById('delete-result-frame');
            if (!frame) {
                frame = document.createElement('iframe');
                frame.name = 'delete-result-frame';
                frame.style.display = 'none';
                document.body.appendChild(frame);
            }

            document.body.appendChild(form);
            form.submit();
            setTimeout(() => document.body.removeChild(form), 2000);
            console.log('☁️ GAS削除リクエスト送信:', userName, typeLabel);
        } catch (e) {
            console.error('GAS削除エラー（ローカルは削除済み）:', e);
        }
    }

    // ========================================
    // 3. 画面を再描画
    // ========================================
    await loadData();
}

/**
 * フィルターの初期化
 */
function initFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            // アクティブ状態を更新
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // フィルター適用
            const filter = btn.dataset.filter;
            const todayRecords = await getTodayRecords();
            const attendanceData = calculateAttendance(todayRecords);
            updateAttendanceList(attendanceData, filter);
        });
    });
}

/**
 * エクスポート機能の初期化
 */
function initExport() {
    // 年月の初期値を当月にセット
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('export-month').value = `${yyyy}-${mm}`;

    document.getElementById('export-excel').addEventListener('click', exportExcel);
    document.getElementById('export-csv').addEventListener('click', exportTKC);
    document.getElementById('export-log').addEventListener('click', exportLog);
}

/**
 * 期間指定に基づいて打刻記録を取得する汎用関数
 * 日付範囲が指定されている場合は優先。なければ年月で取得。
 */
async function getRecordsForExport() {
    const startDateVal = document.getElementById('export-start-date').value; // "YYYY-MM-DD"
    const endDateVal   = document.getElementById('export-end-date').value;   // "YYYY-MM-DD"
    const monthVal     = document.getElementById('export-month').value;       // "YYYY-MM"

    // 日付範囲指定モード
    if (startDateVal && endDateVal) {
        const startDate = startDateVal; // "YYYY-MM-DD"
        const endDate   = endDateVal;

        // 対象の月一覧を収集（例: 2026-02 〜 2026-03 なら ["2026-02","2026-03"]）
        const months = [];
        const cur = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate   + 'T00:00:00');
        while (cur <= end) {
            const m = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
            if (!months.includes(m)) months.push(m);
            cur.setMonth(cur.getMonth() + 1);
        }

        // 各月のデータを取得してマージ
        let allRecords = [];
        for (const month of months) {
            const records = await fetchMonthlyRecords(month);
            allRecords = allRecords.concat(records);
        }

        // 日付範囲でフィルタ
        return allRecords.filter(r => {
            const d = getRecordDateStr(r);
            return d >= startDate && d <= endDate;
        });
    }

    // 年月指定モード（デフォルト：当月）
    const month = monthVal || (() => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    })();
    return await fetchMonthlyRecords(month);
}

/**
 * GASから指定月のレコードを取得してローカル形式に変換
 */
async function fetchMonthlyRecords(month) {
    if (GAS_URL) {
        try {
            const response = await fetch(`${GAS_URL}?action=getMonthlyRecords&month=${month}`);
            const data = await response.json();
            if (data.records && data.records.length > 0) {
                return data.records
                    .filter(r => !isDeleted({ timestamp: r.timestamp, user: { name: r.employeeName }, typeLabel: r.punchType }))
                    .map(r => ({
                        id: r.timestamp,
                        timestamp: r.timestamp,
                        date: getRecordDateStr({ timestamp: r.timestamp }),
                        time: new Date(r.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                        type: convertPunchType(r.punchType),
                        typeLabel: r.punchType,
                        reason: r.reason || null,
                        user: {
                            id: r.employeeId,
                            name: r.employeeName,
                            email: r.email
                        }
                    }));
            }
        } catch (error) {
            console.error('月次データ取得エラー:', error);
        }
    }
    // フォールバック: LocalStorageから取得
    const localData = localStorage.getItem(STORAGE_KEY);
    if (!localData) return [];
    const records = JSON.parse(localData);
    return records.filter(r => {
        const d = getRecordDateStr(r);
        return d && d.startsWith(month);
    });
}

/**
 * レコードからJST日付文字列(YYYY-MM-DD)を取得
 */
function getRecordDateStr(record) {
    if (record.date) return record.date;
    if (!record.timestamp) return '';
    const d = new Date(record.timestamp);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().split('T')[0];
}

/**
 * TKC用CSV出力（期間指定対応）
 */
async function exportTKC() {
    const records = await getRecordsForExport();

    if (records.length === 0) {
        alert('指定期間のデータがありません');
        return;
    }

    // 日付×社員番号でグルーピング
    const grouped = {};
    records.forEach(record => {
        const dateStr = getRecordDateStr(record);
        const empId   = String(record.user?.id || '');
        if (!empId || !dateStr) return;
        const key = `${dateStr}_${empId}`;
        if (!grouped[key]) {
            grouped[key] = {
                date: dateStr,
                employeeId: empId,
                punchIn: null,
                punchOut: null
            };
        }
        const type = record.type || convertPunchType(record.typeLabel);
        const timeStr = record.time || new Date(record.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        if (type === 'punch-in')  { if (!grouped[key].punchIn)  grouped[key].punchIn  = timeStr; }
        if (type === 'punch-out') { grouped[key].punchOut = timeStr; }
    });

    // CSVヘッダー
    let csv = '社員番号,日付,出勤時刻,退勤時刻,勤務時間,残業時間\n';

    // 日付→社員番号の順にソート
    const sorted = Object.values(grouped).sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeId.localeCompare(b.employeeId);
    });

    sorted.forEach(row => {
        if (!row.punchIn) return; // 出勤打刻がない日はスキップ
        let workMinutes = 0;
        let overtimeMinutes = 0;
        if (row.punchIn && row.punchOut) {
            const inTime  = parseTime(row.punchIn);
            const outTime = parseTime(row.punchOut);
            workMinutes = outTime - inTime;
            if (workMinutes > 480) {
                overtimeMinutes = workMinutes - 480;
                workMinutes = 480;
            }
            if (workMinutes < 0) workMinutes = 0;
        }
        const workHours     = Math.floor(workMinutes / 60) + ':' + String(workMinutes % 60).padStart(2, '0');
        const overtimeHours = Math.floor(overtimeMinutes / 60) + ':' + String(overtimeMinutes % 60).padStart(2, '0');
        csv += `${row.employeeId},${row.date},${row.punchIn || ''},${row.punchOut || ''},${workHours},${overtimeHours}\n`;
    });

    // ファイル名（期間情報を付与）
    const startVal = document.getElementById('export-start-date').value;
    const endVal   = document.getElementById('export-end-date').value;
    const monthVal = document.getElementById('export-month').value;
    const suffix   = (startVal && endVal) ? `${startVal}_${endVal}` : (monthVal || 'export');
    downloadCSV(csv, `kintai_TKC_${suffix}.csv`);
    console.log(`✅ TKC CSV出力完了: ${sorted.length}日分のデータ（${records.length}件）`);
}

/**
 * 打刻ログ出力（期間指定対応）
 */
async function exportLog() {
    const records = await getRecordsForExport();

    if (records.length === 0) {
        alert('指定期間のデータがありません');
        return;
    }

    // 時間順にソート
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // CSVヘッダー
    let csv = '日時,日付,社員番号,氏名,種別,理由\n';
    records.forEach(record => {
        const dateStr = getRecordDateStr(record);
        csv += `${record.timestamp},${dateStr},${record.user?.id || ''},${record.user?.name || ''},${record.typeLabel || ''},${record.reason || ''}\n`;
    });

    const startVal = document.getElementById('export-start-date').value;
    const endVal   = document.getElementById('export-end-date').value;
    const monthVal = document.getElementById('export-month').value;
    const suffix   = (startVal && endVal) ? `${startVal}_${endVal}` : (monthVal || 'export');
    downloadCSV(csv, `kintai_log_${suffix}.csv`);
}

/**
 * CSVダウンロード
 */
function downloadCSV(content, filename) {
    const bom = '\uFEFF'; // Excel用BOM
    const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
}

// ========================================
// エクセル出力機能
// ========================================

/**
 * UTCタイムスタンプをJSTに変換
 */
function toJST(timestamp) {
    const date = new Date(timestamp);
    // UTCからJST (+9時間)
    return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

/**
 * 時刻文字列を分に変換 (例: "08:30" → 510)
 */
function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * 分を時刻文字列に変換 (例: 510 → "8:30")
 */
function minutesToTime(minutes) {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * 30分単位で切り上げ (出勤用)
 * 例: 8:01 → 8:30, 8:31 → 9:00, 9:00 → 9:00
 */
function roundUpTo30(timeStr) {
    const minutes = timeToMinutes(timeStr);
    if (minutes === null) return '';
    const rounded = Math.ceil(minutes / 30) * 30;
    return minutesToTime(rounded);
}

/**
 * 30分単位で切り捨て (退勤用)
 * 例: 17:29 → 17:00, 17:30 → 17:30, 17:59 → 17:30
 */
function roundDownTo30(timeStr) {
    const minutes = timeToMinutes(timeStr);
    if (minutes === null) return '';
    const rounded = Math.floor(minutes / 30) * 30;
    return minutesToTime(rounded);
}

/**
 * 社員の所定労働時間を取得（分単位）
 */
function getScheduledWorkMinutes(employeeId) {
    const id = String(employeeId);

    // 社員マスタから検索
    const emp = EMPLOYEES.find(e => e.id === id);
    if (!emp) {
        return DEFAULT_SCHEDULED_WORK_MINUTES;
    }

    // 雇用区分に基づく判定
    if (emp.employmentType === 'パート') {
        return 300; // 5時間
    }

    // デフォルト（正社員など）
    return 480; // 8時間
}

/**
 * タイムスタンプからJST時刻文字列(HH:MM)を取得（正しい変換）
 */
function getJSTTimeStr(record) {
    // fetchMonthlyRecordsで設定したtimeフィールドを優先使用（既にJST正しい値）
    if (record.time) return record.time;
    // フォールバック: timestampからJSTで変換（timeZone明示）
    return new Date(record.timestamp).toLocaleTimeString('ja-JP', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo'
    });
}

/**
 * 勤怠エクセル出力（期間指定対応）
 * 修正済み：
 *   - 時刻のJST二重変換バグを解消（record.timeを直接使用）
 *   - 中抜け（外出/戻り）時間を実働時間から差し引く
 *   - 実働時間・残業時間の計算を修正
 */
async function exportExcel() {
    try {
        const records = await getRecordsForExport();

        if (records.length === 0) {
            alert('指定期間のデータがありません');
            return;
        }

        // 日付・社員番号でグループ化
        const grouped = {};

        records.forEach(record => {
            const dateKey = getRecordDateStr(record);
            const empId   = String(record.user?.id || '');
            const empName = record.user?.name || '';
            if (!empId || !dateKey) return;

            const key = `${dateKey}_${empId}`;
            if (!grouped[key]) {
                grouped[key] = {
                    date: dateKey,
                    employeeId: empId,
                    employeeName: empName,
                    punchInRecords:   [],   // 出勤打刻
                    punchOutRecords:  [],   // 退勤打刻
                    breakStartRecords: [],  // 中抜け開始（外出）
                    breakEndRecords:   []   // 中抜け終了（戻り）
                };
            }

            // 時刻取得（record.timeを直接使用 → JST正しい値）
            const timeStr = getJSTTimeStr(record);
            const mins    = timeToMinutes(timeStr);
            if (mins === null) return;

            const type = record.type || record.typeLabel;
            if (type === 'punch-in'   || record.typeLabel === '出勤') {
                grouped[key].punchInRecords.push({ time: timeStr, minutes: mins });
            } else if (type === 'punch-out' || record.typeLabel === '退勤') {
                grouped[key].punchOutRecords.push({ time: timeStr, minutes: mins });
            } else if (type === 'break-start' || record.typeLabel === '中抜け開始') {
                grouped[key].breakStartRecords.push({ time: timeStr, minutes: mins });
            } else if (type === 'break-end' || record.typeLabel === '中抜け終了') {
                grouped[key].breakEndRecords.push({ time: timeStr, minutes: mins });
            }
        });

        // エクセルデータを作成
        const excelData = [];

        Object.values(grouped).forEach(group => {
            // 出勤: 最も早い時刻
            let rawPunchIn = '';
            if (group.punchInRecords.length > 0) {
                rawPunchIn = group.punchInRecords.reduce((min, r) =>
                    r.minutes < min.minutes ? r : min
                ).time;
            }

            // 退勤: 最も遅い時刻
            let rawPunchOut = '';
            if (group.punchOutRecords.length > 0) {
                rawPunchOut = group.punchOutRecords.reduce((max, r) =>
                    r.minutes > max.minutes ? r : max
                ).time;
            }

            // 中抜け合計時間（分）：開始↔終了のペアを順番に計算
            let breakMinutes = 0;
            const bStarts = [...group.breakStartRecords].sort((a, b) => a.minutes - b.minutes);
            const bEnds   = [...group.breakEndRecords].sort((a, b) => a.minutes - b.minutes);
            let ei = 0;
            for (const bs of bStarts) {
                // このbreakStartの後に来る最初のbreakEndを探す
                while (ei < bEnds.length && bEnds[ei].minutes <= bs.minutes) ei++;
                if (ei < bEnds.length) {
                    breakMinutes += bEnds[ei].minutes - bs.minutes;
                    ei++;
                }
            }

            // 計算用時刻（30分丸め）
            const calcPunchIn  = roundUpTo30(rawPunchIn);
            const calcPunchOut = roundDownTo30(rawPunchOut);

            // 外出・戻りの時刻文字列を生成
            const breakStartTimes = bStarts.map(r => r.time).join(', ');
            const breakEndTimes   = bEnds.map(r => r.time).join(', ');

            // 実働時間の計算
            let workTime  = '';
            let breakTime = minutesToTime(breakMinutes);
            let overtime  = '';

            const calcInMins  = timeToMinutes(calcPunchIn);
            const calcOutMins = timeToMinutes(calcPunchOut);

            if (calcInMins !== null && calcOutMins !== null && calcOutMins > calcInMins) {
                let workMinutes = calcOutMins - calcInMins;

                // 中抜け時間を差し引く（外出/戻りが記録されている場合はそちらを優先）
                if (breakMinutes > 0) {
                    workMinutes -= breakMinutes;
                } else if (workMinutes > 360) {
                    // 外出/戻り記録なし かつ 6時間超の場合は自動控除1時間
                    workMinutes -= 60;
                }

                if (workMinutes < 0) workMinutes = 0;
                workTime = minutesToTime(workMinutes);

                // 残業計算（個人の所定労働時間を参照）
                const scheduledMins = getScheduledWorkMinutes(group.employeeId);
                let overtimeMins = workMinutes - scheduledMins;
                if (overtimeMins < 0) overtimeMins = 0;
                overtime = minutesToTime(overtimeMins);
            }

            excelData.push({
                '日付':     group.date,
                '社員番号': group.employeeId,
                '氏名':     group.employeeName,
                '実勢出勤': rawPunchIn,
                '実勢退勤': rawPunchOut,
                '計算出勤': calcPunchIn,
                '計算退勤': calcPunchOut,
                '外出':     breakStartTimes, // 追加
                '戻り':     breakEndTimes,   // 追加
                '中抜時間': breakMinutes > 0 ? breakTime : '',
                '実働時間': workTime,
                '残業時間': overtime
            });
        });

        if (excelData.length === 0) {
            alert('出力するデータがありません');
            return;
        }

        // 日付順・社員番号順にソート
        excelData.sort((a, b) => {
            if (a['日付'] !== b['日付']) return a['日付'].localeCompare(b['日付']);
            return a['社員番号'].localeCompare(b['社員番号']);
        });

        // SheetJSでエクセルファイルを作成
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook  = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '勤怠データ');

        // カラム幅を設定
        worksheet['!cols'] = [
            { wch: 12 },  // 日付
            { wch: 10 },  // 社員番号
            { wch: 15 },  // 氏名
            { wch: 10 },  // 実勢出勤
            { wch: 10 },  // 実勢退勤
            { wch: 10 },  // 計算出勤
            { wch: 10 },  // 計算退勤
            { wch: 10 },  // 外出
            { wch: 10 },  // 戻り
            { wch: 10 },  // 中抜時間
            { wch: 10 },  // 実働時間
            { wch: 10 },  // 残業時間
        ];

        // ファイル名（期間情報を付与）
        const startVal = document.getElementById('export-start-date').value;
        const endVal   = document.getElementById('export-end-date').value;
        const monthVal = document.getElementById('export-month').value;
        const suffix   = (startVal && endVal) ? `${startVal}_${endVal}` : (monthVal || 'export');
        const filename = `勤怠データ_${suffix}.xlsx`;
        XLSX.writeFile(workbook, filename);

        console.log(`✅ エクセル出力完了: ${excelData.length}件 → ${filename}`);

    } catch (error) {
        console.error('❌ エクセル出力エラー:', error);
        alert('エクセル出力中にエラーが発生しました: ' + error.message);
    }
}

