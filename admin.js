/**
 * 管理者ダッシュボード - スクリプト
 * 出勤一覧、アラート、TKC CSV出力
 */

// ========================================
// 定数・設定
// ========================================
const STORAGE_KEY = 'kintai_records';

// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
// Google Apps Script URL（セットアップ後に設定）
// 設定方法: gas/README.mdを参照
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwddm7bng-cpFydXcwiOuOQrnIP5p2sk7TUFkMYAjdFaYLKpN-fFXckjdJIcieqt75O/exec';

// 社員データ（CSVから読み込む想定、ここではハードコード）
const EMPLOYEES = [
    { id: '003', name: '鈴木一成', email: 'issei@iwaki-i.com', type: '正社員' },
    { id: '004', name: '鈴木亜佐子', email: 'a-suzuki@iwaki-i.com', type: '正社員' },
    { id: '108', name: '坂本緩奈', email: 'k-sakamoto@iwaki-i.com', type: 'パート' },
    { id: '119', name: '小河原裕美', email: 'y-ogawara@iwaki-i.com', type: '正社員' },
    { id: '120', name: '石井章子', email: 's-ishii@iwaki-i.com', type: 'パート' },
    { id: '121', name: '根本桜子', email: 'nemoto@iwaki-i.com', type: 'パート' },
    { id: '122', name: '須田育美', email: 'suda@iwaki-i.com', type: 'パート' },
    { id: '223', name: '山崎公', email: 'yamazaki@iwaki-i.com', type: '正社員' },
    { id: '229', name: '国井明日香', email: 'a-kunii@iwaki-i.com', type: '正社員' },
    { id: '239', name: '小林匠', email: 't-kobayashi@iwaki-i.com', type: '正社員' },
    { id: '240', name: '古田部暁欧', email: 'a-kotabe@iwaki-i.com', type: '正社員' },
    { id: '302', name: '半沢昇一', email: 'hanzawa@iwaki-i.com', type: '正社員' },
    { id: '334', name: '野木理絵', email: 'nogi@iwaki-i.com', type: 'パート' },
    { id: '337', name: '羽山明子', email: 'hayama@iwaki-i.com', type: 'パート' },
    { id: '606', name: '布施由美', email: '', type: 'パート' },
    { id: '610', name: '岡田友美', email: '', type: 'パート' },
    { id: '620', name: '野崎瑤子', email: 'y-nozaki@iwaki-i.com', type: 'パート' },
    { id: '622', name: '工藤三帆', email: 'm-kudo@iwaki-i.com', type: 'パート' },
    { id: '705', name: '櫻田千恵美', email: 'sakurada@iwaki-i.com', type: '正社員' },
    { id: '706', name: '熊谷和樹', email: 'kumagai@iwaki-i.com', type: '正社員' },
    { id: '707', name: '櫻井祐輔', email: 'sakurai@iwaki-i.com', type: 'パート' }
];

// 打刻タイプのアイコン
const TYPE_ICONS = {
    'punch-in': '🌅',
    'punch-out': '🌆',
    'break-start': '☕',
    'break-end': '💼'
};

// ========================================
// 初期化
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initDate();
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

        return `
            <div class="request-item">
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
            </div>
        `;
    }).join('');
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

                // GASのデータ形式をローカル形式に変換
                return data.records.map(r => ({
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
        <div class="log-item">
            <span class="log-time">${record.time}</span>
            <span class="log-name">${record.user?.name || '不明'}</span>
            <span class="log-type">${record.typeLabel}${record.reason ? ` (${record.reason})` : ''}</span>
            <span class="log-tag">${TYPE_ICONS[record.type] || '📌'}</span>
        </div>
    `).join('');
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
    document.getElementById('export-csv').addEventListener('click', exportTKC);
    document.getElementById('export-log').addEventListener('click', exportLog);
}

/**
 * TKC用CSV出力
 */
async function exportTKC() {
    const todayRecords = await getTodayRecords();
    const attendanceData = calculateAttendance(todayRecords);
    const today = new Date().toISOString().split('T')[0];

    // CSVヘッダー
    let csv = '社員番号,日付,出勤時刻,退勤時刻,勤務時間,残業時間\n';

    Object.values(attendanceData).forEach(data => {
        if (data.punchIn) {
            let workMinutes = 0;
            let overtimeMinutes = 0;

            if (data.punchIn && data.punchOut) {
                const inTime = parseTime(data.punchIn);
                const outTime = parseTime(data.punchOut);
                workMinutes = outTime - inTime;

                // 8時間（480分）超えたら残業
                if (workMinutes > 480) {
                    overtimeMinutes = workMinutes - 480;
                    workMinutes = 480;
                }
            }

            const workHours = Math.floor(workMinutes / 60) + ':' + String(workMinutes % 60).padStart(2, '0');
            const overtimeHours = Math.floor(overtimeMinutes / 60) + ':' + String(overtimeMinutes % 60).padStart(2, '0');

            csv += `${data.employee.id},${today},${data.punchIn || ''},${data.punchOut || ''},${workHours},${overtimeHours}\n`;
        }
    });

    downloadCSV(csv, `kintai_${today}.csv`);
}

/**
 * 打刻ログ出力
 */
async function exportLog() {
    const todayRecords = await getTodayRecords();
    const today = new Date().toISOString().split('T')[0];

    // CSVヘッダー
    let csv = '日時,社員番号,氏名,種別,理由,備考,緯度,経度,位置取得\n';

    todayRecords.forEach(record => {
        const lat = record.location?.latitude || '';
        const lng = record.location?.longitude || '';
        const locStatus = record.locationStatus || '';
        const note = record.note || '';

        csv += `${record.timestamp},${record.user?.id || ''},${record.user?.name || ''},${record.typeLabel},${record.reason || ''},${note},${lat},${lng},${locStatus}\n`;
    });

    downloadCSV(csv, `kintai_log_${today}.csv`);
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
