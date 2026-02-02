/**
 * 勤怠管理システム - Google Apps Script
 * 
 * 【セットアップ手順】
 * 1. Google スプレッドシートを新規作成
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコードを貼り付け
 * 4. スプレッドシートIDを設定（下記の SPREADSHEET_ID を変更）
 * 5. デプロイ → 新しいデプロイ → ウェブアプリ として公開
 * 6. 実行するユーザー: 自分、アクセスできるユーザー: 全員
 * 
 * 【シート構成】
 * - 打刻ログ: 全打刻データ
 * - 社員マスタ: 社員情報
 * - 修正ログ: 管理者による修正履歴
 */

// ========================================
// 設定
// ========================================

// スプレッドシートID（URLの /d/XXXXX/edit の XXXXX 部分）
const SPREADSHEET_ID = '1TY5wJOVxs4eoXrYLr9LFibYSbtMVSFtckpay2gyWekY';

// シート名
const SHEET_NAMES = {
  PUNCH_LOG: '打刻ログ',
  EMPLOYEES: '社員マスタ',
  EDIT_LOG: '修正ログ',
  REQUEST_LOG: '申請ログ'
};

// ========================================
// Webアプリ設定
// ========================================

/**
 * GETリクエスト処理
 */
function doGet(e) {
  const action = e.parameter.action;
  
  switch (action) {
    case 'getEmployees':
      return jsonResponse(getEmployees());
    case 'getTodayRecords':
      return jsonResponse(getTodayRecords());
    case 'getMonthlyRecords':
      const month = e.parameter.month; // YYYY-MM形式
      return jsonResponse(getMonthlyRecords(month));
    case 'getRequests':
      return jsonResponse(getRequests());
    default:
      return jsonResponse({ error: '不明なアクション' });
  }
}

/**
 * POSTリクエスト処理
 */
function doPost(e) {
  try {
    // デバッグ用ログ
    console.log('doPost executed');
    console.log(JSON.stringify(e));

    let data;
    let action;

    // JSONデータとして解析を試みる
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
        action = data.action;
      } catch (e) {
        // JSONパースエラー時は無視
      }
    }

    // JSONでない場合、パラメータから取得を試みる（Form送信対応）
    if (!action && e.parameter) {
      data = e.parameter;
      action = data.action;
    }

    if (!action) {
      return jsonResponse({ error: 'アクションが指定されていません' });
    }
    
    switch (action) {
      case 'punch':
        return jsonResponse(recordPunch(data));
      case 'request':
        return jsonResponse(recordRequest(data));
      case 'editRecord':
        return jsonResponse(editRecord(data));
      default:
        return jsonResponse({ error: '不明なアクション: ' + action });
    }
  } catch (error) {
    console.error('Error in doPost: ' + error.toString());
    return jsonResponse({ error: error.message });
  }
}

/**
 * JSON レスポンスを返す
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// 打刻機能
// ========================================

/**
 * 打刻を記録
 */
function recordPunch(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  // シートがなければ作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.PUNCH_LOG);
    sheet.appendRow([
      '日時', '社員番号', '氏名', '種別', '理由', 
      '緯度', '経度', '位置取得', '仮打刻', 'Googleメール'
    ]);
  }
  
  const now = new Date();
  const row = [
    now.toISOString(),
    data.employeeId,
    data.employeeName,
    data.punchType,
    data.reason || '',
    data.latitude || '',
    data.longitude || '',
    data.locationStatus || '',
    data.isTemporary ? 'TRUE' : 'FALSE',
    data.email || ''
  ];
  
  sheet.appendRow(row);
  
  return { 
    success: true, 
    message: '打刻を記録しました',
    timestamp: now.toISOString()
  };
}

/**
 * 申請を記録
 */
function recordRequest(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAMES.REQUEST_LOG);
  
  // シートがなければ作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.REQUEST_LOG);
    sheet.appendRow([
      '日時', '社員番号', '氏名', '申請種別', '対象日', '終了日', 
      '開始時刻', '終了時刻', '半休区分', '休暇種別', '理由', 'ステータス', 'Googleメール'
    ]);
  }
  
  const now = new Date();
  const row = [
    now.toISOString(),
    data.employeeId,
    data.employeeName,
    data.typeLabel,      // 申請種別
    data.date,           // 対象日
    data.endDate || '',  // 終了日
    data.time || '',     // 開始時刻
    data.endTime || '',  // 終了時刻
    data.halfDayType || '', // 半休区分
    data.leaveType || '',   // 休暇種別
    data.reason || '',      // 理由
    data.status || '申請中', // ステータス
    data.email || ''        // Googleメール
  ];
  
  sheet.appendRow(row);
  
  return { 
    success: true, 
    message: '申請を記録しました',
    timestamp: now.toISOString()
  };
}

/**
 * 今日の打刻記録を取得
 */
function getTodayRecords() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  if (!sheet) {
    return { records: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const recordDate = Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy-MM-dd');
    
    if (recordDate === today) {
      records.push({
        timestamp: row[0],
        employeeId: row[1],
        employeeName: row[2],
        punchType: row[3],
        reason: row[4],
        latitude: row[5],
        longitude: row[6],
        locationStatus: row[7],
        isTemporary: row[8] === 'TRUE',
        email: row[9]
      });
    }
  }
  
  return { records: records };
}

/**
 * 月次の打刻記録を取得
 */
function getMonthlyRecords(month) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  if (!sheet) {
    return { records: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const records = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const recordMonth = Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy-MM');
    
    if (recordMonth === month) {
      records.push({
        timestamp: row[0],
        employeeId: row[1],
        employeeName: row[2],
        punchType: row[3],
        reason: row[4],
        latitude: row[5],
        longitude: row[6],
        locationStatus: row[7],
        isTemporary: row[8] === 'TRUE',
        email: row[9]
      });
    }
  }
  
  return { records: records };
}

/**
 * 申請一覧を取得
 */
function getRequests() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.REQUEST_LOG);
  
  if (!sheet) {
    return { requests: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const requests = [];
  
  // ヘッダーを除いて全件取得（新しい順にしたい場合はクライアント側でソートするか、ここで逆順にする）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    requests.push({
      timestamp: row[0],
      employeeId: row[1],
      employeeName: row[2],
      typeLabel: row[3],
      date: Utilities.formatDate(row[4] instanceof Date ? row[4] : new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd'),
      endDate: row[5] ? Utilities.formatDate(row[5] instanceof Date ? row[5] : new Date(row[5]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      time: row[6] ? Utilities.formatDate(row[6] instanceof Date ? row[6] : new Date(row[6]), 'Asia/Tokyo', 'HH:mm') : row[6], // データ型によって調整
      endTime: row[7] ? Utilities.formatDate(row[7] instanceof Date ? row[7] : new Date(row[7]), 'Asia/Tokyo', 'HH:mm') : row[7],
      halfDayType: row[8],
      leaveType: row[9],
      reason: row[10],
      status: row[11],
      email: row[12]
    });
  }
  
  return { requests: requests };
}

// ========================================
// 社員マスタ機能
// ========================================

/**
 * 社員一覧を取得
 */
function getEmployees() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.EMPLOYEES);
  
  if (!sheet) {
    return { employees: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const employees = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[5] === 'TRUE' || row[5] === true) { // 有効フラグ
      employees.push({
        id: String(row[0]),
        name: row[1],
        furigana: row[2],
        email: row[3],
        employmentType: row[4],
        active: true
      });
    }
  }
  
  return { employees: employees };
}

// ========================================
// 修正機能（管理者用）
// ========================================

/**
 * 打刻を修正
 */
function editRecord(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 修正ログに記録
  let editSheet = ss.getSheetByName(SHEET_NAMES.EDIT_LOG);
  if (!editSheet) {
    editSheet = ss.insertSheet(SHEET_NAMES.EDIT_LOG);
    editSheet.appendRow([
      '修正日時', '管理者', '対象社員', '対象日時', '修正前', '修正後', '理由'
    ]);
  }
  
  const now = new Date();
  editSheet.appendRow([
    now.toISOString(),
    data.adminEmail,
    data.targetEmployee,
    data.targetTimestamp,
    data.beforeValue,
    data.afterValue,
    data.editReason
  ]);
  
  // 実際のデータ修正（打刻ログシート）
  const punchSheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  if (punchSheet) {
    const punchData = punchSheet.getDataRange().getValues();
    
    for (let i = 1; i < punchData.length; i++) {
      if (punchData[i][0] === data.targetTimestamp && 
          punchData[i][1] === data.targetEmployee) {
        // 修正対象の列に応じて更新
        // ここでは種別（3列目）を修正する例
        punchSheet.getRange(i + 1, 4).setValue(data.afterValue);
        break;
      }
    }
  }
  
  return { 
    success: true, 
    message: '修正を記録しました' 
  };
}

// ========================================
// TKC CSV出力
// ========================================

/**
 * TKC用CSVを生成
 */
function generateTKCCSV(month) {
  const records = getMonthlyRecords(month).records;
  const employees = getEmployees().employees;
  
  // 社員ごと・日付ごとに集計
  const summary = {};
  
  records.forEach(record => {
    const date = Utilities.formatDate(new Date(record.timestamp), 'Asia/Tokyo', 'yyyy-MM-dd');
    const key = `${record.employeeId}_${date}`;
    
    if (!summary[key]) {
      summary[key] = {
        employeeId: record.employeeId,
        date: date,
        punchIn: null,
        punchOut: null
      };
    }
    
    if (record.punchType === '出勤' && !summary[key].punchIn) {
      summary[key].punchIn = Utilities.formatDate(new Date(record.timestamp), 'Asia/Tokyo', 'HH:mm');
    }
    if (record.punchType === '退勤') {
      summary[key].punchOut = Utilities.formatDate(new Date(record.timestamp), 'Asia/Tokyo', 'HH:mm');
    }
  });
  
  // CSV生成
  let csv = '社員番号,日付,出勤時刻,退勤時刻,勤務時間,残業時間\n';
  
  Object.values(summary).forEach(row => {
    let workMinutes = 0;
    let overtimeMinutes = 0;
    
    if (row.punchIn && row.punchOut) {
      const inTime = parseTimeToMinutes(row.punchIn);
      const outTime = parseTimeToMinutes(row.punchOut);
      workMinutes = outTime - inTime;
      
      if (workMinutes > 480) { // 8時間超
        overtimeMinutes = workMinutes - 480;
        workMinutes = 480;
      }
    }
    
    const workTime = minutesToTime(workMinutes);
    const overtime = minutesToTime(overtimeMinutes);
    
    csv += `${row.employeeId},${row.date},${row.punchIn || ''},${row.punchOut || ''},${workTime},${overtime}\n`;
  });
  
  return csv;
}

/**
 * 時刻文字列を分に変換
 */
function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 分を時刻文字列に変換
 */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ========================================
// 初期設定
// ========================================

/**
 * スプレッドシートの初期設定
 * メニューから実行して初期シートを作成
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 打刻ログシート
  let punchSheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  if (!punchSheet) {
    punchSheet = ss.insertSheet(SHEET_NAMES.PUNCH_LOG);
    punchSheet.appendRow([
      '日時', '社員番号', '氏名', '種別', '理由', 
      '緯度', '経度', '位置取得', '仮打刻', 'Googleメール'
    ]);
    punchSheet.setFrozenRows(1);
  }
  
  // 社員マスタシート
  let empSheet = ss.getSheetByName(SHEET_NAMES.EMPLOYEES);
  if (!empSheet) {
    empSheet = ss.insertSheet(SHEET_NAMES.EMPLOYEES);
    empSheet.appendRow([
      '社員番号', '氏名', 'フリガナ', 'Googleメール', '雇用区分', '有効'
    ]);
    empSheet.setFrozenRows(1);
  }
  
  // 修正ログシート
  let editSheet = ss.getSheetByName(SHEET_NAMES.EDIT_LOG);
  if (!editSheet) {
    editSheet = ss.insertSheet(SHEET_NAMES.EDIT_LOG);
    editSheet.appendRow([
      '修正日時', '管理者', '対象社員', '対象日時', '修正前', '修正後', '理由'
    ]);
    editSheet.setFrozenRows(1);
  }

  // 申請ログシート
  let requestSheet = ss.getSheetByName(SHEET_NAMES.REQUEST_LOG);
  if (!requestSheet) {
    requestSheet = ss.insertSheet(SHEET_NAMES.REQUEST_LOG);
    requestSheet.appendRow([
      '日時', '社員番号', '氏名', '申請種別', '対象日', '終了日', 
      '開始時刻', '終了時刻', '半休区分', '休暇種別', '理由', 'ステータス', 'Googleメール'
    ]);
    requestSheet.setFrozenRows(1);
  }
  
  SpreadsheetApp.getUi().alert('シートの初期設定が完了しました！');
}

/**
 * カスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('勤怠管理')
    .addItem('初期設定', 'setupSpreadsheet')
    .addItem('TKC CSV出力', 'showTKCDialog')
    .addToUi();
}

/**
 * TKC出力ダイアログ
 */
function showTKCDialog() {
  const html = HtmlService.createHtmlOutputFromFile('TKCDialog')
    .setWidth(300)
    .setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, 'TKC CSV出力');
}
