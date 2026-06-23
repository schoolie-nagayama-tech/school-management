'use client';

import { useState, useEffect } from 'react';
import { RELEASE_NOTES } from '@/lib/data/releaseNotes';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';

const LAST_SEEN_KEY = 'updatesBoard_lastSeenDate';

function getLastSeenDate(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LAST_SEEN_KEY);
}

function setLastSeenDate(date: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_SEEN_KEY, date);
}

interface UpdatesBoardProps {
  className?: string;
}

export function UpdatesBoard({ className = '' }: UpdatesBoardProps) {
  const [isExpanded, setIsExpanded] = useState(false); // デフォルト：クローズ
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLastSeen(getLastSeenDate());
    setMounted(true);
  }, []);

  // 最新3件を表示
  const recentNotes = RELEASE_NOTES.slice(0, 3);

  if (recentNotes.length === 0) return null;

  const latestDate = recentNotes[0]?.date ?? '';
  const hasUnread = mounted && (!lastSeen || lastSeen < latestDate);

  const handleMarkRead = () => {
    setLastSeenDate(latestDate);
    setLastSeen(latestDate);
  };

  return (
    <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between p-4 bg-[#e8f5e9] border-b border-[#c8e6c9] cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#1a1a1a]">アップデート情報</span>
          {hasUnread && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-green-600 text-white rounded-full">
              NEW
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasUnread && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMarkRead();
              }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-green-100 transition-colors duration-150"
              title="確認済みにする"
            >
              <Check className="w-3.5 h-3.5" />
              確認済み
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* コンテンツ */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {recentNotes.map((note) => (
            <div key={note.version}>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded">
                  {note.version}
                </span>
                <span className="text-xs text-gray-500">{note.date}</span>
                <span className="text-sm font-medium text-[#1a1a1a]">{note.title}</span>
              </div>
              <ul className="space-y-1 ml-1">
                {note.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-green-500 mt-0.5 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
