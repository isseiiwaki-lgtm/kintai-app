import React from 'react';
import { AdHocTask, RecurringTask, Category } from '@/types';
import { Card, CardContent } from './ui/Card';
import { Checkbox } from './ui/Checkbox';
import { Badge } from './ui/Badge';
import { cn } from '@/lib/utils';
import { Edit2, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';

interface TaskItemProps {
  task: AdHocTask | RecurringTask;
  category?: Category;
  isCompleted: boolean;
  onToggleComplete: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isRecurring?: boolean;
}

export function TaskItem({
  task,
  category,
  isCompleted,
  onToggleComplete,
  onEdit,
  onDelete,
  isRecurring = false,
}: TaskItemProps) {
  return (
    <Card className={cn("transition-all", isCompleted ? "opacity-60 bg-gray-50" : "")}>
      <CardContent className="p-4 flex items-start gap-4">
        {/* チェックボックスエリア */}
        <div className="pt-1">
          <Checkbox 
            checked={isCompleted} 
            onCheckedChange={onToggleComplete}
            aria-label={`${task.title}を完了にする`}
          />
        </div>

        {/* コンテンツエリア */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className={cn(
                "text-base font-medium truncate",
                isCompleted ? "line-through text-gray-500" : "text-gray-900"
              )}>
                {task.title}
              </h3>
              
              {/* バッジ（カテゴリ・優先度・定期ラベル） */}
              <div className="flex flex-wrap gap-2 mt-2">
                {isRecurring && (
                  <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50">
                    定期
                  </Badge>
                )}
                {task.priority === 'high' && <Badge variant="danger">高</Badge>}
                {task.priority === 'medium' && <Badge variant="secondary">中</Badge>}
                {task.priority === 'low' && <Badge variant="outline">低</Badge>}
                
                {category && (
                  <Badge className={category.color}>{category.name}</Badge>
                )}
              </div>
            </div>

            {/* アクションボタン (編集/削除) */}
            <div className="flex shrink-0 gap-1">
              {onEdit && (
                <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8 text-gray-500">
                  <Edit2 size={16} />
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50">
                  <Trash2 size={16} />
                </Button>
              )}
            </div>
          </div>

          {/* メモ */}
          {task.memo && (
            <p className="mt-2 text-sm text-gray-500 line-clamp-2">
              {task.memo}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
