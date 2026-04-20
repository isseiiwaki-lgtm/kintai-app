'use client';

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { PlusCircle } from 'lucide-react';

import { useStore, CreateAdHocTaskInput } from '@/store/useStore';
import { useHydration } from '@/hooks/useHydration';
import { getTodayString, isTaskDueToday } from '@/lib/taskUtils';

import { TaskItem } from '@/components/TaskItem';
import { TaskForm } from '@/components/TaskForm';
import { Button } from '@/components/ui/Button';

export default function HomePage() {
  const isHydrated = useHydration();
  
  const categories = useStore(state => state.categories);
  const adHocTasks = useStore(state => state.adHocTasks);
  const recurringTasks = useStore(state => state.recurringTasks);
  const completionRecords = useStore(state => state.completionRecords);
  
  const addAdHocTask = useStore(state => state.addAdHocTask);
  const updateAdHocTask = useStore(state => state.updateAdHocTask);
  const deleteAdHocTask = useStore(state => state.deleteAdHocTask);
  const toggleAdHocTask = useStore(state => state.toggleAdHocTask);
  const toggleCompletionRecord = useStore(state => state.toggleCompletionRecord);

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const todayStr = useMemo(() => getTodayString(), []);
  const todayFormatted = format(new Date(), 'yyyy年 M月 d日 (E)', { locale: ja });

  // 該当するタスクを計算
  const todaysAdHocTasks = adHocTasks.filter(t => t.targetDate === todayStr);
  const todaysRecurringTasks = recurringTasks.filter(t => isTaskDueToday(t, todayStr));

  // 完了状態のプログレス計算
  const completedAdHocs = todaysAdHocTasks.filter(t => t.isCompleted).length;
  const completedRecurrings = todaysRecurringTasks.filter(t => 
    completionRecords.some(r => r.taskId === t.id && r.targetDate === todayStr)
  ).length;

  const totalTasks = todaysAdHocTasks.length + todaysRecurringTasks.length;
  const totalCompleted = completedAdHocs + completedRecurrings;
  const progressPercent = totalTasks === 0 ? 0 : Math.round((totalCompleted / totalTasks) * 100);

  if (!isHydrated) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">今日のタスク</h1>
        <p className="text-sm font-medium text-gray-500 mt-1">{todayFormatted}</p>
      </header>

      {/* プログレスバー */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-bold text-gray-700">進捗状況</span>
          <span className="text-sm font-bold text-blue-600">
            {totalCompleted} / {totalTasks}
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div 
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* タスク一覧 */}
      <div className="space-y-4">
        {totalTasks === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500">今日のタスクはありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 定期タスクループ */}
            {todaysRecurringTasks.map(task => {
              const isCompleted = completionRecords.some(r => r.taskId === task.id && r.targetDate === todayStr);
              return (
                <TaskItem
                  key={task.id}
                  task={task}
                  isRecurring
                  category={categories.find(c => c.id === task.categoryId)}
                  isCompleted={isCompleted}
                  onToggleComplete={() => toggleCompletionRecord(task.id, todayStr)}
                />
              );
            })}

            {/* 単発タスクループ */}
            {todaysAdHocTasks.map(task => {
              if (editingTaskId === task.id) {
                return (
                  <TaskForm
                    key={task.id}
                    initialData={task}
                    onSubmit={(data) => {
                      updateAdHocTask(task.id, data);
                      setEditingTaskId(null);
                    }}
                    onCancel={() => setEditingTaskId(null)}
                  />
                );
              }

              return (
                <TaskItem
                  key={task.id}
                  task={task}
                  category={categories.find(c => c.id === task.categoryId)}
                  isCompleted={task.isCompleted}
                  onToggleComplete={() => toggleAdHocTask(task.id)}
                  onEdit={() => setEditingTaskId(task.id)}
                  onDelete={() => deleteAdHocTask(task.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 新規タスク追加 */}
      <div className="pt-4">
        {isAddingTask ? (
          <TaskForm
            onSubmit={(data) => {
              const newTask: CreateAdHocTaskInput = {
                ...data,
                targetDate: todayStr,
              };
              addAdHocTask(newTask);
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
            今日の単発タスクを追加
          </Button>
        )}
      </div>

    </div>
  );
}
