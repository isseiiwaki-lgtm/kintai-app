export type Priority = 'high' | 'medium' | 'low';

export type Category = {
  id: string;
  name: string;
  color: string;
};

// 定期タスクの繰り返しルール
export type RecurringRule = {
  type: 'daily' | 'weekly' | 'monthly';
  // weeklyの場合 (0: 日曜日 - 6: 土曜日)
  dayOfWeek?: number;
  // monthlyの場合
  monthlyType?: 'start' | 'end' | 'specific';
  // specificの場合 (1 - 31)
  dayOfMonth?: number;
};

// 定期タスクの定義
export type RecurringTask = {
  id: string;
  title: string;
  rule: RecurringRule;
  priority: Priority;
  categoryId: string;
  memo?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// 単発タスク
export type AdHocTask = {
  id: string;
  targetDate: string; // YYYY-MM-DD
  title: string;
  priority: Priority;
  categoryId: string;
  memo?: string;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};

// 定期タスクの完了記録
export type CompletionRecord = {
  id: string;
  taskId: string; // RecurringTask ID
  targetDate: string; // YYYY-MM-DD
  completedAt: string; // ISO 8601 DateTime
};

// アプリケーション全体の状態
export type AppState = {
  categories: Category[];
  recurringTasks: RecurringTask[];
  adHocTasks: AdHocTask[];
  completionRecords: CompletionRecord[];
};
