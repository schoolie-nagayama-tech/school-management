'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { OrderStatusBadge } from '@/components/ordering/OrderStatusBadge';
import { getOrders, updateOrderStatus, deleteOrder } from '@/lib/api/ordering';
import { getStudents } from '@/lib/api/students';
import type { MaterialOrderWithDetails, OrderStatus, Student } from '@/types/database';
import { ORDER_STATUS_LABELS, GRADE_LABELS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { ArrowLeft } from 'lucide-react';

const STATUS_OPTIONS: OrderStatus[] = ['unconfirmed', 'ordered', 'delivered', 'distributed', 'cancelled'];

export default function OrderHistoryPage() {
  const { hasPermission, isLoading: permLoading } = useRequirePermission((p) => p.canAccessOrdering);
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { success, error: toastError } = useToast();

  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [searchText, setSearchText] = useState('');

  const fetchData = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setLoading(true);
    try {
      const [ordersData, studentsData] = await Promise.all([
        getOrders(schoolIds),
        getStudents(undefined, schoolIds),
      ]);
      setOrders(ordersData);
      setStudents(studentsData);
    } catch (err) {
      toastError(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, [getSelectedSchoolIds, toastError]);

  useEffect(() => {
    if (selectedSchoolId !== null) fetchData();
  }, [selectedSchoolId, fetchData]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((o) => {
        const studentName = o.student ? `${o.student.last_name}${o.student.first_name}` : '';
        const materialName = o.material?.name || '';
        return studentName.toLowerCase().includes(q) || materialName.toLowerCase().includes(q);
      });
    }
    return result;
  }, [orders, statusFilter, searchText]);

  // Summary counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length };
    STATUS_OPTIONS.forEach((s) => { counts[s] = 0; });
    orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return counts;
  }, [orders]);

  const handleStatusChange = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    setChangingId(orderId);
    try {
      await updateOrderStatus(orderId, newStatus);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
      success('ステータスを更新しました');
    } catch (err) {
      toastError(getUserErrorMessage(err, 'ステータスの更新に失敗しました'));
    } finally {
      setChangingId(null);
    }
  }, [success, toastError]);

  const handleDelete = useCallback(async (orderId: string) => {
    if (!confirm('この発注を削除しますか？')) return;
    try {
      await deleteOrder(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      success('発注を削除しました');
    } catch (err) {
      toastError(getUserErrorMessage(err, '削除に失敗しました'));
    }
  }, [success, toastError]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  };

  if (permLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return <AdminLayout><AccessDenied /></AdminLayout>;
  }

  return (
    <AdminLayout headerTitle="発注履歴">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/ordering"
          className="flex items-center gap-1.5 text-sm text-[#3b82f6] hover:text-[#1e3a5f] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          教材・発注管理に戻る
        </Link>
      </div>

      {/* ステータスタブ */}
      <div className="flex gap-1 mb-4 bg-white rounded-lg border border-gray-200 p-1">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            statusFilter === 'all' ? 'bg-[#1e3a5f] text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          すべて {statusCounts.all}
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              statusFilter === s ? 'bg-[#1e3a5f] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {ORDER_STATUS_LABELS[s]} {statusCounts[s] || 0}
          </button>
        ))}
      </div>

      {/* 検索 */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="生徒名・教材名で検索..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
        />
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">
            {orders.length === 0 ? '発注履歴がありません' : '条件に一致する発注がありません'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-gray-200">
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">日付</th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">生徒</th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">学年</th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">教材</th>
                  <th className="text-center py-2.5 px-4 text-xs font-medium text-gray-500">数量</th>
                  <th className="text-center py-2.5 px-4 text-xs font-medium text-gray-500">ステータス</th>
                  {canEdit && (
                    <th className="text-center py-2.5 px-4 text-xs font-medium text-gray-500">操作</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const student = order.student;
                  const studentGrade = student
                    ? students.find((s) => s.id === order.student_id)?.grade
                    : null;

                  return (
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-4 text-sm text-gray-600">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-gray-900 font-medium">
                        {student ? `${student.last_name} ${student.first_name}` : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-500">
                        {studentGrade ? GRADE_LABELS[studentGrade] || '' : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-gray-900">
                        {order.material?.name || '-'}
                      </td>
                      <td className="py-2.5 px-4 text-center text-sm text-gray-900">
                        {order.quantity}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {canEdit ? (
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                            disabled={changingId === order.id}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-[#1e3a5f]/30"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{ORDER_STATUS_LABELS[opt]}</option>
                            ))}
                          </select>
                        ) : (
                          <OrderStatusBadge status={order.status as OrderStatus} />
                        )}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-4 text-center">
                          <button
                            onClick={() => handleDelete(order.id)}
                            className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                          >
                            削除
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* フッター集計 */}
          <div className="px-4 py-2 bg-[#f8fafc] border-t border-gray-200 text-xs text-gray-500">
            表示: {filteredOrders.length}件 / 全{orders.length}件
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
