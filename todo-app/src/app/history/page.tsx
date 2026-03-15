'use client';

import React, { useState, useMemo } from 'react';
import { Clock3, Filter } from 'lucide-react';
import { format, parseISO, compareDesc } from 'date-fns';
import { ja } from 'date-fns/locale';

import { useStore } from '@/store/useStore';
import { useHydration } from '@/hooks/useHydration';
import { Badge } from '@/components/ui/Badge';

export default function HistoryPage() {
  const isHydrated = useHydration();
  
  const categories = useStore(state => state.categories);
  const adHocTasks = useStore(state => state.adHocTasks);
  const recurringTasks = useStore(state => state.recurringTasks);
  const completionRecords = useStore(state => state.completionRecords);

  const [filterType, setFilterType] = useState<'all' | 'adhoc' | 'recurring'>('all');

  // 単発タスクの完了済みリスト
  const completedAdHocList = useMemo(() => {
    return adHocTasks
      .filter(t => t.isCompleted)
      .map(t => ({
        id: t.id,
        title: t.title,
        type: 'adhoc' as const,
        date: parseISO(t.targetDate),
        categoryId: t.categoryId,
        description: '単発タスク',
        completedAtStr: t.updatedAt // 完了日時としてupdatedAtを代用
      }));
  }, [adHocTasks]);

  // 定期タスクの完了済みリスト
  const completedRecurringList = useMemo(() => {
    return completionRecords.map(record => {
      const task = recurringTasks.find(rt => rt.id === record.taskId);
      return {
        id: record.id,
        title: task ? task.title : '(削除されたタスク)',
        type: 'recurring' as const,
        date: parseISO(record.targetDate),
        categoryId: task?.categoryId,
        description: '定期タスク',
        completedAtStr: record.completedAt
      };
    });
  }, [completionRecords, recurringTasks]);

  // マージしてソート
  const historyList = useMemo(() => {
    const combined = [...completedAdHocList, ...completedRecurringList];
    
    // フィルター適用
    const filtered = combined.filter(item => {
      if (filterType === 'all') return true;
      return item.type === filterType;
    });

    // 完了日時の降順
    return filtered.sort((a, b) => compareDesc(parseISO(a.completedAtStr), parseISO(b.completedAtStr)));
  }, [completedAdHocList, completedRecurringList, filterType]);

  if (!isHydrated) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock3 className="h-6 w-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">履歴確認</h1>
        </div>
        
        {/* フィルターUI設定 */}
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <select 
            className="text-sm border-gray-300 rounded-md focus:ring-blue-500 py-1"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="all">すべて</option>
            <option value="adhoc">単発タスクのみ</option>
            <option value="recurring">定期タスクのみ</option>
          </select>
        </div>
      </header>

      <div className="space-y-4">
        {historyList.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500">完了したタスクの履歴はありません</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <ul className="divide-y divide-gray-100">
              {historyList.map(item => {
                const category = categories.find(c => c.id === item.categoryId);
                return (
                  <li key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">完了</span>
                        <h3 className="font-medium text-gray-900 line-through decoration-gray-300">{item.title}</h3>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {format(parseISO(item.completedAtStr), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {item.description}
                      </Badge>
                      {category && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${category.color.replace('bg-', 'bg-opacity-20 bg-')}`}>
                          {category.name}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 ml-auto">
                        対象日: {format(item.date, 'MM/dd')}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

    </div>
  );
}
