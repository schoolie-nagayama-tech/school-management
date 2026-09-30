'use client';

import { useMemo } from 'react';
import { StudentTextbooksManager, useStudentTextbooksManager } from '../StudentTextbooksManager';

interface TextbooksSectionProps {
  studentId: string;
  /** 生徒の所属校（手動追加する教材の school_id になる） */
  schoolId: string;
}

/**
 * 生徒ハブの「教材」セクションの本文（見出しとカードは page 側の HubSection が持つ）。
 *
 * 教室長は生徒一覧から直接ハブへ来るので、モーダルの基本情報タブにあった教材の操作
 * （所持・進行表で管理のチェック、手動追加、配布済みにする、削除）をここでも同じフックと部品で出す。
 * ★フック・部品（StudentTextbooksManager.tsx）はモーダルと共用。写さない。講師が使うモーダルと挙動がずれるため。
 * ★「所持教材」の見出しは HubSection の「教材」と重なるので出さない（hideTitle）。
 *   「進行表で管理中」「未分類」の小見出しは区別に要るので残る。
 * ★色は部品の既定のまま（配布済みにするボタンだけが濃色＝対応が要るもの）。ハブ用に色を足さない。
 */
export function TextbooksSection({ studentId, schoolId }: TextbooksSectionProps) {
  // フックは student をオブジェクトの同一性で見て取り直すので、ID が変わったときだけ作り直す
  const student = useMemo(() => ({ id: studentId, school_id: schoolId }), [studentId, schoolId]);
  const manager = useStudentTextbooksManager({ student, enabled: true });

  return (
    // 部品はフラグメントで3ブロック（所持・進行表で管理中・未分類）を返すので、間隔はここで付ける
    <div className="flex flex-col gap-5">
      <StudentTextbooksManager manager={manager} hideTitle />
    </div>
  );
}
