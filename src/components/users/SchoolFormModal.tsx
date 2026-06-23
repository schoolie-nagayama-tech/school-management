'use client';

import type { School } from '@/types/database';

interface SchoolFormModalProps {
  editingSchool: School | null;
  schoolName: string;
  schoolCode: string;
  notificationEmail: string;
  isSavingSchool: boolean;
  onSchoolNameChange: (name: string) => void;
  onSchoolCodeChange: (code: string) => void;
  onNotificationEmailChange: (email: string) => void;
  onSubmitCreate: (e: React.FormEvent) => void;
  onSubmitEdit: () => void;
  onClose: () => void;
}

export function SchoolFormModal({
  editingSchool,
  schoolName,
  schoolCode,
  notificationEmail,
  isSavingSchool,
  onSchoolNameChange,
  onSchoolCodeChange,
  onNotificationEmailChange,
  onSubmitCreate,
  onSubmitEdit,
  onClose,
}: SchoolFormModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 max-w-md w-full">
        <h2 className="text-xl font-bold text-[#1f2937] mb-4">
          {editingSchool ? '教室を編集' : '教室を追加'}
        </h2>
        <form
          onSubmit={
            editingSchool
              ? (e) => {
                  e.preventDefault();
                  onSubmitEdit();
                }
              : onSubmitCreate
          }
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">教室名</label>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => onSchoolNameChange(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              placeholder="例：長山教室"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              教室コード（任意）
            </label>
            <input
              type="text"
              value={schoolCode}
              onChange={(e) => onSchoolCodeChange(e.target.value)}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              placeholder="例：NAGAYAMA"
            />
            <p className="mt-1 text-xs text-[#4b5563]">ポータルURLで使用されます</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              申込通知先メールアドレス（任意）
            </label>
            <input
              type="email"
              value={notificationEmail}
              onChange={(e) => onNotificationEmailChange(e.target.value)}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              placeholder="manager@example.com"
            />
            <p className="mt-1 text-xs text-[#4b5563]">
              フォームから申込があった際に通知を受け取るメールアドレスです
            </p>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-[#f3f4f6] text-[#1f2937] rounded-lg hover:bg-[#e5e7eb] transition-colors duration-150"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSavingSchool}
              className="flex-1 px-4 py-2 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors duration-150 disabled:opacity-50"
            >
              {isSavingSchool ? '保存中...' : editingSchool ? '更新' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
