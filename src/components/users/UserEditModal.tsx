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
  /** 講師の社員番号。出勤簿一覧の並び順制御に使用 */
  employee_no?: string | null;
  /** true=時給講師として扱い、出勤簿等に含める（owner/admin兼任向け） */
  is_teaching_staff?: boolean;
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
  onSave: (lastName: string, firstName: string, role: UserRole, schoolIds: string[], defaultSchoolId: string, employeeNo: string | null, isTeachingStaff: boolean) => void;
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
  const [editEmployeeNo, setEditEmployeeNo] = useState('');
  // 時給講師フラグ。teacher ロール以外で「授業を持つ管理者等」を出勤簿に含めるために使用
  const [editIsTeachingStaff, setEditIsTeachingStaff] = useState(false);

  useEffect(() => {
    // last_name が未設定なら display_name をフォールバック
    setEditLastName(editingUser.last_name || editingUser.display_name || '');
    setEditFirstName(editingUser.first_name || '');
    setEditEmployeeNo(editingUser.employee_no || '');
    setEditIsTeachingStaff(editingUser.is_teaching_staff ?? false);
    setEditRole(editingUser.role === 'teacher' ? 'manager' : (editingUser.role || 'manager') as UserRole);
    const ids = editingUser.user_schools?.map(us => us.school_id) || [];
    setEditSchoolIds(ids);
    // デモ教室はデフォルトに選ばない。フォールバックもデモ以外の先頭を優先する。
    const demoIdSet = new Set(schools.filter(s => s.is_demo).map(s => s.id));
    const firstNonDemo = ids.find(id => !demoIdSet.has(id)) || ids[0] || '';
    const savedDefault = editingUser.default_school_id;
    const defaultId =
      savedDefault && ids.includes(savedDefault) && !demoIdSet.has(savedDefault)
        ? savedDefault
        : firstNonDemo;
    setEditDefaultSchoolId(defaultId);
  }, [editingUser, schools]);

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
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              社員番号
            </label>
            <input
              type="text"
              value={editEmployeeNo}
              onChange={e => {
                // 全角数字を半角に正規化して保持する
                const normalized = e.target.value.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
                setEditEmployeeNo(normalized);
              }}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              placeholder="例: 001"
            />
            <p className="text-xs text-[#4b5563]/70 mt-1">出勤簿一覧の並び順に使用します。空欄でも登録できます。</p>
          </div>
          {/* teacher ロールは元々講師なので表示不要。owner/admin/manager 等が授業を兼任する場合のみ表示 */}
          {editingUser.role !== 'teacher' && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editIsTeachingStaff}
                onChange={e => setEditIsTeachingStaff(e.target.checked)}
                className="rounded border-[#e5e7eb] w-4 h-4"
              />
              <span className="text-sm font-medium text-[#1f2937]">時給講師として扱う（出勤簿・講師として管理）</span>
            </label>
            <p className="text-xs text-[#4b5563]/70 mt-1 ml-6">ロールが管理者・室長・オーナーでも、授業を持つ場合はONにすると出勤簿の講師一覧に表示されます</p>
          </div>
          )}
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
                          // デフォルトを外したら、デモ以外の先頭教室に付け替える
                          const demoIdSet = new Set(schools.filter(s => s.is_demo).map(s => s.id));
                          setEditDefaultSchoolId(next.find(id => !demoIdSet.has(id)) || next[0] || '');
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
                {/* デモ教室はデフォルトに選べないようにする（見本用のため） */}
                {schools.filter(s => editSchoolIds.includes(s.id) && !s.is_demo).map(school => (
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
              onClick={() => onSave(editLastName, editFirstName, editRole, editSchoolIds, editDefaultSchoolId, editEmployeeNo.trim() || null, editIsTeachingStaff)}
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
