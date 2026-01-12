'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/layout';
import { Button } from '@/components/ui';
import { ApplicationTable, ApplicationItemSettings } from '@/components/applications';
import { StudentDetailModal } from '@/components/students';
import {
  getStudents,
} from '@/lib/api/students';
import {
  getApplicationItems,
  getStudentApplications,
} from '@/lib/api/applications';
import type {
  Student,
  ApplicationItem,
  StudentApplication,
  ApplicationStatus,
} from '@/types/database';

export default function ApplicationsPage() {
  // 状態管理
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // データを取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [studentsData, itemsData, applicationsData] = await Promise.all([
        getStudents(),
        getApplicationItems(),
        getStudentApplications(),
      ]);
      setStudents(studentsData);
      setItems(itemsData);
      setApplications(applicationsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回読み込み
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 申込状況が変更されたときの処理
  const handleStatusChange = useCallback(
    (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      if (status === null) {
        // 削除
        setApplications((prev) =>
          prev.filter(
            (app) => !(app.student_id === studentId && app.item_id === itemId)
          )
        );
      } else {
        // 更新または追加
        setApplications((prev) => {
          const existing = prev.find(
            (app) => app.student_id === studentId && app.item_id === itemId
          );
          if (existing) {
            return prev.map((app) =>
              app.id === existing.id ? { ...app, status } : app
            );
          } else {
            // 新規作成（実際のIDはAPIから返されるが、ここでは仮のIDを使用）
            const newApp: StudentApplication = {
              id: `temp-${studentId}-${itemId}`,
              school_id: students.find((s) => s.id === studentId)?.school_id || '',
              student_id: studentId,
              item_id: itemId,
              status,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

  // 項目設定が閉じられたときに再取得
  const handleSettingsClose = () => {
    setIsSettingsModalOpen(false);
    fetchData();
  };

  // 生徒詳細を開く
  const handleStudentClick = (student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  };

  // 生徒詳細を閉じる
  const handleDetailClose = () => {
    setIsDetailModalOpen(false);
    setSelectedStudent(null);
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <AppHeader title="申込状況管理" onSettingsClick={() => setIsSettingsModalOpen(true)} />

      {/* メインコンテンツ */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-4 bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
            {errorMessage}
          </div>
        )}

        {/* 説明 */}
        <div className="mb-4 text-[#2a2a2a] text-sm">
          <p>セルをクリックして申込状況を切り替えます: 空白 → ×（未申込）→ ✓（申込済）→ -（対象外）→ 空白</p>
        </div>

        {/* テーブル */}
        {isLoading ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
            <div className="flex items-center justify-center">
              <svg
                className="animate-spin h-8 w-8 text-[#ff8e3c]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="ml-3 text-[#2a2a2a]">読み込み中...</span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <p className="text-[#2a2a2a] mb-4">申込項目がありません。</p>
            <Button onClick={() => setIsSettingsModalOpen(true)}>
              項目設定を開く
            </Button>
          </div>
        ) : (
          <ApplicationTable
            students={students}
            items={items}
            applications={applications}
            onStatusChange={handleStatusChange}
            onStudentClick={handleStudentClick}
            onItemsChange={fetchData}
          />
        )}

        {/* 項目設定モーダル */}
        <ApplicationItemSettings
          isOpen={isSettingsModalOpen}
          onClose={handleSettingsClose}
        />

        {/* 生徒詳細モーダル */}
        {selectedStudent && (
          <StudentDetailModal
            isOpen={isDetailModalOpen}
            onClose={handleDetailClose}
            student={selectedStudent}
            onEdit={(student) => {
              // 編集は別ページで行うため、ここでは詳細を閉じるだけ
              handleDetailClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
