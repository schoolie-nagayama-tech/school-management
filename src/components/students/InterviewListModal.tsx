'use client';

import { Student } from '@/types/database';
import { Modal } from '@/components/ui';
import { InterviewList } from './InterviewList';

interface InterviewListModalProps {
  student: Student;
  schoolId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function InterviewListModal({ student, schoolId, isOpen, onClose }: InterviewListModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${student.last_name} ${student.first_name} の面談記録`} size="lg">
      <div className="min-h-[400px]">
        <InterviewList studentId={student.id} schoolId={schoolId} />
      </div>
    </Modal>
  );
}
