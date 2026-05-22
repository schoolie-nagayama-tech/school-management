'use client';

import { useState, useEffect } from 'react';
import type { School, UserRole } from '@/types/database';
import { USER_ROLE_LABELS } from '@/types/database';

interface EditableUser {
  id: string;
  email: string;
  display_name: string | null;
  last_name?: string | null;
  first_name?: string | null;
  role: string;
  default_school_id?: string | null;
  user_schools?: Array<{
    id: string;
    user_id: string;
    school_id: string;
    school?: { id: string; name: string; code: string | null };
  }>;
}

interface UserEditModalProps {
  editingUser: EditableUser;
  profileId: string | undefined;
  schools: School[];
  isSaving: boolean;
  onSave: (lastName: string, firstName: string, role: UserRole, schoolIds: string[], defaultSchoolId: string) => void;
  onClose: () => void;
}

export function UserEditModal({
  editingUser,
  profileId,
  schools,
  isSaving,
  onSave,
  onClose,
}: UserEditModalProps) {
  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('manager');
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [editDefaultSchoolId, setEditDefaultSchoolId] = useState<string>('');

  useEffect(() => {
    // last_name が未設定なら display_name をフォールバック
    setEditLastName(editingUser.last_name || editingUser.display_name || '');
    setEditFirstName(editingUser.first_name || '');
    setEditRole(editingUser.role === 'teacher' ? 'manager' : (editingUser.role || 'manager') as UserRole);
    const ids = editingUser.user_schools?.map(us => us.school_id) || [];
    setEditSchoolIds(ids);
    const defaultId = editingUser.default_school_id && ids.includes(editingUser.default_school_id)
      ? editingUser.default_school_id
      : ids[0] || '';
    setEditDefaultSchoolId(defaultId);
  }, [editingUser]);

  const isEditingSelf = editingUser.id === profileId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 max-w-md w-full">
        <h2 className="text-xl font-bold text-[#1f2937] mb-4">
          {isEditingSelf ? '自分の情報を編集' : 'ユーザー編集'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              メールアドレス
            </label>
            <input
              type="text"
              value={editingUser.email}
              disabled
              className="w-full px-3 py-2 border border-[#e5e7eb]/30 rounded-lg bg-[#f3f4f6] text-[#4b5563]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">姓</label>
              <input
                type="text"
                value={editLastName}
                onChange={e => setEditLastName(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                placeholder="山田"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">名</label>
              <input
                type="text"
                value={editFirstName}
                onChange={e => setEditFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                placeholder="太郎"
              />
            </div>
          </div>
          {!isEditingSelf && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              権限
            </label>
            <select
              value={editRole}
              onChange={e => setEditRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
            >
              {(Object.keys(USER_ROLE_LABELS) as UserRole[]).filter(role => role !== 'teacher').map(role => (
                <option key={role} value={role}>
                  {USER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          )}
          {!isEditingSelf && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              担当教室
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {schools.map(school => (
                <label key={school.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editSchoolIds.includes(school.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setEditSchoolIds([...editSchoolIds, school.id]);
                      } else {
                        const next = editSchoolIds.filter(id => id !== school.id);
                        setEditSchoolIds(next);
                        if (editDefaultSchoolId === school.id) {
                          setEditDefaultSchoolId(next[0] || '');
                        }
                      }
                    }}
                    className="rounded border-[#e5e7eb]"
                  />
                  <span className="text-sm text-[#1f2937]">{school.name}</span>
                </label>
              ))}
            </div>
          </div>
          )}
          {editSchoolIds.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">
                デフォルトの教室
              </label>
              <p className="text-xs text-[#4b5563]/70 mb-2">複数教室のとき、ログイン時に最初に選択される教室です。</p>
              <select
                value={editDefaultSchoolId}
                onChange={e => setEditDefaultSchoolId(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                {schools.filter(s => editSchoolIds.includes(s.id)).map(school => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-[#f3f4f6] text-[#1f2937] rounded-lg hover:bg-[#e5e7eb] transition-colors duration-150"
            >
              キャンセル
            </button>
            <button
              onClick={() => onSave(editLastName, editFirstName, editRole, editSchoolIds, editDefaultSchoolId)}
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors duration-150 disabled:opacity-50"
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
