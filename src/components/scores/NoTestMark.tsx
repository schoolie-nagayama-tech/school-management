import { NO_TEST_HINT, NO_TEST_LABEL, NO_TEST_MARK } from '@/lib/scores/scoreInput';

/**
 * 「テストなし」の科目に出す灰色の ×。
 * 0点や未入力（—）と見分けがつくよう、数字ではなく記号を薄い色で出す。
 */
export function NoTestMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`text-text-faint ${className}`}
      title={NO_TEST_LABEL}
      aria-label={NO_TEST_LABEL}
    >
      {NO_TEST_MARK}
    </span>
  );
}

/** 成績表の近くに出す入力のヒント（× の打ち方） */
export function NoTestHint({ className = '' }: { className?: string }) {
  return <p className={`text-xs text-text-muted ${className}`}>{NO_TEST_HINT}</p>;
}
