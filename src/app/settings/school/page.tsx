'use client';

import { useState, useEffect, useRef } from 'react';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  ToastContainer,
  Loading,
  Switch,
} from '@/components/ui';
import Link from 'next/link';
import { getSchool, updateSchool } from '@/lib/api/schools';
import { fetchWithAuth } from '@/lib/api/auth';
import { useToast } from '@/hooks/useToast';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import type { School } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import {
  AI_FEATURE_DESCRIPTIONS,
  AI_FEATURE_KEYS,
  AI_FEATURE_LABELS,
  AI_FEATURE_SENDS,
  type AiFeatureKey,
} from '@/lib/ai/features';
import { ChevronLeft, ImageIcon, X, Plus, MapPin } from 'lucide-react';

/** 緯度経度の入力欄の文字列 → 数値。空は null、範囲外や数字でないものは NaN（保存させない） */
function parseCoord(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

export default function SchoolSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [school, setSchool] = useState<School | null>(null);
  const [notificationEmails, setNotificationEmails] = useState<string[]>([]);
  const [slackMentionId, setSlackMentionId] = useState('');
  const [meetingBookingUrl, setMeetingBookingUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingBookingUrl, setIsSavingBookingUrl] = useState(false);
  /**
   * 最寄り駅（高校までの通学時間の起点）。★生徒の住所は使わず、教室の最寄り駅から測る。
   * 緯度経度は文字列で持つ（手で直している途中の「35.」のような値を消さないため）。
   */
  const [nearestStation, setNearestStation] = useState('');
  const [stationLat, setStationLat] = useState('');
  const [stationLon, setStationLon] = useState('');
  const [isEditingCoords, setIsEditingCoords] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isSavingStation, setIsSavingStation] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * AI機能を、この教室で許しているか（行が無ければOFF）。
   * ★機能ごとに分ける。送るものが違うので、まとめて入切させない
   *   （連絡文のために開けた教室から、生徒の成績まで出てしまう）。
   */
  // ★初期値はキーの配列から組む。キーを足すたびにここも直す作りだと、型エラーで止まる
  const [aiEnabled, setAiEnabled] = useState<Record<AiFeatureKey, boolean>>(() => {
    const init = {} as Record<AiFeatureKey, boolean>;
    for (const key of AI_FEATURE_KEYS) init[key] = false;
    return init;
  });
  /** 切り替えられるのは admin/owner だけ。教室長には状態だけ見せる */
  const [aiCanChange, setAiCanChange] = useState(false);
  const [savingAi, setSavingAi] = useState<AiFeatureKey | null>(null);

  // 教室情報を取得
  useEffect(() => {
    const fetchSchool = async () => {
      try {
        if (!localSchoolId) return;
        const schoolData = await getSchool(localSchoolId);
        if (schoolData) {
          setSchool(schoolData);
          setLogoUrl(schoolData.logo_url || '');
          setSlackMentionId(schoolData.slack_mention_id || '');
          setMeetingBookingUrl(schoolData.meeting_booking_url || '');
          setNearestStation(schoolData.nearest_station || '');
          setStationLat(schoolData.nearest_station_lat?.toString() ?? '');
          setStationLon(schoolData.nearest_station_lon?.toString() ?? '');
          setIsEditingCoords(false);
          // notification_emails 配列を優先、なければ旧フィールドから復元
          if (schoolData.notification_emails && schoolData.notification_emails.length > 0) {
            setNotificationEmails(schoolData.notification_emails);
          } else if (schoolData.notification_email) {
            setNotificationEmails([schoolData.notification_email]);
          } else {
            setNotificationEmails([]);
          }
        }

        // AI機能の入切（3つまとめて1回）。取れなくてもページは壊さない（既定OFFのまま出す）
        try {
          const res = await fetchWithAuth(`/api/ai/feature-setting?school_id=${localSchoolId}`);
          if (res.ok) {
            const json = (await res.json()) as {
              features: Record<AiFeatureKey, boolean>;
              canChange: boolean;
            };
            setAiEnabled(json.features);
            setAiCanChange(json.canChange);
          }
        } catch {
          setAiCanChange(false);
        }
      } catch (error) {
        console.error('Error fetching school:', error);
        toastError('教室情報の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    if (hasPermission) {
      fetchSchool();
    }
  }, [hasPermission, toastError, localSchoolId]);

  // メールアドレスリストを更新
  const updateEmail = (index: number, value: string) => {
    setNotificationEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  };

  const addEmail = () => {
    setNotificationEmails((prev) => [...prev, '']);
  };

  const removeEmail = (index: number) => {
    setNotificationEmails((prev) => prev.filter((_, i) => i !== index));
  };

  // ロゴ画像アップロード
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !school) return;

    if (file.size > 2 * 1024 * 1024) {
      toastError('ファイルサイズは2MB以下にしてください');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toastError('画像ファイルのみアップロードできます');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('schoolId', school.id);

      const res = await fetch('/api/upload/logo', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'アップロードに失敗しました');
      }

      setLogoUrl(json.url);
      // school オブジェクトも更新
      setSchool({ ...school, logo_url: json.url });
      success('ロゴ画像をアップロードしました');
    } catch (err) {
      toastError(getUserErrorMessage(err, 'アップロードに失敗しました'));
    } finally {
      setIsUploading(false);
      // inputをリセット
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ロゴ画像を削除
  const handleLogoRemove = async () => {
    if (!school) return;
    setIsUploading(true);
    try {
      await updateSchool(school.id, { logo_url: null });
      setLogoUrl('');
      setSchool({ ...school, logo_url: null });
      success('ロゴ画像を削除しました');
    } catch (err) {
      toastError(getUserErrorMessage(err, '削除に失敗しました'));
    } finally {
      setIsUploading(false);
    }
  };

  // 面談予約URLを保存
  // ★ 通知設定の保存（handleSave）と分けている理由:
  //   このカード（ポータル表示）はロゴと同じく「保護者に見えるもの」の設定で、
  //   下の通知設定カードとは対象読者が違う。カードごとに保存を閉じておくと、
  //   ロゴを触っただけで通知先まで書き換わるような事故が起きない。
  const handleSaveBookingUrl = async () => {
    if (!school) return;
    setIsSavingBookingUrl(true);
    try {
      // 空欄は「未設定」= null にする（空文字だと自動返信の分岐が truthy になってしまう）。
      const url = meetingBookingUrl.trim() || null;
      await updateSchool(school.id, { meeting_booking_url: url });
      setSchool({ ...school, meeting_booking_url: url });
      setMeetingBookingUrl(url ?? '');
      success('面談予約URLを更新しました');
    } catch (err) {
      toastError(getUserErrorMessage(err, '更新に失敗しました'));
    } finally {
      setIsSavingBookingUrl(false);
    }
  };

  // 駅名から緯度経度を取る（国土地理院の地名検索をサーバー経由で引く）。
  // ★ここでは画面に入れるだけで保存しない。取れた位置を見てから「保存」を押してもらう。
  const handleGeocodeStation = async () => {
    const name = nearestStation.trim();
    if (!name) {
      toastError('駅名を入力してください');
      return;
    }
    setIsGeocoding(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/station-geocode?name=${encodeURIComponent(name)}`
      );
      const json = (await res.json().catch(() => ({}))) as {
        station?: string;
        lat?: number;
        lon?: number;
        error?: string;
      };
      if (!res.ok || json.lat == null || json.lon == null) {
        throw new Error(json.error || '位置を取得できませんでした');
      }
      // 「清瀬駅」と打たれても保存は「清瀬」に揃える（APIが整えた名前を使う）
      if (json.station) setNearestStation(json.station);
      setStationLat(String(json.lat));
      setStationLon(String(json.lon));
      success('位置を取得しました。確かめてから保存してください');
    } catch (err) {
      toastError(getUserErrorMessage(err, '位置を取得できませんでした'));
    } finally {
      setIsGeocoding(false);
    }
  };

  // 最寄り駅を保存
  // ★ほかのカードと保存を分けている理由は handleSaveBookingUrl と同じ（カードごとに閉じる）。
  const handleSaveStation = async () => {
    if (!school) return;
    const station = nearestStation.trim().replace(/駅$/, '') || null;
    const lat = parseCoord(stationLat, -90, 90);
    const lon = parseCoord(stationLon, -180, 180);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      toastError('緯度経度が数字になっていません（緯度は-90〜90、経度は-180〜180）');
      return;
    }
    // ★緯度と経度は片方だけでは使えない。駅名なしの位置も、何の位置か分からなくなるので保存させない
    if ((lat == null) !== (lon == null)) {
      toastError('緯度と経度は両方入れてください');
      return;
    }
    if (!station && lat != null) {
      toastError('駅名を入れてください');
      return;
    }
    setIsSavingStation(true);
    try {
      await updateSchool(school.id, {
        nearest_station: station,
        nearest_station_lat: lat,
        nearest_station_lon: lon,
      });
      setSchool({
        ...school,
        nearest_station: station,
        nearest_station_lat: lat,
        nearest_station_lon: lon,
      });
      setNearestStation(station ?? '');
      setIsEditingCoords(false);
      success(
        station && lat == null
          ? '最寄り駅を保存しました（位置が未設定のため、通学時間はまだ計算されません）'
          : '最寄り駅を保存しました'
      );
    } catch (err) {
      toastError(getUserErrorMessage(err, '保存に失敗しました'));
    } finally {
      setIsSavingStation(false);
    }
  };

  // 通知先メールアドレスを保存
  const handleSave = async () => {
    if (!school) return;

    const filteredEmails = notificationEmails.map((e) => e.trim()).filter(Boolean);

    setIsSubmitting(true);
    try {
      await updateSchool(school.id, {
        notification_emails: filteredEmails,
        // 旧フィールドも先頭アドレスで更新（後方互換）
        notification_email: filteredEmails[0] ?? null,
        slack_mention_id: slackMentionId.trim() || null,
      });

      // 更新後のデータを再取得
      const updatedSchool = await getSchool(school.id);
      if (updatedSchool) {
        setSchool(updatedSchool);
        setNotificationEmails(updatedSchool.notification_emails ?? []);
        setSlackMentionId(updatedSchool.slack_mention_id || '');
      }

      success('通知先メールアドレスを更新しました');
    } catch (error) {
      console.error('Error updating school:', error);
      toastError(getUserErrorMessage(error, '更新に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * AI機能の入切。
   * ★オンにするのは「この教室のデータを外部に出してよい」と決めたときだけ。
   *   失敗したら見た目も戻す（オンに見えているのに送っていない／その逆を作らない）。
   */
  const handleAiChange = async (feature: AiFeatureKey, enabled: boolean) => {
    if (!school) return;
    setSavingAi(feature);
    const before = aiEnabled[feature];
    setAiEnabled((prev) => ({ ...prev, [feature]: enabled }));
    try {
      const res = await fetchWithAuth('/api/ai/feature-setting', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId: school.id, feature, enabled }),
      });
      if (!res.ok) throw new Error('failed');
      success(`${AI_FEATURE_LABELS[feature]}を${enabled ? 'オンにしました' : 'オフにしました'}`);
    } catch {
      setAiEnabled((prev) => ({ ...prev, [feature]: before }));
      toastError('変更できませんでした');
    } finally {
      setSavingAi(null);
    }
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="教室設定">
        <Loading />
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="教室設定">
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="教室設定">
        <Loading />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教室設定">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>

        {isAllSelected && (
          <SchoolSwitcher
            schools={availableSchools}
            selectedSchoolId={localSchoolId}
            onChange={setLocalSchoolId}
          />
        )}

        {/* ロゴ設定 */}
        <Card>
          <CardHeader>
            <CardTitle>ポータル表示</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-text-heading mb-1">ロゴ画像</label>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="ロゴ"
                    className="w-16 h-16 rounded-xl object-cover border border-border bg-surface"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-surface-hover border border-infoorderashed border-border flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-text-faint" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-sm"
                  >
                    {isUploading
                      ? 'アップロード中...'
                      : logoUrl
                        ? '画像を変更'
                        : '画像をアップロード'}
                  </Button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      disabled={isUploading}
                      className="text-xs text-danger hover:text-danger transition-colors disabled:opacity-50"
                    >
                      ロゴを削除
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-text-muted">
                保護者ポータルのヘッダーに表示されます。2MB以下の画像ファイル。
              </p>

              <div className="pt-2 border-t border-border">
                <label className="block text-sm font-medium text-text-heading mb-1">
                  面談予約URL（Googleカレンダー）
                </label>
                <Input
                  type="url"
                  value={meetingBookingUrl}
                  onChange={(e) => setMeetingBookingUrl(e.target.value)}
                  placeholder="https://calendar.app.google/..."
                />
                <p className="mt-2 text-xs text-text-muted">
                  保護者が面談を希望したとき、自動返信にこのURLを載せます。空欄の場合は載せません。
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={handleSaveBookingUrl}
                    disabled={isSavingBookingUrl}
                    className="min-w-[120px]"
                  >
                    {isSavingBookingUrl ? '保存中...' : '保存'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 最寄り駅。★面談で出す「高校までの通学時間」の起点。生徒の住所は使わない */}
        <Card>
          <CardHeader>
            <CardTitle>最寄り駅</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-text-body">
                高校までの通学時間を、この駅を起点に計算します（生徒の住所は使いません）。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  value={nearestStation}
                  onChange={(e) => {
                    setNearestStation(e.target.value);
                    // ★駅名を変えたら前の駅の位置は捨てる。残すと「永山」の名前で別の駅の位置を
                    //   保存でき、通学時間が黙って別の駅から測られてしまう
                    setStationLat('');
                    setStationLon('');
                  }}
                  placeholder="例: 京王永山"
                  maxLength={31}
                  className="max-w-xs"
                  aria-label="最寄り駅"
                />
                <Button
                  variant="secondary"
                  onClick={handleGeocodeStation}
                  disabled={isGeocoding || !nearestStation.trim()}
                  className="text-sm"
                >
                  <MapPin className="w-4 h-4 mr-1" />
                  {isGeocoding ? '取得中...' : '駅名から位置を取得'}
                </Button>
              </div>

              {isEditingCoords ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={stationLat}
                    onChange={(e) => setStationLat(e.target.value)}
                    placeholder="緯度 例: 35.633133"
                    className="max-w-[11rem]"
                    aria-label="緯度"
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={stationLon}
                    onChange={(e) => setStationLon(e.target.value)}
                    placeholder="経度 例: 139.447712"
                    className="max-w-[11rem]"
                    aria-label="経度"
                  />
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  緯度経度:{' '}
                  {stationLat && stationLon ? (
                    <span className="tabular-nums text-text-heading">
                      {stationLat}, {stationLon}
                    </span>
                  ) : (
                    '未設定'
                  )}
                  <button
                    type="button"
                    onClick={() => setIsEditingCoords(true)}
                    className="ml-2 underline hover:text-text-heading transition-colors duration-150"
                  >
                    手で直す
                  </button>
                </p>
              )}
              <p className="text-xs text-text-muted">
                位置は国土地理院の地名検索から取ります。見つからないときは、地図アプリで駅の緯度経度を調べて手で入れてください。
              </p>

              <div className="flex justify-end">
                <Button
                  onClick={handleSaveStation}
                  disabled={isSavingStation}
                  className="min-w-[120px]"
                >
                  {isSavingStation ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>通知設定</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">
                  申込通知先メールアドレス
                </label>

                <div className="space-y-2">
                  {notificationEmails.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => updateEmail(index, e.target.value)}
                        placeholder="manager@example.com"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeEmail(index)}
                        className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors duration-150"
                        title="削除"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {notificationEmails.length === 0 && (
                    <p className="text-sm text-gray-400 py-1">通知先が設定されていません</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={addEmail}
                  className="mt-2 flex items-center gap-1.5 text-sm text-ink hover:text-ink/80 font-medium transition-colors duration-150"
                >
                  <Plus className="w-4 h-4" />
                  メールアドレスを追加
                </button>

                <p className="mt-2 text-sm text-text-body">
                  フォームから申込があった際に通知を受け取るメールアドレスです。複数設定すると全員に通知されます。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">
                  Slack担当者メンバーID
                </label>
                <Input
                  type="text"
                  value={slackMentionId}
                  onChange={(e) => setSlackMentionId(e.target.value)}
                  placeholder="U012345ABC"
                  className="max-w-xs"
                />
                <p className="mt-2 text-sm text-text-body">
                  教材管理の通知でメンションする担当者のSlackメンバーIDです。Slackのプロフィール →
                  「メンバーIDをコピー」で取得できます。
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isSubmitting} className="min-w-[120px]">
                  {isSubmitting ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI機能の入切。★費用の話ではなく、外部に出してよいかの歯止め。
            切り替えられるのは admin/owner だけで、教室長には状態だけ見せる。
            ★1機能1行にして、何が外に出るのかをスイッチの真横に書く。
              まとめて「AI」1つにすると、連絡文のために入れた栓から成績まで出る。 */}
        <Card>
          <CardHeader>
            <CardTitle>AIを使う機能</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-body">
              オンにした機能だけが、その教室のデータをAIの提供元（Anthropic）へ送ります。
              オフの教室では送信そのものが起きず、画面にもバーやカードが出ません。
              プライバシーポリシーのリーガルチェックが終わるまでは、確認できた教室だけをオンにしてください。
            </p>
            {!aiCanChange && (
              <p className="mt-2 text-xs text-text-muted">
                切り替えられるのはシステム管理者とエリアマネージャーのみです。
              </p>
            )}

            <div className="mt-4 flex flex-col divide-y divide-border border-t border-border">
              {AI_FEATURE_KEYS.map((key) => (
                <div key={key} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text-heading">{AI_FEATURE_LABELS[key]}</p>
                    <p className="mt-1 text-sm text-text-body">{AI_FEATURE_DESCRIPTIONS[key]}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      外に出るもの:{' '}
                      <b className="font-bold text-text-heading">{AI_FEATURE_SENDS[key]}</b>
                    </p>
                  </div>
                  <div className="shrink-0 pt-1">
                    <Switch
                      checked={aiEnabled[key]}
                      onCheckedChange={(next) => handleAiChange(key, next)}
                      disabled={!aiCanChange || savingAi !== null}
                      aria-label={AI_FEATURE_LABELS[key]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
