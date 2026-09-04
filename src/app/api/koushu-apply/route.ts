/**
 * 講習申込フォーム（保護者向け・公開経路）の送信エンドポイント。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-3・§15-4・§15-7・§16-2（決定27〜35・44・49）。
 * 入出力契約: `src/types/koushu-apply.ts`。
 *
 * 未ログインの保護者から直接叩かれる公開経路なので、service role クライアントで RLS を
 * バイパスして書く（`src/app/api/seasonal-shift-student/submit/route.ts` と同じパターン）。
 * 申込コンテキストの解決（トークン/生徒コード → 生徒×講習期間、公開判定）は
 * `src/lib/api/koushuApply.ts`（ローダーと共通）に一本化している。
 */
import { NextRequest, NextResponse } from 'next/server';
import { normalizeKomaBySubject, type KomaSpec } from '@/lib/utils/komaBySubject';
import {
  buildShiftSlotRows,
  isDuplicateResubmission,
  isDurationAllowedForGrade,
  isNonNegativeInteger,
  type ExistingEnrollmentSnapshot,
} from '@/lib/utils/koushuApplyPure';
import {
  derivePeriodInfo,
  loadCourses,
  loadOpenSlotsForSetting,
  loadProposalLines,
  loadSubjectIdsForGradeCategory,
  resolveApplyContext,
  resolveShiftSettingId,
  type AnyDb,
  type ApplyContext,
} from '@/lib/api/koushuApply';
import {
  lookupUnitPrice,
  type ApplyDuration,
  type ApplyRatio,
  type KoushuApplyRequest,
} from '@/types/koushu-apply';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/** 公開判定・トークン失効・生徒未発見のいずれも 404 にまとめる（決定29・§12: 存在の出し分けをしない） */
function notAvailableResponse() {
  return NextResponse.json(
    { ok: false, message: 'このお申込みフォームは現在ご利用いただけません。' },
    { status: 404 }
  );
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: KoushuApplyRequest;
  try {
    body = (await request.json()) as KoushuApplyRequest;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/koushu-apply',
    });
    return badRequest('リクエストの形式が不正です。');
  }

  if (
    !Array.isArray(body.subjects) ||
    !Array.isArray(body.courses) ||
    !Array.isArray(body.unavailableSlots)
  ) {
    return badRequest('リクエストの形式が不正です。');
  }

  // ---- 1. 申込コンテキストの解決（公開期間チェック含む。§10-3手順1・決定29） ----
  const resolveParams = body.token
    ? ({ kind: 'token', token: body.token } as const)
    : body.schoolCode && body.studentCode
      ? ({
          kind: 'studentCode',
          schoolCode: body.schoolCode,
          studentCode: body.studentCode,
        } as const)
      : null;
  if (!resolveParams) {
    return badRequest('生徒を特定する情報がありません。');
  }

  const resolved = await resolveApplyContext(resolveParams);
  if (!resolved.ok) {
    // not_found / not_published / revoked のいずれも 404（存在有無を保護者側に漏らさない）
    return notAvailableResponse();
  }
  const ctx: ApplyContext = resolved.ctx;
  const { grade, gradeLabel, gradeCategory, startDate, endDate, weeks, priceTable } =
    derivePeriodInfo(ctx);
  const db: AnyDb = ctx.db;

  // ---- 2. 既存申込の確認（決定30・35: 再提出は教室許可制／10分以内の同一内容は冪等化） ----
  const { data: existingRows } = await db
    .from('koushu_enrollments')
    .select('course_id, formation, koma_by_subject, created_at')
    .eq('school_id', ctx.schoolId)
    .eq('season', ctx.season)
    .eq('student_id', ctx.studentId);
  const existingSnapshots: ExistingEnrollmentSnapshot[] = (
    (existingRows ?? []) as Array<{
      course_id: string | null;
      koma_by_subject: Record<string, number | KomaSpec> | null;
      created_at: string;
    }>
  ).map((r) => {
    const normalized = normalizeKomaBySubject(r.koma_by_subject);
    const komaBySubject: Record<string, { koma: number; ratio: number; duration: number }> = {};
    for (const [sid, spec] of Object.entries(normalized)) {
      komaBySubject[sid] = { koma: spec.koma, ratio: spec.ratio, duration: spec.duration };
    }
    return {
      courseId: r.course_id,
      createdAt: r.created_at,
      komaBySubject: r.course_id === null ? komaBySubject : null,
    };
  });

  if (existingSnapshots.length > 0) {
    if (isDuplicateResubmission(existingSnapshots, body, Date.now())) {
      // 二重クリック等による同一内容の再送信。書き込みはせず成功扱いで返す（決定35）。
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      {
        ok: false,
        message: '既にお申込みいただいています。変更・キャンセルは教室までご連絡ください。',
      },
      { status: 409 }
    );
  }

  // ---- 3. バリデーション（すべて400。§10-3手順5・決定17・25・26・49） ----
  const proposals = await loadProposalLines(ctx, {
    startDate,
    endDate,
    weeks,
    gradeLabel,
    priceTable,
  });
  const proposalBySubject = new Map(proposals.map((p) => [p.subjectId, p]));
  const allowedSubjectIds = await loadSubjectIdsForGradeCategory(db, gradeCategory);
  const todayIso = new Date().toISOString().slice(0, 10);
  const courses = await loadCourses(ctx, { grade, startDate, endDate, todayIso });
  const courseById = new Map(courses.map((c) => [c.courseId, c]));

  const komaBySubjectSnapshot: Record<string, KomaSpec> = {};

  for (const s of body.subjects) {
    if (typeof s.subjectId !== 'string' || !s.subjectId)
      return badRequest('科目が指定されていません。');
    if (!isNonNegativeInteger(s.koma)) return badRequest('コマ数が不正です。');
    if (s.ratio !== 1 && s.ratio !== 2) return badRequest('授業形式が不正です。');
    if (s.duration !== 45 && s.duration !== 90) return badRequest('授業時間が不正です。');
    const ratio: ApplyRatio = s.ratio;
    const duration: ApplyDuration = s.duration;

    const proposalLine = proposalBySubject.get(s.subjectId);
    let unitPrice: number | null;
    let regularKoma: number;

    if (proposalLine) {
      // 提案由来の科目は形式（1対1/1対2・分数）を教室が確定済み（決定14）。保護者側からの
      // 変更申し出は無い前提だが、API直叩き等で改ざんされた値が来ても弾けるよう照合する。
      if (proposalLine.ratio !== ratio || proposalLine.duration !== duration) {
        return badRequest('提案済みの科目は授業形式を変更できません。');
      }
      if (proposalLine.unitPrice == null) {
        return badRequest(
          `${proposalLine.subjectName}は単価が未設定のため申込めません。教室にご確認ください。`
        );
      }
      unitPrice = proposalLine.unitPrice;
      regularKoma = proposalLine.regularKoma;
    } else {
      // 保護者が追加した科目（決定25・48）: 形式は保護者が選べるが、学年帯・45分ルールは検証する。
      if (!allowedSubjectIds.has(s.subjectId)) {
        return badRequest('指定された科目が見つかりません。');
      }
      if (!isDurationAllowedForGrade(grade, duration)) {
        return badRequest('45分授業は小1〜小4のみ選択できます。');
      }
      unitPrice = lookupUnitPrice(priceTable, gradeLabel, ratio, duration);
      if (unitPrice == null) {
        return badRequest('選択した形式では申込めません（単価未設定）。');
      }
      // 提案外に追加した科目は通常授業を取っていない前提＝全コマが対象（決定25）。
      regularKoma = 0;
    }

    if (s.koma > 0) {
      komaBySubjectSnapshot[s.subjectId] = {
        koma: s.koma,
        ratio,
        duration,
        unitPrice,
        regularKoma,
      };
    }
  }

  const requestedCourseIds = Array.from(new Set(body.courses.map((c) => c.courseId)));
  for (const courseId of requestedCourseIds) {
    if (typeof courseId !== 'string' || !courseId) return badRequest('講習が指定されていません。');
    const course = courseById.get(courseId);
    if (!course) return badRequest('指定された講習が見つかりません。');
    if (course.remainingCount <= 0) {
      return badRequest(`${course.name}はすでに開催が終了しています。`);
    }
  }

  // ---- 4. 書き込み（§10-3手順3・4） ----
  const nowIso = new Date().toISOString();
  const upsertOptions = { onConflict: 'school_id,season,student_id,formation,course_id' };

  // 4-1. 科目ベース1行（formation='individual', course_id=null）
  const subjectEntries = Object.entries(komaBySubjectSnapshot);
  if (subjectEntries.length > 0) {
    const komaCount = subjectEntries.reduce((sum, [, spec]) => sum + spec.koma, 0);
    const { error } = await db.from('koushu_enrollments').upsert(
      {
        school_id: ctx.schoolId,
        season: ctx.season,
        course_id: null,
        student_id: ctx.studentId,
        formation: INDIVIDUAL_FORMATION,
        koma_count: komaCount,
        subject_ids: subjectEntries.map(([sid]) => sid),
        koma_by_subject: komaBySubjectSnapshot,
        updated_at: nowIso,
      },
      upsertOptions
    );
    if (error) {
      console.error('[koushu-apply] 科目申込の保存に失敗:', error);
      return NextResponse.json(
        { ok: false, message: '申込の保存に失敗しました。' },
        { status: 500 }
      );
    }
  }

  // 4-2. コースは1コースごとに1行（決定38・39）
  for (const courseId of requestedCourseIds) {
    const course = courseById.get(courseId);
    if (!course) continue; // 上のバリデーションで存在確認済み
    const { error } = await db.from('koushu_enrollments').upsert(
      {
        school_id: ctx.schoolId,
        season: ctx.season,
        course_id: courseId,
        student_id: ctx.studentId,
        formation: course.formation,
        koma_count: course.remainingCount,
        subject_ids: [],
        koma_by_subject: {},
        updated_at: nowIso,
      },
      upsertOptions
    );
    if (error) {
      console.error('[koushu-apply] コース申込の保存に失敗:', error);
      return NextResponse.json(
        { ok: false, message: '申込の保存に失敗しました。' },
        { status: 500 }
      );
    }
  }

  // 4-3. 通塾可能日程（決定15・§9-3: 開講枠の全量ぶん行を書く）
  const settingId = await resolveShiftSettingId(db, ctx.schoolId, startDate, endDate);
  if (settingId) {
    const openSlots = await loadOpenSlotsForSetting(db, settingId, startDate, endDate);
    const slotRows = buildShiftSlotRows(openSlots, body.unavailableSlots);

    const { data: existingSubmission } = await db
      .from('seasonal_shift_student_submissions')
      .select('id')
      .eq('setting_id', settingId)
      .eq('student_id', ctx.studentId)
      .maybeSingle();

    let submissionId: string;
    if (existingSubmission) {
      submissionId = existingSubmission.id;
      const { error } = await db
        .from('seasonal_shift_student_submissions')
        .update({
          submitter_email: body.submitterEmail || null,
          submitter_name: body.submitterName || null,
          submitted_at: nowIso,
        })
        .eq('id', submissionId);
      if (error) {
        console.error('[koushu-apply] 可能表提出の更新に失敗:', error);
        return NextResponse.json(
          { ok: false, message: '申込の保存に失敗しました。' },
          { status: 500 }
        );
      }
      await db
        .from('seasonal_shift_student_submission_slots')
        .delete()
        .eq('submission_id', submissionId);
    } else {
      const { data: created, error } = await db
        .from('seasonal_shift_student_submissions')
        .insert({
          setting_id: settingId,
          school_id: ctx.schoolId,
          student_id: ctx.studentId,
          submitter_email: body.submitterEmail || null,
          submitter_name: body.submitterName || null,
        })
        .select('id')
        .single();
      if (error || !created) {
        console.error('[koushu-apply] 可能表提出の作成に失敗:', error);
        return NextResponse.json(
          { ok: false, message: '申込の保存に失敗しました。' },
          { status: 500 }
        );
      }
      submissionId = (created as { id: string }).id;
    }

    if (slotRows.length > 0) {
      const { error: slotErr } = await db
        .from('seasonal_shift_student_submission_slots')
        .insert(slotRows.map((r) => ({ ...r, submission_id: submissionId })));
      if (slotErr) {
        console.error('[koushu-apply] 可能表スロットの保存に失敗:', slotErr);
        return NextResponse.json(
          { ok: false, message: '申込の保存に失敗しました。' },
          { status: 500 }
        );
      }
    }
  } else {
    // この期間に紐づく講習シフト設定（開講枠）が無い＝聞くべき枠が無い。非致命的として続行する。
    console.warn(
      `[koushu-apply] 開講枠設定が見つからないため可能表の提出をスキップしました: school=${ctx.schoolId}, season=${ctx.season}`
    );
  }

  return NextResponse.json({ ok: true });
}
