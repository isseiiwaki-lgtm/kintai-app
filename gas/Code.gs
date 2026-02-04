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
      case 'updateRequestStatus':
        return jsonResponse(updateRequestStatus(data));
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
  const lock = LockService.getScriptLock();
  
  try {
    // 他の実行を最大5秒待つ
    if (!lock.tryLock(5000)) {
      throw new Error('サーバーが混み合っています。しばらく待ってから再試行してください。');
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
    
    // シートがなければ作成
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.PUNCH_LOG);
      sheet.appendRow([
        '日時', '社員番号', '氏名', '種別', '理由', 
        '仮打刻', 'Googleメール', '打刻ID' // H列に追加
      ]);
    }

    // ========================================
    // 重複チェック
    // ========================================
    const lastRow = sheet.getLastRow();
    
    // データがある場合のみチェック（直近50件）
    if (lastRow > 1) {
      const checkRows = Math.min(lastRow - 1, 50);
      const startRow = lastRow - checkRows + 1;
      // H列(8列目)まで取得
      const dataRange = sheet.getRange(startRow, 1, checkRows, 8);
      const values = dataRange.getValues();
      
      const requestPunchId = data.punchId;
      const requestTime = new Date().getTime(); // 現在時刻
      const requestEmpId = String(data.employeeId); // 文字列比較
      const requestType = data.punchType;

      // 新しい順にチェック（後ろから）
      for (let i = values.length - 1; i >= 0; i--) {
        const row = values[i];
        
        // 1. 打刻IDによる完全重複チェック（冪等性担保）
        const rowPunchId = row[7]; // H列 = index 7
        if (requestPunchId && rowPunchId === requestPunchId) {
          console.log('重複スキップ(ID一致): ' + requestPunchId);
          // 成功として返す（クライアントは完了とみなす）
          return { 
            success: true, 
            message: '打刻済みです（重複）',
            timestamp: new Date().toISOString()
          };
        }
        
        // 2. 時間差による重複チェック（意図しない連打防止）
        // 同じ社員、同じ種別で
        const rowEmpId = String(row[1]);
        const rowType = row[3];
        
        if (rowEmpId === requestEmpId && rowType === requestType) {
          const rowTime = new Date(row[0]).getTime();
          // 1分(60000ms)以内なら重複とみなす
          if (Math.abs(requestTime - rowTime) < 60 * 1000) {
             console.log('重複スキップ(時間差): ' + rowEmpId + ' ' + rowType);
             return { 
               success: true, 
               message: '打刻済みです（連打防止）',
               timestamp: new Date().toISOString()
             };
          }
        }
      }
    }
    
    // ========================================
    // 保存処理
    // ========================================
    
    const now = new Date();
    
    // A列: 日時を日本時間で見やすく保存
    const jstNow = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    
    const row = [
      jstNow,
      data.employeeId,
      data.employeeName,
      data.punchType,
      data.reason || '',
      data.isTemporary ? 'TRUE' : 'FALSE',
      data.email || '',
      data.punchId || '' // H列: 打刻ID
    ];
    
    sheet.appendRow(row);
    
    // 追加した行のB列（社員番号）の書式をテキストにして0落ちを防ぐ
    const newLastRow = sheet.getLastRow();
    const idCell = sheet.getRange(newLastRow, 2); // 2列目 = 社員番号
    idCell.setNumberFormat('@');
    idCell.setValue(String(data.employeeId).padStart(3, '0')); // 3桁ゼロ埋めして再セット
    
    return { 
      success: true, 
      message: '打刻を記録しました',
      timestamp: now.toISOString()
    };

  } catch (error) {
    console.error('Record Punch Error: ' + error.toString());
    // エラー情報を返す
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
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
        timestamp: new Date(row[0]).toISOString(), // 文字列JSTでもDateでもISO化
        employeeId: row[1],
        employeeName: row[2],
        punchType: row[3],
        reason: row[4],
        isTemporary: row[5] === 'TRUE', // F列
        email: row[6] // G列
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
        timestamp: new Date(row[0]).toISOString(),
        employeeId: row[1],
        employeeName: row[2],
        punchType: row[3],
        reason: row[4],
        isTemporary: row[5] === 'TRUE',
        email: row[6]
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

/**
 * 申請ステータスを更新（承認/却下）
 */
function updateRequestStatus(data) {
  const lock = LockService.getScriptLock();
  
  try {
    if (!lock.tryLock(5000)) {
      throw new Error('サーバーが混み合っています。しばらく待ってから再試行してください。');
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.REQUEST_LOG);
    
    if (!sheet) {
      return { error: '申請ログシートが見つかりません' };
    }
    
    const requestTimestamp = data.requestTimestamp;
    const newStatus = data.status; // '承認' or '却下'
    const adminEmail = data.adminEmail || '';
    
    if (!requestTimestamp || !newStatus) {
      return { error: '必須パラメータが不足しています' };
    }
    
    // 申請を検索（A列のタイムスタンプで照合）
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    let updated = false;
    for (let i = 1; i < values.length; i++) {
      const rowTimestamp = values[i][0];
      
      // タイムスタンプの比較（文字列 or Date）
      let match = false;
      if (typeof rowTimestamp === 'string') {
        match = rowTimestamp === requestTimestamp;
      } else if (rowTimestamp instanceof Date) {
        match = rowTimestamp.toISOString() === requestTimestamp;
      }
      
      if (match) {
        // L列(12列目)のステータスを更新
        sheet.getRange(i + 1, 12).setValue(newStatus);
        updated = true;
        console.log('申請ステータス更新: 行' + (i + 1) + ' → ' + newStatus);
        break;
      }
    }
    
    if (!updated) {
      return { error: '対象の申請が見つかりませんでした' };
    }
    
    return { 
      success: true, 
      message: `申請を${newStatus}しました`,
      status: newStatus
    };

  } catch (error) {
    console.error('Update Request Status Error: ' + error.toString());
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
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
      '緯度', '経度', '位置取得', '仮打刻', 'Googleメール', '打刻ID'
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
    .addItem('社員番号を3桁に変換', 'convertEmployeeIdsTo3Digits')
    .addItem('日時を日本時間に変換', 'convertTimestampsToJST')
    .addSeparator()
    .addItem('🚫 位置情報列(F-H)を削除', 'deleteLocationColumns')
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

/**
 * 打刻ログの社員番号を3桁にゼロ埋めする
 * スプレッドシートのメニューから実行: 勤怠管理 → 社員番号を3桁に変換
 */
function convertEmployeeIdsTo3Digits() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert('打刻ログシートが見つかりません');
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('データがありません');
    return;
  }
  
  // B列（社員番号）を取得 (2行目から)
  const range = sheet.getRange(2, 2, lastRow - 1, 1);
  const values = range.getValues();
  
  let updatedCount = 0;
  
  // 3桁にゼロ埋め
  const newValues = values.map(row => {
    const id = row[0];
    if (id === '' || id === null) return [id];
    
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return [id];
    
    const paddedId = String(numId).padStart(3, '0');
    if (paddedId !== String(id)) {
      updatedCount++;
    }
    return [paddedId];
  });
  
  // 書式をテキスト（"@"）に設定して、0落ちを防ぐ
  range.setNumberFormat('@');
  
  // 書き戻し
  range.setValues(newValues);
  
  SpreadsheetApp.getUi().alert('完了しました！\\n変換した件数: ' + updatedCount + '件');
}

/**
 * 打刻ログの日時をUTCから日本時間（JST）に変換する
 * スプレッドシートのメニューから実行: 勤怠管理 → 日時を日本時間に変換
 */
function convertTimestampsToJST() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert('打刻ログシートが見つかりません');
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('データがありません');
    return;
  }
  
  // A列（日時）を取得 (2行目から)
  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();
  
  let updatedCount = 0;
  
  // UTCからJSTに変換
  const newValues = values.map(row => {
    const timestamp = row[0];
    if (timestamp === '' || timestamp === null) return [timestamp];
    
    // 既に日本時間形式（yyyy/MM/dd HH:mm:ss）の場合はスキップ
    if (typeof timestamp === 'string' && !timestamp.includes('T') && !timestamp.includes('Z')) {
      return [timestamp];
    }
    
    try {
      let date;
      if (typeof timestamp === 'string') {
        date = new Date(timestamp);
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else {
        return [timestamp];
      }
      
      if (isNaN(date.getTime())) return [timestamp];
      
      // 日本時間にフォーマット（yyyy/MM/dd HH:mm:ss）
      const jstDate = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      updatedCount++;
      return [jstDate];
    } catch (e) {
      return [timestamp];
    }
  });
  
  // 書き戻し
  range.setValues(newValues);
  
  SpreadsheetApp.getUi().alert('完了しました！\\n変換した件数: ' + updatedCount + '件');
}

/**
 * 位置情報関連の列（F, G, H列）を物理的に削除する
 * スプレッドシートのメニューから実行
 */
function deleteLocationColumns() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('確認', '打刻ログのF, G, H列（緯度・経度・位置取得）を削除して詰め込みますか？\\n※GASのコード更新後に必ず1回だけ実行してください。', ui.ButtonSet.YES_NO);
  
  if (response !== ui.Button.YES) return;
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.PUNCH_LOG);
  
  if (!sheet) {
    ui.alert('打刻ログシートが見つかりません');
    return;
  }
  
  // F列(6)から3列分を削除
  sheet.deleteColumns(6, 3);
  
  // ヘッダーを修正（念のため）
  const headerRange = sheet.getRange(1, 1, 1, 7);
  headerRange.setValues([['日時', '社員番号', '氏名', '種別', '理由', '仮打刻', 'Googleメール']]);
  
  ui.alert('削除しました。列が詰められました。');
}

