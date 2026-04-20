'use client';

import React, { useState } from 'react';
import { PlusCircle, Calendar } from 'lucide-react';
import { useStore, CreateRecurringTaskInput } from '@/store/useStore';
import { useHydration } from '@/hooks/useHydration';
import { TaskItem } from '@/components/TaskItem';
import { TaskForm } from '@/components/TaskForm';
import { Button } from '@/components/ui/Button';

export default function RecurringPage() {
  const isHydrated = useHydration();
  
  const categories = useStore(state => state.categories);
  const recurringTasks = useStore(state => state.recurringTasks);
  const addRecurringTask = useStore(state => state.addRecurringTask);
  const updateRecurringTask = useStore(state => state.updateRecurringTask);
  const deleteRecurringTask = useStore(state => state.deleteRecurringTask);
  const toggleRecurringTaskActive = useStore(state => state.toggleRecurringTaskActive);

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  if (!isHydrated) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="mb-4 flex items-center gap-2">
        <Calendar className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">定期タスク設定</h1>
      </header>

      <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-100">
        毎日、毎週、毎月など、定期的に発生する業務を登録します。ここで登録されたタスクは、該当日になると「今日のタスク」に自動的に表示されます。
      </p>

      {/* タスク一覧 */}
      <div className="space-y-4">
        {recurringTasks.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500">定期タスクはまだ登録されていません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recurringTasks.map(task => {
              if (editingTaskId === task.id) {
                return (
                  <TaskForm
                    key={task.id}
                    initialData={task}
                    isRecurring
                    onSubmit={(data) => {
                      updateRecurringTask(task.id, data);
                      setEditingTaskId(null);
                    }}
                    onCancel={() => setEditingTaskId(null)}
                  />
                );
              }

              return (
                <div key={task.id} className="relative">
                  <TaskItem
                    task={task}
                    isRecurring
                    category={categories.find(c => c.id === task.categoryId)}
                    // isCompletedは「有効/無効」として流用（チェックボックスをトグルとして使う）
                    isCompleted={!task.isActive} 
                    onToggleComplete={() => toggleRecurringTaskActive(task.id)}
                    onEdit={() => setEditingTaskId(task.id)}
                    onDelete={() => deleteRecurringTask(task.id)}
                  />
                  {/* 無効状態のオーバーレイ表現 */}
                  {!task.isActive && (
                    <div className="absolute top-2 right-12 bg-gray-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm opacity-90 pointer-events-none">
                      休止中
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新規タスク追加 */}
      <div className="pt-4">
        {isAddingTask ? (
          <TaskForm
            isRecurring
            onSubmit={(data) => {
              const newTask: CreateRecurringTaskInput = data;
              addRecurringTask(newTask);
              setIsAddingTask(false);
            }}
            onCancel={() => setIsAddingTask(false)}
          />
        ) : (
          <Button 
            variant="outline" 
            className="w-full py-6 border-dashed border-2 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 text-gray-500"
            onClick={() => setIsAddingTask(true)}
          >
            <PlusCircle className="mr-2 h-5 w-5" />
            新しい定期タスクを追加
          </Button>
        )}
      </div>
    </div>
  );
}
