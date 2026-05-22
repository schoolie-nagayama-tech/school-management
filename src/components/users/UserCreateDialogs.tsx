'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Label } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Copy, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import type { School, UserRole } from '@/types/database';

interface UserCreateDialogsProps {
  isCreateDialogOpen: boolean;
  onCreateDialogChange: (open: boolean) => void;
  isResultDialogOpen: boolean;
  onResultDialogChange: (open: boolean) => void;
  schools: School[];
  onCreateUser: (formData: { email: string; displayName: string; lastName: string; firstName: string; password: string; role: UserRole; schoolId: string }) => Promise<void>;
  createdUser: { email: string; password: string; displayName: string } | null;
  isSubmitting: boolean;
  onCopy: (text: string, field: string) => void;
  copiedField: string | null;
}

export function UserCreateDialogs({
  isCreateDialogOpen,
  onCreateDialogChange,
  isResultDialogOpen,
  onResultDialogChange,
  schools,
  onCreateUser,
  createdUser,
  isSubmitting,
  onCopy,
  copiedField,
}: UserCreateDialogsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    lastName: '',
    firstName: '',
    displayName: '', // 後方互換（lastName + firstName から生成）
    password: '',
    role: 'manager' as UserRole,
    schoolId: schools[0]?.id || '',
  });

  const handleCreate = async () => {
    // displayName を姓名から生成して渡す
    const merged = { ...formData, displayName: [formData.lastName, formData.firstName].filter(Boolean).join(' ') };
    await onCreateUser(merged);
    setFormData({
      email: '',
      lastName: '',
      firstName: '',
      displayName: '',
      password: '',
      role: 'manager',
      schoolId: schools[0]?.id || '',
    });
  };

  return (
    <>
      {/* ユーザー作成ダイアログ */}
      <Dialog open={isCreateDialogOpen} onOpenChange={onCreateDialogChange}>
        <DialogHeader>
          <DialogTitle>ユーザーを追加</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="text-sm text-[#4b5563] mb-4">
              新しいユーザーアカウントを作成します。ユーザーID（メールアドレス）は未入力の場合、自動生成されます。
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス（ID）</Label>
              <Input
                id="email"
                type="text"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                placeholder="未入力の場合は自動生成されます"
              />
              <p className="text-xs text-[#4b5563]/70">ログイン時に使用するIDです。未入力の場合は自動生成されます。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lastName">姓 *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  placeholder="山田"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">名</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  placeholder="太郎"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                placeholder="4文字以上"
              />
              <p className="text-xs text-[#4b5563]/70">パスワードは4文字以上で入力してください</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">権限 *</Label>
              <Select
                value={formData.role}
                onValueChange={(value) =>
                  setFormData({ ...formData, role: value as UserRole })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">システム管理者</SelectItem>
                  <SelectItem value="owner">エリアマネージャー</SelectItem>
                  <SelectItem value="manager">教室長</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="school">所属教室 *</Label>
              <Select
                value={formData.schoolId}
                onValueChange={(value) =>
                  setFormData({ ...formData, schoolId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="教室を選択（登録済みから選択）" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#4b5563]/70">複数教室の権限は作成後に編集で設定できます。登録済みの教室から選択してください。</p>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onCreateDialogChange(false)}
          >
            キャンセル
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? '作成中...' : '作成'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* 作成完了ダイアログ */}
      <Dialog
        open={isResultDialogOpen}
        onOpenChange={onResultDialogChange}
      >
        <DialogHeader>
          <DialogTitle>ユーザーを作成しました</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="text-sm text-[#4b5563] mb-4">
              以下の情報をユーザーに伝えてください。パスワードは後から確認できません。
            </div>
            {createdUser && (
              <>
                <div className="space-y-2">
                  <Label>表示名</Label>
                  <Input value={createdUser.displayName} readOnly />
                </div>
                <div className="space-y-2">
                  <Label>メールアドレス（ID）</Label>
                  <div className="flex items-center gap-2">
                    <Input value={createdUser.email} readOnly className="flex-1" />
                    <Button
                      variant="ghost"
                      onClick={() => onCopy(createdUser.email, 'email')}
                      className="p-2"
                    >
                      {copiedField === 'email' ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>仮パスワード</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={createdUser.password}
                        readOnly
                      />
                      <Button
                        variant="ghost"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-0 top-0 h-full p-2"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => onCopy(createdUser.password, 'password')}
                      className="p-2"
                    >
                      {copiedField === 'password' ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-sm text-yellow-800">
                    <AlertTriangle className="inline h-4 w-4 mr-1" />パスワードはこの画面を閉じると再表示できません。必ずメモしてください。
                  </p>
                </div>
              </>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button onClick={() => onResultDialogChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
