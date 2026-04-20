import React, { useState, useEffect } from 'react';
import { Priority, AdHocTask, RecurringTask, Category } from '@/types';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { useStore } from '@/store/useStore';

interface TaskFormProps {
  initialData?: Partial<AdHocTask | RecurringTask>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isRecurring?: boolean;
}

export function TaskForm({ initialData, onSubmit, onCancel, isRecurring = false }: TaskFormProps) {
  const categories = useStore(state => state.categories);

  const [title, setTitle] = useState(initialData?.title || '');
  const [priority, setPriority] = useState<Priority>((initialData?.priority as Priority) || 'medium');
  const [categoryId, setCategoryId] = useState(initialData?.categoryId || categories[0]?.id || '');
  const [memo, setMemo] = useState(initialData?.memo || '');

  // 定期タスク用の追加フィールド
  const [recurringType, setRecurringType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [monthlyType, setMonthlyType] = useState<'start' | 'end' | 'specific'>('start');
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);

  useEffect(() => {
    if (initialData && isRecurring) {
      const rt = initialData as Partial<RecurringTask>;
      if (rt.rule) {
        setRecurringType(rt.rule.type);
        if (rt.rule.dayOfWeek !== undefined) setDayOfWeek(rt.rule.dayOfWeek);
        if (rt.rule.monthlyType) setMonthlyType(rt.rule.monthlyType);
        if (rt.rule.dayOfMonth !== undefined) setDayOfMonth(rt.rule.dayOfMonth);
      }
    }
  }, [initialData, isRecurring]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isRecurring) {
      onSubmit({
        title,
        priority,
        categoryId,
        memo,
        rule: {
          type: recurringType,
          dayOfWeek: recurringType === 'weekly' ? dayOfWeek : undefined,
          monthlyType: recurringType === 'monthly' ? monthlyType : undefined,
          dayOfMonth: recurringType === 'monthly' && monthlyType === 'specific' ? dayOfMonth : undefined,
        }
      });
    } else {
      onSubmit({
        title,
        priority,
        categoryId,
        memo,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-4 rounded-xl border border-gray-200">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          タスク名 <span className="text-red-500">*</span>
        </label>
        <Input 
          value={title} 
          onChange={(e) => setTitle(e.target.value)} 
          placeholder="例：週次ミーティング資料作成"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">優先度</label>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </Select>
        </div>
      </div>

      {isRecurring && (
        <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
          <h4 className="text-sm font-semibold text-gray-800">繰り返しルールの設定</h4>
          
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">頻度</label>
            <Select 
              value={recurringType} 
              onChange={(e) => setRecurringType(e.target.value as any)}
            >
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </Select>
          </div>

          {recurringType === 'weekly' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">曜日</label>
              <Select 
                value={dayOfWeek} 
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                <option value={0}>日曜日</option>
                <option value={1}>月曜日</option>
                <option value={2}>火曜日</option>
                <option value={3}>水曜日</option>
                <option value={4}>木曜日</option>
                <option value={5}>金曜日</option>
                <option value={6}>土曜日</option>
              </Select>
            </div>
          )}

          {recurringType === 'monthly' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">タイミング</label>
                <Select 
                  value={monthlyType} 
                  onChange={(e) => setMonthlyType(e.target.value as any)}
                >
                  <option value="start">月初（1日）</option>
                  <option value="end">月末（最終日）</option>
                  <option value="specific">日付指定</option>
                </Select>
              </div>
              
              {monthlyType === 'specific' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">日付指定 (1〜31)</label>
                  <Input 
                    type="number" 
                    min={1} 
                    max={31} 
                    value={dayOfMonth} 
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">※31日を設定して該当月が30日までしかない場合、30日に実行とみなされます</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
        <textarea
          className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="タスクの詳細や備考があれば入力..."
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" variant="primary">
          保存する
        </Button>
      </div>
    </form>
  );
}
