'use client';

import { useState } from 'react';
import { AdminLayout } from '@/components/layouts';

// =============== モックデータ ===============
const GROUPS = [
  { key: '基本', label: '基本情報', color: '#6b7280' },
  { key: '面談', label: '面談関連', color: '#3b82f6' },
  { key: '増コマ', label: '増コマ関連', color: '#f59e0b' },
  { key: '事務', label: '事務処理', color: '#10b981' },
  { key: '教科別', label: '教科別コマ', color: '#8b5cf6' },
];

const ITEMS = [
  {
    id: '1',
    name: '通常週回数',
    group: '基本',
    type: 'number' as const,
    deadline: null,
    auto: true,
  },
  {
    id: '2',
    name: '講習期間通常回数',
    group: '基本',
    type: 'number' as const,
    deadline: null,
    auto: true,
  },
  { id: '3', name: '面談日程連絡', group: '面談', type: 'check' as const, deadline: '3/10' },
  { id: '4', name: '面談実施', group: '面談', type: 'check' as const, deadline: '3/20' },
  { id: '5', name: '方針確認', group: '面談', type: 'check' as const, deadline: '3/20' },
  { id: '6', name: '提案書作成', group: '面談', type: 'check' as const, deadline: '3/15' },
  { id: '7', name: '面談記録', group: '面談', type: 'check' as const, deadline: '3/25' },
  { id: '8', name: '提示増コマ回数', group: '増コマ', type: 'number' as const, deadline: null },
  { id: '9', name: '増コマ回数決定', group: '増コマ', type: 'number' as const, deadline: null },
  { id: '10', name: '増コマ確認書', group: '増コマ', type: 'check' as const, deadline: '3/28' },
  { id: '11', name: '請求データ', group: '事務', type: 'check' as const, deadline: '3/30' },
  { id: '12', name: 'シフト作成', group: '事務', type: 'check' as const, deadline: '3/25' },
  { id: '13', name: '教材準備', group: '事務', type: 'check' as const, deadline: '3/28' },
  { id: '14', name: '英語', group: '教科別', type: 'number' as const, deadline: null },
  { id: '15', name: '数学', group: '教科別', type: 'number' as const, deadline: null },
  { id: '16', name: '国語', group: '教科別', type: 'number' as const, deadline: null },
  { id: '17', name: '理科', group: '教科別', type: 'number' as const, deadline: null },
  { id: '18', name: '社会', group: '教科別', type: 'number' as const, deadline: null },
];

const STUDENTS = [
  { id: 's1', name: '田中 太郎', grade: '中3' },
  { id: 's2', name: '佐藤 花子', grade: '中3' },
  { id: 's3', name: '鈴木 一郎', grade: '中2' },
  { id: 's4', name: '高橋 美咲', grade: '中2' },
  { id: 's5', name: '伊藤 健太', grade: '中1' },
  { id: 's6', name: '渡辺 あい', grade: '中1' },
  { id: 's7', name: '山本 翔', grade: '小6' },
  { id: 's8', name: '中村 さくら', grade: '小5' },
];

const mockStatuses: Record<string, 'completed' | 'pending' | null> = {
  's1:3': 'completed',
  's1:4': 'completed',
  's1:5': 'completed',
  's1:6': 'completed',
  's1:7': 'completed',
  's1:10': 'completed',
  's1:11': 'completed',
  's1:12': 'completed',
  's1:13': 'completed',
  's2:3': 'completed',
  's2:4': 'completed',
  's2:5': 'pending',
  's2:6': 'completed',
  's2:7': null,
  's2:10': null,
  's2:11': 'completed',
  's2:12': null,
  's2:13': null,
  's3:3': 'completed',
  's3:4': 'pending',
  's3:5': null,
  's3:6': null,
  's3:7': null,
  's3:10': null,
  's3:11': null,
  's3:12': null,
  's3:13': null,
  's4:3': 'completed',
  's4:4': 'completed',
  's4:5': 'completed',
  's4:6': 'pending',
  's4:7': null,
  's4:10': null,
  's4:11': null,
  's4:12': null,
  's4:13': null,
  's5:3': 'completed',
  's5:4': null,
  's5:5': null,
  's5:6': null,
  's5:7': null,
  's5:10': null,
  's5:11': null,
  's5:12': null,
  's5:13': null,
  's6:3': null,
  's6:4': null,
  's6:5': null,
  's6:6': null,
  's6:7': null,
  's6:10': null,
  's6:11': null,
  's6:12': null,
  's6:13': null,
  's7:3': 'completed',
  's7:4': 'completed',
  's7:5': 'completed',
  's7:6': 'completed',
  's7:7': 'pending',
  's7:10': 'completed',
  's7:11': 'completed',
  's7:12': 'pending',
  's7:13': null,
  's8:3': 'completed',
  's8:4': 'completed',
  's8:5': 'completed',
  's8:6': 'completed',
  's8:7': 'completed',
  's8:10': 'completed',
  's8:11': 'completed',
  's8:12': 'completed',
  's8:13': 'completed',
};

const mockNumbers: Record<string, number> = {
  's1:1': 3,
  's1:2': 12,
  's1:8': 4,
  's1:9': 3,
  's1:14': 2,
  's1:15': 3,
  's1:16': 1,
  's1:17': 2,
  's1:18': 1,
  's2:1': 2,
  's2:2': 8,
  's2:8': 3,
  's2:9': 2,
  's2:14': 1,
  's2:15': 2,
  's2:16': 1,
  's2:17': 1,
  's2:18': 1,
  's3:1': 2,
  's3:2': 8,
  's3:8': 2,
  's3:9': 0,
  's3:14': 1,
  's3:15': 1,
  's3:16': 0,
  's3:17': 1,
  's3:18': 0,
  's4:1': 3,
  's4:2': 12,
  's4:8': 3,
  's4:9': 2,
  's4:14': 2,
  's4:15': 2,
  's4:16': 1,
  's4:17': 1,
  's4:18': 1,
  's5:1': 2,
  's5:2': 8,
  's5:8': 1,
  's5:9': 0,
  's5:14': 1,
  's5:15': 1,
  's5:16': 0,
  's5:17': 0,
  's5:18': 0,
  's6:1': 1,
  's6:2': 4,
  's6:8': 0,
  's6:9': 0,
  's6:14': 1,
  's6:15': 1,
  's6:16': 0,
  's6:17': 0,
  's6:18': 0,
  's7:1': 2,
  's7:2': 8,
  's7:8': 2,
  's7:9': 2,
  's7:14': 1,
  's7:15': 2,
  's7:16': 0,
  's7:17': 1,
  's7:18': 0,
  's8:1': 2,
  's8:2': 8,
  's8:8': 2,
  's8:9': 2,
  's8:14': 1,
  's8:15': 1,
  's8:16': 1,
  's8:17': 1,
  's8:18': 0,
};

type PatternType = 'A' | 'C' | 'D' | 'E';

function getStudentProgress(sid: string) {
  const checkItems = ITEMS.filter((i) => i.type === 'check');
  const completed = checkItems.filter((i) => mockStatuses[`${sid}:${i.id}`] === 'completed').length;
  return {
    completed,
    total: checkItems.length,
    pct: checkItems.length > 0 ? Math.round((completed / checkItems.length) * 100) : 0,
  };
}

function getStudentGroupProgress(sid: string, groupKey: string) {
  const gCheckItems = ITEMS.filter((i) => i.group === groupKey && i.type === 'check');
  if (gCheckItems.length === 0) return null;
  const completed = gCheckItems.filter(
    (i) => mockStatuses[`${sid}:${i.id}`] === 'completed'
  ).length;
  return {
    completed,
    total: gCheckItems.length,
    pct: Math.round((completed / gCheckItems.length) * 100),
  };
}

function StatusIcon({ status }: { status: 'completed' | 'pending' | null | undefined }) {
  if (status === 'completed') return <span className="text-green-600 font-bold">✓</span>;
  if (status === 'pending') return <span className="text-yellow-600 font-bold">×</span>;
  return <span className="text-gray-200">-</span>;
}

function StatusCell({ status }: { status: 'completed' | 'pending' | null | undefined }) {
  const bg = status === 'completed' ? 'bg-green-50' : status === 'pending' ? 'bg-yellow-50' : '';
  return (
    <td
      className={`border border-gray-100 px-1.5 py-1.5 text-center text-xs cursor-pointer hover:bg-blue-50 ${bg}`}
    >
      <StatusIcon status={status} />
    </td>
  );
}

function ProgressBar({
  pct,
  color,
  size = 'sm',
}: {
  pct: number;
  color?: string;
  size?: 'sm' | 'md';
}) {
  const c = color || (pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444');
  return (
    <div className={`bg-gray-100 rounded-full overflow-hidden ${size === 'md' ? 'h-2' : 'h-1.5'}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: c }}
      />
    </div>
  );
}

// ======================================================================
// パターンA: グループタブ切り替え式（前回から継続）
// ======================================================================
function PatternA() {
  const [activeGroup, setActiveGroup] = useState('面談');
  const groupItems = ITEMS.filter((i) => i.group === activeGroup);
  const activeGroupDef = GROUPS.find((g) => g.key === activeGroup)!;

  return (
    <div className="space-y-3">
      {/* タブ */}
      <div className="flex gap-1 border-b border-gray-200">
        {GROUPS.map((g) => {
          const gCheckItems = ITEMS.filter((i) => i.group === g.key && i.type === 'check');
          const doneAll = gCheckItems.reduce(
            (sum, item) =>
              sum +
              STUDENTS.filter((s) => mockStatuses[`${s.id}:${item.id}`] === 'completed').length,
            0
          );
          const totalAll = gCheckItems.length * STUDENTS.length;
          const pct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : -1;
          return (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors relative ${
                activeGroup === g.key
                  ? 'text-white -mb-px'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              style={activeGroup === g.key ? { backgroundColor: g.color } : {}}
            >
              {g.label}
              {pct >= 0 && (
                <span
                  className={`ml-1.5 text-[9px] px-1 rounded ${activeGroup === g.key ? 'bg-white/30' : 'bg-gray-100'}`}
                >
                  {pct}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* テーブル */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-2 py-2 text-left w-12 text-gray-500">
                学年
              </th>
              <th className="border border-gray-200 px-2 py-2 text-left w-24 text-gray-600 font-medium">
                生徒名
              </th>
              {groupItems.map((item) => (
                <th
                  key={item.id}
                  className="border border-gray-200 px-2 py-2 text-center font-medium min-w-[60px]"
                  style={{ color: activeGroupDef.color }}
                >
                  <div className="text-[10px]">{item.name}</div>
                  {item.deadline && (
                    <div className="text-[9px] text-orange-400 mt-0.5">{item.deadline}</div>
                  )}
                  {item.auto && <div className="text-[9px] text-blue-400 mt-0.5">自動</div>}
                </th>
              ))}
              <th className="border border-gray-200 px-2 py-2 text-center w-16 text-gray-500">
                全体
              </th>
            </tr>
          </thead>
          <tbody>
            {STUDENTS.map((s, si) => {
              const prog = getStudentProgress(s.id);
              return (
                <tr key={s.id} className={si % 2 ? 'bg-gray-50/40' : ''}>
                  <td className="border border-gray-100 px-2 py-1.5 text-[10px] text-gray-400">
                    {s.grade}
                  </td>
                  <td className="border border-gray-100 px-2 py-1.5 text-xs font-medium text-[#1e3a5f]">
                    {s.name}
                  </td>
                  {groupItems.map((item) =>
                    item.type === 'number' ? (
                      <td
                        key={item.id}
                        className={`border border-gray-100 px-1.5 py-1.5 text-center text-xs ${item.auto ? 'bg-blue-50/50' : ''}`}
                      >
                        <span className="font-medium text-[#1e3a5f]">
                          {mockNumbers[`${s.id}:${item.id}`] ?? '-'}
                        </span>
                      </td>
                    ) : (
                      <StatusCell key={item.id} status={mockStatuses[`${s.id}:${item.id}`]} />
                    )
                  )}
                  <td className="border border-gray-100 px-1.5 py-1.5 text-center">
                    <div className="flex items-center gap-1 justify-center">
                      <div className="w-10">
                        <ProgressBar pct={prog.pct} />
                      </div>
                      <span className="text-[9px] text-gray-400">{prog.pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ======================================================================
// パターンC: グループ別セクション（前回から継続）
// ======================================================================
function PatternC() {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {GROUPS.map((g) => {
        const gItems = ITEMS.filter((i) => i.group === g.key);
        const isCollapsed = collapsedGroups.has(g.key);
        const checkItems = gItems.filter((i) => i.type === 'check');
        const totalChecks = checkItems.length * STUDENTS.length;
        const doneChecks = checkItems.reduce(
          (sum, item) =>
            sum + STUDENTS.filter((s) => mockStatuses[`${s.id}:${item.id}`] === 'completed').length,
          0
        );
        const pct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

        return (
          <div
            key={g.key}
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: g.color + '40' }}
          >
            <button
              onClick={() => toggleGroup(g.key)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:brightness-95 transition-all"
              style={{ backgroundColor: g.color + '10' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-[9px] text-gray-400"
                  style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}
                >
                  ▼
                </span>
                <span className="w-2 h-5 rounded-full" style={{ backgroundColor: g.color }} />
                <span className="text-sm font-bold" style={{ color: g.color }}>
                  {g.label}
                </span>
                <span className="text-[10px] text-gray-400">{gItems.length}項目</span>
              </div>
              {checkItems.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-20">
                    <ProgressBar pct={pct} color={g.color} size="md" />
                  </div>
                  <span className="text-[10px] font-medium" style={{ color: g.color }}>
                    {pct}%
                  </span>
                </div>
              )}
            </button>
            {!isCollapsed && (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border-t border-r border-gray-200 px-2 py-2 text-left w-12 text-gray-400 text-[10px]">
                      学年
                    </th>
                    <th className="border-t border-r border-gray-200 px-2 py-2 text-left w-28 text-gray-600 text-xs font-medium">
                      生徒名
                    </th>
                    {gItems.map((item) => (
                      <th
                        key={item.id}
                        className="border-t border-r border-gray-200 px-2 py-2 text-center min-w-[64px]"
                      >
                        <div className="text-[10px] font-medium" style={{ color: g.color }}>
                          {item.name}
                        </div>
                        {item.deadline && (
                          <div className="text-[9px] text-orange-400 mt-0.5">{item.deadline}</div>
                        )}
                        {item.auto && <div className="text-[9px] text-blue-400 mt-0.5">自動</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STUDENTS.map((s, si) => (
                    <tr key={s.id} className={si % 2 ? 'bg-gray-50/40' : ''}>
                      <td className="border-t border-r border-gray-100 px-2 py-1.5 text-[10px] text-gray-400">
                        {s.grade}
                      </td>
                      <td className="border-t border-r border-gray-100 px-2 py-1.5 text-xs font-medium text-[#1e3a5f]">
                        {s.name}
                      </td>
                      {gItems.map((item) =>
                        item.type === 'number' ? (
                          <td
                            key={item.id}
                            className={`border-t border-r border-gray-100 px-1.5 py-1.5 text-center ${item.auto ? 'bg-blue-50/50' : ''}`}
                          >
                            <span className="font-medium text-[#1e3a5f]">
                              {mockNumbers[`${s.id}:${item.id}`] ?? '-'}
                            </span>
                          </td>
                        ) : (
                          <StatusCell key={item.id} status={mockStatuses[`${s.id}:${item.id}`]} />
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ======================================================================
// パターンD: コンパクトヒートマップ一覧
//   全項目を1セルずつ色ブロック表示。横長だが全情報が1テーブルに収まる。
//   チェックは■緑/■黄/□灰、数値はセル内の数字。
// ======================================================================
function PatternD() {
  return (
    <div className="space-y-3">
      {/* グループ凡例 */}
      <div className="flex flex-wrap items-center gap-3 text-[10px]">
        {GROUPS.map((g) => (
          <div key={g.key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: g.color }} />
            <span className="text-gray-500">{g.label}</span>
          </div>
        ))}
        <span className="text-gray-300 mx-1">|</span>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-400" />
          <span className="text-gray-500">完了</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-yellow-400" />
          <span className="text-gray-500">進行中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-200" />
          <span className="text-gray-500">未着手</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-[10px] min-w-max">
          <thead>
            {/* グループカラーバー */}
            <tr>
              <th className="sticky left-0 z-20 bg-white" colSpan={3} />
              {GROUPS.map((g) => {
                const gItems = ITEMS.filter((i) => i.group === g.key);
                return (
                  <th
                    key={g.key}
                    colSpan={gItems.length}
                    className="px-0 py-0 h-[4px]"
                    style={{ backgroundColor: g.color }}
                  />
                );
              })}
            </tr>
            {/* 項目名ヘッダー（縦書き風に短縮） */}
            <tr>
              <th className="sticky left-0 z-20 bg-[#f8fafc] border-b border-gray-200 px-1 py-1 w-10 text-[9px] text-gray-400">
                学年
              </th>
              <th className="sticky left-[40px] z-20 bg-[#f8fafc] border-b border-gray-200 px-2 py-1 w-20 text-left text-[10px] text-gray-600 font-medium">
                生徒
              </th>
              <th className="sticky left-[120px] z-20 bg-[#f8fafc] border-b border-gray-200 px-1 py-1 w-12 text-center text-[9px] text-gray-400">
                進捗
              </th>
              {ITEMS.map((item) => {
                const g = GROUPS.find((gg) => gg.key === item.group)!;
                return (
                  <th
                    key={item.id}
                    className="border-b border-gray-200 px-0.5 py-1 text-center min-w-[32px] max-w-[40px]"
                    title={`${item.name}${item.deadline ? ` (期日:${item.deadline})` : ''}${item.auto ? ' (自動)' : ''}`}
                  >
                    <div className="text-[8px] leading-tight truncate" style={{ color: g.color }}>
                      {item.name.length > 3 ? item.name.slice(0, 3) : item.name}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {STUDENTS.map((s, si) => {
              const prog = getStudentProgress(s.id);
              return (
                <tr key={s.id} className={`${si % 2 ? 'bg-gray-50/40' : ''} hover:bg-blue-50/30`}>
                  <td className="sticky left-0 z-10 bg-inherit border-b border-gray-100 px-1 py-1 text-[9px] text-gray-400 text-center">
                    {s.grade}
                  </td>
                  <td className="sticky left-[40px] z-10 bg-inherit border-b border-gray-100 px-2 py-1 text-[10px] font-medium text-[#1e3a5f] whitespace-nowrap">
                    {s.name}
                  </td>
                  <td className="sticky left-[120px] z-10 bg-inherit border-b border-gray-100 px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <div className="w-8">
                        <ProgressBar pct={prog.pct} />
                      </div>
                      <span className="text-[8px] text-gray-400 w-6 text-right">{prog.pct}%</span>
                    </div>
                  </td>
                  {ITEMS.map((item) => {
                    if (item.type === 'number') {
                      const val = mockNumbers[`${s.id}:${item.id}`];
                      return (
                        <td
                          key={item.id}
                          className={`border-b border-gray-100 px-0 py-0.5 text-center cursor-pointer hover:bg-blue-100/40 ${item.auto ? 'bg-blue-50/30' : ''}`}
                        >
                          <span
                            className={`text-[10px] font-medium ${val && val > 0 ? 'text-[#1e3a5f]' : 'text-gray-300'}`}
                          >
                            {val ?? '-'}
                          </span>
                        </td>
                      );
                    }
                    const st = mockStatuses[`${s.id}:${item.id}`];
                    return (
                      <td
                        key={item.id}
                        className="border-b border-gray-100 px-0 py-0.5 text-center cursor-pointer hover:brightness-90"
                      >
                        <div
                          className={`w-5 h-5 mx-auto rounded-sm flex items-center justify-center text-[10px] font-bold ${
                            st === 'completed'
                              ? 'bg-green-400 text-white'
                              : st === 'pending'
                                ? 'bg-yellow-400 text-white'
                                : 'bg-gray-100 text-gray-300'
                          }`}
                        >
                          {st === 'completed' ? '✓' : st === 'pending' ? '×' : ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ======================================================================
// パターンE: 進捗バー一覧 + インラインスクロール
//   左に生徒名＋グループ別進捗バー、右にスクロール可能な詳細テーブル。
//   左側が固定で全体像が常に見える。
// ======================================================================
function PatternE() {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const visibleItems = activeGroup ? ITEMS.filter((i) => i.group === activeGroup) : ITEMS;

  return (
    <div className="space-y-3">
      {/* フィルター */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">表示:</span>
        <button
          onClick={() => setActiveGroup(null)}
          className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
            !activeGroup
              ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
              : 'text-gray-500 border-gray-200 hover:bg-gray-50'
          }`}
        >
          すべて
        </button>
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setActiveGroup(activeGroup === g.key ? null : g.key)}
            className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
              activeGroup === g.key
                ? 'text-white'
                : 'text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
            style={activeGroup === g.key ? { backgroundColor: g.color, borderColor: g.color } : {}}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
        <table className="border-collapse text-xs min-w-max">
          <thead>
            {/* グループヘッダー */}
            <tr>
              <th
                className="sticky left-0 z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1"
                style={{ minWidth: 40 }}
              />
              <th
                className="sticky z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1"
                style={{ left: 40, minWidth: 90 }}
              />
              {/* グループ別ミニ進捗 */}
              <th
                className="sticky z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1"
                style={{ left: 130, minWidth: 180 }}
              >
                <div className="flex items-center gap-2">
                  {GROUPS.filter((g) =>
                    ITEMS.some((i) => i.group === g.key && i.type === 'check')
                  ).map((g) => (
                    <div key={g.key} className="flex items-center gap-0.5" title={g.label}>
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="text-[8px] text-gray-400">{g.label.slice(0, 2)}</span>
                    </div>
                  ))}
                </div>
              </th>
              {/* 項目ヘッダー */}
              {(() => {
                const grouped: { group: (typeof GROUPS)[0]; items: typeof ITEMS }[] = [];
                for (const g of GROUPS) {
                  const gi = visibleItems.filter((i) => i.group === g.key);
                  if (gi.length > 0) grouped.push({ group: g, items: gi });
                }
                return grouped.map(({ group: g, items: gItems }) => (
                  <th
                    key={g.key}
                    colSpan={gItems.length}
                    className="border-b border-gray-200 px-1 py-1 text-center text-[10px] font-medium"
                    style={{
                      backgroundColor: g.color + '12',
                      color: g.color,
                      borderBottom: `2px solid ${g.color}`,
                    }}
                  >
                    {g.label}
                  </th>
                ));
              })()}
            </tr>
            <tr className="bg-[#f0f4f8]">
              <th className="sticky left-0 z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-1 py-1.5 text-[9px] text-gray-400">
                学年
              </th>
              <th
                className="sticky z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-2 py-1.5 text-left text-[10px] text-gray-600 font-medium"
                style={{ left: 40 }}
              >
                生徒名
              </th>
              <th
                className="sticky z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-2 py-1.5 text-[9px] text-gray-400"
                style={{ left: 130 }}
              >
                グループ別進捗
              </th>
              {visibleItems.map((item) => {
                const g = GROUPS.find((gg) => gg.key === item.group)!;
                return (
                  <th
                    key={item.id}
                    className="border-b border-r border-gray-200 px-1 py-1.5 text-center min-w-[50px]"
                  >
                    <div className="text-[10px] font-medium" style={{ color: g.color }}>
                      {item.name}
                    </div>
                    {item.deadline && (
                      <div className="text-[9px] text-orange-400">{item.deadline}</div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {STUDENTS.map((s, si) => {
              return (
                <tr key={s.id} className={`hover:bg-blue-50/20 ${si % 2 ? 'bg-gray-50/30' : ''}`}>
                  <td className="sticky left-0 z-10 bg-inherit border-b border-r border-gray-200 px-1 py-1.5 text-[10px] text-gray-400 text-center">
                    {s.grade}
                  </td>
                  <td
                    className="sticky z-10 bg-inherit border-b border-r border-gray-200 px-2 py-1.5 text-xs font-medium text-[#1e3a5f] whitespace-nowrap"
                    style={{ left: 40 }}
                  >
                    {s.name}
                  </td>
                  {/* グループ別ミニ進捗バー */}
                  <td
                    className="sticky z-10 bg-inherit border-b border-r border-gray-200 px-2 py-1"
                    style={{ left: 130 }}
                  >
                    <div className="flex items-center gap-1.5">
                      {GROUPS.filter((g) =>
                        ITEMS.some((i) => i.group === g.key && i.type === 'check')
                      ).map((g) => {
                        const gp = getStudentGroupProgress(s.id, g.key);
                        if (!gp) return null;
                        return (
                          <div
                            key={g.key}
                            className="flex items-center gap-0.5"
                            title={`${g.label}: ${gp.completed}/${gp.total}`}
                          >
                            <div className="w-8 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${gp.pct}%`, backgroundColor: g.color }}
                              />
                            </div>
                            <span className="text-[8px]" style={{ color: g.color }}>
                              {gp.pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  {/* 項目セル */}
                  {visibleItems.map((item) => {
                    if (item.type === 'number') {
                      const val = mockNumbers[`${s.id}:${item.id}`];
                      return (
                        <td
                          key={item.id}
                          className={`border-b border-r border-gray-100 px-1 py-1.5 text-center ${item.auto ? 'bg-blue-50/30' : ''}`}
                        >
                          <span
                            className={`font-medium ${val && val > 0 ? 'text-[#1e3a5f]' : 'text-gray-300'}`}
                          >
                            {val ?? '-'}
                          </span>
                        </td>
                      );
                    }
                    return <StatusCell key={item.id} status={mockStatuses[`${s.id}:${item.id}`]} />;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ======================================================================
// メインページ
// ======================================================================
export default function ProgressMockupPage() {
  const [pattern, setPattern] = useState<PatternType>('D');

  const patterns = [
    { key: 'A' as const, label: 'A: タブ切替', desc: 'グループをタブで切り替えて列数を減らす' },
    {
      key: 'C' as const,
      label: 'C: セクション分割',
      desc: 'グループごとにテーブルを分割し折りたたみ',
    },
    { key: 'D' as const, label: 'D: ヒートマップ一覧', desc: '全項目を色ブロックでコンパクト表示' },
    {
      key: 'E' as const,
      label: 'E: 固定サマリー＋フィルター',
      desc: '左固定で進捗バー、右にフィルター付き詳細',
    },
  ];

  return (
    <AdminLayout headerTitle="進捗管理 UIモックアップ">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* パターン選択 */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm font-bold text-[#1e3a5f]">パターン:</span>
            {patterns.map((p) => (
              <button
                key={p.key}
                onClick={() => setPattern(p.key)}
                className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                  pattern === p.key
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium">{p.label}</div>
                <div
                  className={`text-[10px] mt-0.5 ${pattern === p.key ? 'text-blue-200' : 'text-gray-400'}`}
                >
                  {p.desc}
                </div>
              </button>
            ))}
          </div>

          {/* 比較表 */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              {
                key: 'A',
                pros: ['直感的で操作しやすい', '横スクロール不要', '全生徒の比較が容易'],
                cons: ['グループ横断で見れない'],
              },
              {
                key: 'C',
                pros: ['全情報が一覧可能', 'グループ進捗が一目瞭然', '折りたたみで情報量調整'],
                cons: ['縦に長くなる'],
              },
              {
                key: 'D',
                pros: ['全項目が1画面に収まる', '色で即座に状況把握', '最もコンパクト'],
                cons: ['列名が省略される'],
              },
              {
                key: 'E',
                pros: ['左固定でサマリー常時表示', 'フィルターで柔軟に切替', '現行UIに近い操作感'],
                cons: ['全表示時は横スクロール'],
              },
            ].map((p) => (
              <div
                key={p.key}
                className={`p-2.5 rounded-lg border text-[10px] ${pattern === p.key ? 'border-blue-300 bg-blue-50' : 'border-gray-100'}`}
              >
                <div className="font-bold text-[#1e3a5f] mb-1">パターン{p.key}</div>
                <div className="space-y-0.5">
                  {p.pros.map((t, i) => (
                    <div key={i} className="text-green-600">
                      + {t}
                    </div>
                  ))}
                  {p.cons.map((t, i) => (
                    <div key={i} className="text-red-400">
                      - {t}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* モックアップ */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          {pattern === 'A' && <PatternA />}
          {pattern === 'C' && <PatternC />}
          {pattern === 'D' && <PatternD />}
          {pattern === 'E' && <PatternE />}
        </div>
      </div>
    </AdminLayout>
  );
}
