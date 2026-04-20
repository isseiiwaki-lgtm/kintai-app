'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { CheckSquare, CalendarDays, Clock3 } from 'lucide-react';

export function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: '今日のタスク', icon: CheckSquare },
    { href: '/recurring', label: '定期タスク設定', icon: CalendarDays },
    { href: '/history', label: '履歴確認', icon: Clock3 },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto max-w-4xl px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 text-white p-1.5 rounded-md">
            <CheckSquare size={20} />
          </div>
          <span className="font-bold text-lg tracking-tight text-gray-900">ToDo App</span>
        </div>

        {/* 画面幅が広い場合のナビゲーション */}
        <nav className="hidden md:flex items-center gap-1">
          {links.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <Icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* モバイル向け下部ナビゲーション (画面幅が狭い場合) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex justify-around p-2 pb-safe">
        {links.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'flex flex-col items-center justify-center p-2 rounded-md gap-1 min-w-[5rem]',
                isActive ? 'text-blue-600' : 'text-gray-500'
              )}
            >
              <div
                className={cn(
                  'p-1 rounded-full transition-colors',
                  isActive ? 'bg-blue-100' : 'transparent'
                )}
              >
                <Icon size={20} />
              </div>
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
