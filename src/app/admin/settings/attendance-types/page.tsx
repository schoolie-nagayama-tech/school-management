'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableRow,
  TableBody,
  TableHead,
  TableHeader,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  SelectShadcn as Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  Switch,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui';
import Link from 'next/link';
import { Plus, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { SortableAttendanceTypeRow } from '@/components/attendance/SortableAttendanceTypeRow';
import {
  getAttendanceTypes,
  createAttendanceType,
  updateAttendanceType,
  deleteAttendanceType,
  updateAttendanceTypeOrder,
} from '@/lib/api/attendance';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { AttendanceType, AttendanceTypeFormData } from '@/types/attendance';
import type { School } from '@/types/database';

export default function AttendanceTypesPage() {
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AttendanceType | null>(null);
  const [deletingItem, setDeletingItem] = useState<AttendanceType | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [formData, setFormData] = useState<AttendanceTypeFormData>({
    name: '',
    unit: 'count',
    unit_price: 0,
    display_order: 0,
    is_active: true,
    is_class_type: true,
  });

  const { schools: masterSchools } = useMasterData();

  // 教室一覧をコンテキストから取得
  useEffect(() => {
    if (masterSchools.length > 0) {
      setSchools(masterSchools);
      if (!selectedSchoolId) setSelectedSchoolId(masterSchools[0].id);
    }
  }, [masterSchools, selectedSchoolId]);

  // コマ種別を取得
  useEffect(() => {
    async function fetchAttendanceTypes() {
      if (!selectedSchoolId) return;
      
      setIsLoading(true);
      try {
        const data = await getAttendanceTypes(selectedSchoolId);
        setAttendanceTypes(data);
      } catch (error) {
        console.error('Failed to fetch attendance types:', error);
        toastError('コマ種別の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
    fetchAttendanceTypes();
  }, [selectedSchoolId, toastError]);

  // 新規作成ダイアログを開く
  const handleCreate = () => {
    setEditingItem(null);
    setFormData({
      name: '',
      unit: 'count',
      unit_price: 0,
      display_order: attendanceTypes.length,
      is_active: true,
      is_class_type: true,
    });
    setIsDialogOpen(true);
  };

  // 編集ダイアログを開く
  const handleEdit = (item: AttendanceType) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      unit: item.unit,
      unit_price: item.unit_price,
      display_order: item.display_order,
      is_active: item.is_active,
      is_class_type: item.is_class_type,
    });
    setIsDialogOpen(true);
  };

  // 削除確認ダイアログを開く
  const handleDeleteClick = (item: AttendanceType) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  // 保存処理
  const handleSave = async () => {
    if (!formData.name.trim()) {
      toastError('種別名を入力してください');
      return;
    }

    try {
      if (editingItem) {
        await updateAttendanceType(editingItem.id, formData);
        success('コマ種別を更新しました');
      } else {
        await createAttendanceType(selectedSchoolId, formData);
        success('コマ種別を追加しました');
      }
      
      // 一覧を再取得
      const data = await getAttendanceTypes(selectedSchoolId);
      setAttendanceTypes(data);
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Failed to save attendance type:', error);
      toastError('保存に失敗しました');
    }
  };

  // 削除処理
  const handleDelete = async () => {
    if (!deletingItem) return;

    try {
      await deleteAttendanceType(deletingItem.id);
      success('コマ種別を削除しました');
      
      // 一覧を再取得
      const data = await getAttendanceTypes(selectedSchoolId);
      setAttendanceTypes(data);
      setIsDeleteDialogOpen(false);
      setDeletingItem(null);
    } catch (error) {
      console.error('Failed to delete attendance type:', error);
      toastError('削除に失敗しました。このコマ種別は使用中の可能性があります。');
    }
  };

  const selectedSchool = schools.find(s => s.id === selectedSchoolId);

  // ドラッグ&ドロップ用のセンサー
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 並び替え完了時の処理
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = attendanceTypes.findIndex((item) => item.id === active.id);
    const newIndex = attendanceTypes.findIndex((item) => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const newItems = arrayMove(attendanceTypes, oldIndex, newIndex);
    const previousItems = [...attendanceTypes];
    setAttendanceTypes(newItems);

    setIsReordering(true);
    try {
      await updateAttendanceTypeOrder(
        newItems.map((item, index) => ({ id: item.id, display_order: index }))
      );
      success('並び順を更新しました');
    } catch (error) {
      console.error('Failed to reorder attendance types:', error);
      setAttendanceTypes(previousItems);
      toastError('並び替えに失敗しました');
    } finally {
      setIsReordering(false);
    }
  };

  const isSubmitting = isReordering;

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150">
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">コマ種別設定</h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>コマ種別一覧</CardTitle>
              <div className="flex items-center gap-4">
                <div className="relative w-48">
                  <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="教室を選択">
                        {selectedSchool?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {schools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  種別を追加
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-text-body">読み込み中...</div>
              </div>
            ) : attendanceTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-text-body mb-4">
                  コマ種別が登録されていません
                </p>
                <Button onClick={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  最初の種別を追加
                </Button>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>種別名</TableHead>
                      <TableHead>単位</TableHead>
                      <TableHead className="text-right">単価</TableHead>
                      <TableHead className="text-center">有効</TableHead>
                      <TableHead className="w-24">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <SortableContext
                      items={attendanceTypes.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {attendanceTypes.map((item) => (
                        <SortableAttendanceTypeRow
                          key={item.id}
                          item={item}
                          onEdit={handleEdit}
                          onDeleteClick={handleDeleteClick}
                          isSubmitting={isSubmitting}
                        />
                      ))}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 追加・編集ダイアログ */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'コマ種別を編集' : 'コマ種別を追加'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">種別名 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="例：PS1、キッズコース、事務"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">単位</Label>
              <Select 
                value={formData.unit} 
                onValueChange={(value: string) =>
                  setFormData({ ...formData, unit: value as 'count' | 'hours' })
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {formData.unit === 'count' ? 'コマ' : '時間'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">
                    コマ
                  </SelectItem>
                  <SelectItem value="hours">
                    時間
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit_price">単価（円）</Label>
              <Input
                id="unit_price"
                type="number"
                value={formData.unit_price}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    unit_price: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="1000"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_active">有効</Label>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>コマ種別を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deletingItem?.name}」を削除します。
              このコマ種別が使用されている出勤簿がある場合、削除できません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-danger text-white hover:bg-red-700"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
