import { fetchWithAuth } from '@/lib/api/auth';
import type { TeacherBadge, TeacherBadgeAssignment } from '@/types/database';

// =====================================================
// バッジテンプレート（マスタ）
// =====================================================

export async function getTeacherBadges(
  category?: string,
  options?: { includeInactive?: boolean }
): Promise<TeacherBadge[]> {
  const params = new URLSearchParams({ t: String(Date.now()) });
  if (category) params.set('category', category);
  if (options?.includeInactive) params.set('includeInactive', '1');
  const res = await fetchWithAuth(`/api/admin/teacher-badges?${params}`);
  if (!res.ok) throw new Error('バッジ一覧の取得に失敗しました');
  const json = await res.json();
  return json.badges;
}

export async function createTeacherBadge(data: {
  name: string;
  category: string;
  rank: string;
  icon: string;
  description?: string;
  sort_order?: number;
}): Promise<TeacherBadge> {
  const res = await fetchWithAuth('/api/admin/teacher-badges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'バッジの作成に失敗しました');
  }
  const json = await res.json();
  return json.badge;
}

export async function updateTeacherBadge(
  badgeId: string,
  data: Partial<{
    name: string;
    category: string;
    rank: string;
    icon: string;
    description: string | null;
    sort_order: number;
    is_active: boolean;
  }>
): Promise<TeacherBadge> {
  const res = await fetchWithAuth(`/api/admin/teacher-badges/${badgeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'バッジの更新に失敗しました');
  }
  const json = await res.json();
  return json.badge;
}

export async function deleteTeacherBadge(
  badgeId: string,
  options?: { hard?: boolean }
): Promise<void> {
  const qs = options?.hard ? '?hard=1' : '';
  const res = await fetchWithAuth(`/api/admin/teacher-badges/${badgeId}${qs}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('バッジの削除に失敗しました');
}

// =====================================================
// バッジ付与（トグル）
// =====================================================

export async function getTeacherBadgeAssignments(
  teacherId: string
): Promise<TeacherBadgeAssignment[]> {
  const res = await fetchWithAuth(`/api/admin/teachers/${teacherId}/badges?t=${Date.now()}`);
  if (!res.ok) throw new Error('バッジ付与情報の取得に失敗しました');
  const json = await res.json();
  return json.assignments;
}

export async function toggleTeacherBadge(
  teacherId: string,
  data: { badgeId: string; completedAt?: string; note?: string }
): Promise<{ action: 'assigned' | 'revoked'; assignment?: TeacherBadgeAssignment }> {
  const res = await fetchWithAuth(`/api/admin/teachers/${teacherId}/badges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'バッジの付与/剥奪に失敗しました');
  }
  return res.json();
}

// =====================================================
// バッジ別の付与済み講師ID一覧
// =====================================================

export async function getBadgeAssignees(badgeId: string): Promise<string[]> {
  const res = await fetchWithAuth(`/api/admin/teacher-badges/${badgeId}/assignees?t=${Date.now()}`);
  if (!res.ok) throw new Error('付与情報の取得に失敗しました');
  const json = await res.json();
  return json.assignedTeacherIds;
}

// =====================================================
// マイバッジ（講師自身）
// =====================================================

export async function getMyBadges(): Promise<{
  badges: TeacherBadge[];
  assignments: TeacherBadgeAssignment[];
}> {
  const res = await fetchWithAuth(`/api/my/badges?t=${Date.now()}`);
  if (!res.ok) throw new Error('バッジ情報の取得に失敗しました');
  return res.json();
}
