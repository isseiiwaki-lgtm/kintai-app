import { format, isLastDayOfMonth, isSameDay, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { RecurringTask } from '@/types';

// 日本時間に合わせた今日の日付文字列 (YYYY-MM-DD) を取得する
export const getTodayString = (): string => {
  const now = new Date();
  const jstTime = toZonedTime(now, 'Asia/Tokyo');
  return format(jstTime, 'yyyy-MM-dd');
};

// 指定された日付(YYYY-MM-DD)が、定期タスクの繰り返しルールに合致するか判定する
export const isTaskDueToday = (task: RecurringTask, targetDateStr: string): boolean => {
  if (!task.isActive) return false;

  const targetDate = parseISO(targetDateStr);
  const { rule } = task;

  switch (rule.type) {
    case 'daily':
      return true;

    case 'weekly':
      // 0: 日曜日 - 6: 土曜日
      return targetDate.getDay() === rule.dayOfWeek;

    case 'monthly':
      if (rule.monthlyType === 'start') {
        return targetDate.getDate() === 1;
      }
      
      if (rule.monthlyType === 'end') {
        return isLastDayOfMonth(targetDate);
      }
      
      if (rule.monthlyType === 'specific') {
        // もし指定日が存在しない月（例：2月30日）の場合は、その月の末日を該当日とする運用も考えられますが、
        // 今回はシンプルに日付けが一致するかだけを判定します。
        // ※必要に応じて「月末補正」ロジックを追加可能です。
        const targetDay = targetDate.getDate();
        const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
        
        // もし指定した日付がその月の末日より大きい場合（例: 31日指定で2月の場合）、
        // その月の末日を該当日として扱う
        if (rule.dayOfMonth! > lastDay) {
            return targetDay === lastDay;
        }

        return targetDay === rule.dayOfMonth;
      }
      return false;

    default:
      return false;
  }
};
