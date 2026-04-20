import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, AdHocTask, RecurringTask, CompletionRecord, Priority } from '@/types';

// Omit を使って id と createdAt/updatedAt を除いた型を定義
export type CreateAdHocTaskInput = Omit<AdHocTask, 'id' | 'createdAt' | 'updatedAt' | 'isCompleted'>;
export type CreateRecurringTaskInput = Omit<RecurringTask, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>;

type StoreActions = {
  // 単発タスク操作
  addAdHocTask: (task: CreateAdHocTaskInput) => void;
  updateAdHocTask: (id: string, updates: Partial<AdHocTask>) => void;
  deleteAdHocTask: (id: string) => void;
  toggleAdHocTask: (id: string) => void;

  // 定期タスク定義操作
  addRecurringTask: (task: CreateRecurringTaskInput) => void;
  updateRecurringTask: (id: string, updates: Partial<RecurringTask>) => void;
  deleteRecurringTask: (id: string) => void;
  toggleRecurringTaskActive: (id: string) => void;

  // 完了記録操作 (定期タスクの実行記録)
  addCompletionRecord: (taskId: string, targetDate: string) => void;
  removeCompletionRecord: (taskId: string, targetDate: string) => void;
  toggleCompletionRecord: (taskId: string, targetDate: string) => void;
};

const initialCategories = [
  { id: '1', name: '営業', color: 'bg-blue-100 text-blue-800' },
  { id: '2', name: '制作', color: 'bg-green-100 text-green-800' },
  { id: '3', name: '管理', color: 'bg-yellow-100 text-yellow-800' },
  { id: '4', name: 'DX', color: 'bg-purple-100 text-purple-800' },
  { id: '5', name: 'その他', color: 'bg-gray-100 text-gray-800' },
];

export const useStore = create<AppState & StoreActions>()(
  persist(
    (set, get) => ({
      categories: initialCategories,
      recurringTasks: [],
      adHocTasks: [],
      completionRecords: [],

      // --- 単発タスク ---
      addAdHocTask: (input) => set((state) => ({
        adHocTasks: [
          ...state.adHocTasks,
          {
            ...input,
            id: crypto.randomUUID(),
            isCompleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        ]
      })),
      
      updateAdHocTask: (id, updates) => set((state) => ({
        adHocTasks: state.adHocTasks.map((t) =>
          t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
        ),
      })),

      deleteAdHocTask: (id) => set((state) => ({
        adHocTasks: state.adHocTasks.filter((t) => t.id !== id),
      })),

      toggleAdHocTask: (id) => set((state) => ({
        adHocTasks: state.adHocTasks.map((t) =>
          t.id === id ? { ...t, isCompleted: !t.isCompleted, updatedAt: new Date().toISOString() } : t
        ),
      })),

      // --- 定期タスク ---
      addRecurringTask: (input) => set((state) => ({
        recurringTasks: [
          ...state.recurringTasks,
          {
            ...input,
            id: crypto.randomUUID(),
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        ]
      })),

      updateRecurringTask: (id, updates) => set((state) => ({
        recurringTasks: state.recurringTasks.map((t) =>
          t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
        ),
      })),

      deleteRecurringTask: (id) => set((state) => ({
        recurringTasks: state.recurringTasks.filter((t) => t.id !== id),
        // 関連する記録も消すかは仕様次第ですが、一旦残す方針
      })),

      toggleRecurringTaskActive: (id) => set((state) => ({
        recurringTasks: state.recurringTasks.map((t) =>
          t.id === id ? { ...t, isActive: !t.isActive, updatedAt: new Date().toISOString() } : t
        ),
      })),

      // --- 完了記録 ---
      addCompletionRecord: (taskId, targetDate) => set((state) => ({
        completionRecords: [
          ...state.completionRecords,
          {
            id: crypto.randomUUID(),
            taskId,
            targetDate,
            completedAt: new Date().toISOString(),
          }
        ]
      })),

      removeCompletionRecord: (taskId, targetDate) => set((state) => ({
        completionRecords: state.completionRecords.filter(
          (r) => !(r.taskId === taskId && r.targetDate === targetDate)
        ),
      })),

      toggleCompletionRecord: (taskId, targetDate) => {
        const { completionRecords, addCompletionRecord, removeCompletionRecord } = get();
        const exists = completionRecords.some(r => r.taskId === taskId && r.targetDate === targetDate);
        
        if (exists) {
          removeCompletionRecord(taskId, targetDate);
        } else {
          addCompletionRecord(taskId, targetDate);
        }
      }

    }),
    {
      name: 'todo-app-storage', // localStorage state key
      // ※将来的にはここをDBレイヤー同期に繋ぎ替えることが可能
    }
  )
);
