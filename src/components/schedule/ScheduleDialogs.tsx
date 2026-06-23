'use client';

import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui';
import { Button, Spinner } from '@/components/ui';
import {
  ScheduleEntryModal,
  TransferModal,
  TeacherDetailModal,
  StudentActionModal,
  AddTeacherModal,
  AddStudentToSlotModal,
  DeleteScheduleEntryModal,
} from '@/components/schedule';
import { StudentDetailModal } from '@/components/students/StudentDetailModal';
import { Calendar, Settings } from 'lucide-react';
import type { ScheduleEntry, ScheduleEntryFormData, ScheduleTimeSlot } from '@/types/schedule';
import type { Student } from '@/types/database';

interface Teacher {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string; school?: { name: string } }>;
  teachable_subject_ids?: string[] | null;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
}

interface ScheduleDialogsProps {
  schoolId: string;
  profileId: string | undefined;

  // Settings dialog
  scheduleSettingsOpen: boolean;
  onScheduleSettingsChange: (open: boolean) => void;
  onScheduleGenerateOpen: () => void;

  // Generate confirm dialog
  scheduleGenerateConfirmOpen: boolean;
  onScheduleGenerateConfirmChange: (open: boolean) => void;
  scheduleGenerateLoading: boolean;
  scheduleGenerateHasExisting: boolean;
  onScheduleGenerateConfirm: () => void;

  // Student action modal
  actionModalEntry: ScheduleEntry | null;
  onActionModalClose: () => void;
  timeSlots: ScheduleTimeSlot[];
  onTransferFromAction: () => void;
  onRevertTransfer: () => void;
  onAbsentFromAction: () => void;
  onEditClick: () => void;
  onDeleteClick: () => void;
  onStudentClickFromAction: () => void;
  onTeacherClickFromAction: () => void;

  // Student detail modal
  studentDetailStudent: Student | null;
  onStudentDetailClose: () => void;

  // Add teacher modal
  addTeacherModalOpen: boolean;
  onAddTeacherClose: () => void;
  teachers: Teacher[];
  addTeacherExistingIds: string[];
  onAddTeacherSelect: (teacherId: string) => void;

  // Edit modal
  editModalOpen: boolean;
  onEditModalClose: () => void;
  editingEntry: ScheduleEntry | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  students: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subjects: any[];
  onEditSave: (form: ScheduleEntryFormData) => Promise<void>;

  // Add student modal
  addTarget: { date: string; slotId: string; teacherId: string } | null;
  onAddTargetClose: () => void;
  onAddSuccess: () => void;

  // Transfer modal
  transferModalOpen: boolean;
  onTransferModalClose: () => void;
  transferringEntry: ScheduleEntry | null;
  weekStartStr: string;
  weekEndStr: string;
  closedDates: string[];
  initialTransferTarget: { date: string; slotId: string } | null;
  onTransfer: (
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string,
    seatLabel?: string | null
  ) => Promise<void>;

  // Teacher detail modal
  teacherDetailOpen: boolean;
  onTeacherDetailClose: () => void;
  selectedTeacher: Teacher | null;

  // Delete modal
  deleteDialogOpen: boolean;
  onDeleteDialogClose: () => void;
  deletingEntry: ScheduleEntry | null;
  onDeleteConfirm: (deleteType: 'single' | 'regular') => Promise<void>;

  // Remove teacher confirm
  removeTeacherConfirm: {
    date: string;
    slotId: string;
    teacherId: string;
    entryCount: number;
  } | null;
  onRemoveTeacherConfirmClose: () => void;
  onRemoveTeacherConfirm: () => void;
}

export function ScheduleDialogs({
  schoolId,

  scheduleSettingsOpen,
  onScheduleSettingsChange,
  onScheduleGenerateOpen,

  scheduleGenerateConfirmOpen,
  onScheduleGenerateConfirmChange,
  scheduleGenerateLoading,
  scheduleGenerateHasExisting,
  onScheduleGenerateConfirm,

  actionModalEntry,
  onActionModalClose,
  timeSlots,
  onTransferFromAction,
  onRevertTransfer,
  onAbsentFromAction,
  onEditClick,
  onDeleteClick,
  onStudentClickFromAction,
  onTeacherClickFromAction,

  studentDetailStudent,
  onStudentDetailClose,

  addTeacherModalOpen,
  onAddTeacherClose,
  teachers,
  addTeacherExistingIds,
  onAddTeacherSelect,

  editModalOpen,
  onEditModalClose,
  editingEntry,
  students,
  subjects,
  onEditSave,

  addTarget,
  onAddTargetClose,
  onAddSuccess,

  transferModalOpen,
  onTransferModalClose,
  transferringEntry,
  weekStartStr,
  weekEndStr,
  closedDates,
  initialTransferTarget,
  onTransfer,

  teacherDetailOpen,
  onTeacherDetailClose,
  selectedTeacher,

  deleteDialogOpen,
  onDeleteDialogClose,
  deletingEntry,
  onDeleteConfirm,

  removeTeacherConfirm,
  onRemoveTeacherConfirmClose,
  onRemoveTeacherConfirm,
}: ScheduleDialogsProps) {
  const router = useRouter();

  return (
    <>
      <Dialog open={scheduleSettingsOpen} onOpenChange={onScheduleSettingsChange}>
        <DialogContent className="max-w-sm bg-white border border-gray-200">
          <DialogHeader>
            <DialogTitle>座席表の設定</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button
              variant="secondary"
              size="sm"
              className="justify-start"
              onClick={() => {
                onScheduleSettingsChange(false);
                onScheduleGenerateOpen();
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />
              スケジュール生成
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="justify-start"
              onClick={() => {
                onScheduleSettingsChange(false);
                router.push('/settings/time-slots');
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              コマ時間設定
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="justify-start"
              onClick={() => {
                onScheduleSettingsChange(false);
                router.push('/schedule/settings/closed-days');
              }}
            >
              休講日設定
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={scheduleGenerateConfirmOpen}
        onOpenChange={onScheduleGenerateConfirmChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>スケジュールを強制再生成しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {scheduleGenerateLoading
                ? '確認中...'
                : scheduleGenerateHasExisting
                  ? 'この週には既にスケジュールが登録されています。強制的に上書きしますか？'
                  : '通塾日程から、選択中の週のスケジュールを一括生成します。（通常は自動で反映されます）'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onScheduleGenerateConfirmChange(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={onScheduleGenerateConfirm}>
              {scheduleGenerateLoading ? (
                <>
                  <Spinner size="sm" tone="current" className="inline mr-2" />
                  生成中...
                </>
              ) : (
                '生成する'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StudentActionModal
        open={!!actionModalEntry}
        onClose={onActionModalClose}
        entry={actionModalEntry}
        timeSlot={
          actionModalEntry
            ? (timeSlots.find((s) => s.id === actionModalEntry.time_slot_id) ?? null)
            : null
        }
        onTransfer={onTransferFromAction}
        onRevertTransfer={onRevertTransfer}
        onAbsent={onAbsentFromAction}
        onEdit={onEditClick}
        onDelete={onDeleteClick}
        onStudentClick={onStudentClickFromAction}
        onTeacherClick={onTeacherClickFromAction}
      />

      <StudentDetailModal
        isOpen={!!studentDetailStudent}
        student={studentDetailStudent}
        onClose={onStudentDetailClose}
        onEdit={() => {
          onStudentDetailClose();
          router.push('/students');
        }}
      />

      <AddTeacherModal
        open={addTeacherModalOpen}
        onClose={onAddTeacherClose}
        teachers={teachers}
        schoolId={schoolId}
        existingTeacherIds={addTeacherExistingIds}
        onSelect={onAddTeacherSelect}
      />

      <ScheduleEntryModal
        open={editModalOpen}
        onClose={onEditModalClose}
        mode="edit"
        date={editingEntry?.entry_date ?? ''}
        slot={editingEntry?.time_slot ?? null}
        entry={editingEntry}
        teachers={teachers}
        students={students}
        subjects={subjects}
        schoolId={schoolId}
        onSave={onEditSave}
      />

      <AddStudentToSlotModal
        isOpen={!!addTarget}
        onClose={onAddTargetClose}
        date={addTarget?.date ?? ''}
        dayOfWeek={addTarget?.date ? new Date(addTarget.date + 'Z').getUTCDay() : 0}
        timeSlot={
          addTarget
            ? (timeSlots.find((s) => s.id === addTarget.slotId) ?? ({} as ScheduleTimeSlot))
            : ({} as ScheduleTimeSlot)
        }
        teacherId={addTarget?.teacherId ?? ''}
        teacherName={
          addTarget
            ? teachers.find((t) => t.id === addTarget.teacherId)?.display_name ||
              teachers.find((t) => t.id === addTarget.teacherId)?.email ||
              '—'
            : '—'
        }
        schoolId={schoolId}
        subjects={subjects}
        teacherTeachableSubjectIds={
          addTarget
            ? teachers.find((t) => t.id === addTarget.teacherId)?.teachable_subject_ids
            : undefined
        }
        onSuccess={onAddSuccess}
      />

      <TransferModal
        open={transferModalOpen}
        onClose={onTransferModalClose}
        entry={transferringEntry}
        teachers={teachers}
        timeSlots={timeSlots}
        schoolId={schoolId}
        weekStart={weekStartStr}
        weekEnd={weekEndStr}
        closedDates={closedDates}
        initialTargetDate={initialTransferTarget?.date}
        initialTargetSlotId={initialTransferTarget?.slotId}
        onTransfer={onTransfer}
      />

      <TeacherDetailModal
        open={teacherDetailOpen}
        onClose={onTeacherDetailClose}
        teacher={selectedTeacher}
        subjects={subjects}
      />

      <DeleteScheduleEntryModal
        open={deleteDialogOpen}
        onClose={onDeleteDialogClose}
        entry={deletingEntry}
        timeSlot={
          deletingEntry
            ? (timeSlots.find((s) => s.id === deletingEntry.time_slot_id) ?? null)
            : null
        }
        onConfirm={onDeleteConfirm}
      />

      <AlertDialog
        open={!!removeTeacherConfirm}
        onOpenChange={(open) => !open && onRemoveTeacherConfirmClose()}
        overlayClassName="z-[100]"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>講師カードを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTeacherConfirm?.entryCount
                ? `この講師の授業が${removeTeacherConfirm.entryCount}件すべて削除されます。`
                : '講師カードを削除します。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onRemoveTeacherConfirmClose}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRemoveTeacherConfirm}
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a]"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
