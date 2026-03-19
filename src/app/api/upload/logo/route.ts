import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const schoolId = formData.get('schoolId') as string | null;

    if (!file || !schoolId) {
      return NextResponse.json(
        { error: 'file と schoolId は必須です' },
        { status: 400 }
      );
    }

    // ファイルサイズ制限（2MB）
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'ファイルサイズは2MB以下にしてください' },
        { status: 400 }
      );
    }

    // 画像ファイルのみ許可
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: '画像ファイルのみアップロードできます' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // バケットが存在しなければ作成
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.find((b) => b.name === 'public-assets')) {
      await supabaseAdmin.storage.createBucket('public-assets', { public: true });
    }

    // ファイル名を生成（キャッシュバスティング用にタイムスタンプ付加）
    const ext = file.name.split('.').pop() || 'png';
    const fileName = `school-logos/${schoolId}/logo_${Date.now()}.${ext}`;

    // バッファに変換
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 既存のロゴファイルを削除（上書きではなく新ファイル）
    const { data: existingFiles } = await supabaseAdmin.storage
      .from('public-assets')
      .list(`school-logos/${schoolId}`);
    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map((f) => `school-logos/${schoolId}/${f.name}`);
      await supabaseAdmin.storage.from('public-assets').remove(filesToDelete);
    }

    // Supabase Storageにアップロード
    const { error: uploadError } = await supabaseAdmin.storage
      .from('public-assets')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: `アップロードに失敗しました: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 公開URLを取得
    const { data: urlData } = supabaseAdmin.storage
      .from('public-assets')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // schoolsテーブルのlogo_urlを更新
    const { error: updateError } = await supabaseAdmin
      .from('schools')
      .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', schoolId);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json(
        { error: 'ロゴURLの保存に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error('Logo upload error:', error);
    return NextResponse.json(
      { error: 'アップロード処理中にエラーが発生しました' },
      { status: 500 }
    );
  }
}
