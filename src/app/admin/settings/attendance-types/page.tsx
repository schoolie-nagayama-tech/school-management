'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui';
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import {
  getAttendanceTypes,
  createAttendanceType,
  updateAttendanceType,
  deleteAttendanceType,
} from '@/lib/api/attendance';
import { getSchools } from '@/lib/api/schools';
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
  const [formData, setFormData] = useState<AttendanceTypeFormData>({
    name: '',
    unit: 'count',
    unit_price: 0,
    display_order: 0,
    is_active: true,
  });

  // 教室一覧を取得
  useEffect(() => {
    async function fetchSchools() {
      try {
        const data = await getSchools();
        setSchools(data);
        if (data.length > 0) {
          setSelectedSchoolId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to fetch schools:', error);
        toastError('教室の取得に失敗しました');
      }
    }
    fetchSchools();
  }, [toastError]);

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

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
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
                <div className="text-[#2a2a2a]">読み込み中...</div>
              </div>
            ) : attendanceTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-[#2a2a2a] mb-4">
                  コマ種別が登録されていません
                </p>
                <Button onClick={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  最初の種別を追加
                </Button>
              </div>
            ) : (
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
                  {attendanceTypes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <GripVertical className="h-4 w-4 text-[#2a2a2a] cursor-grab" />
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {item.unit === 'count' ? 'コマ' : '時間'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        ¥{item.unit_price.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.is_active ? (
                          <Badge variant="default">有効</Badge>
                        ) : (
                          <Badge variant="secondary">無効</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            onClick={() => handleEdit(item)}
                            className="p-2"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleDeleteClick(item)}
                            className="p-2"
                          >
                            <Trash2 className="h-4 w-4 text-[#d9376e]" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a]"
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
