'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getSchools } from '@/lib/api/schools';
import type { School } from '@/types/database';

export function SchoolSelector() {
  const router = useRouter();
  const { schoolIds, selectedSchoolId, setSelectedSchoolId } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSchools = async () => {
      try {
        const allSchools = await getSchools();
        // ユーザーが担当している教室のみをフィルタ
        const userSchools = allSchools.filter(school => schoolIds.includes(school.id));
        setSchools(userSchools);
      } catch (error) {
        console.error('Error loading schools:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (schoolIds.length > 0) {
      loadSchools();
    }
  }, [schoolIds]);

  const handleSelect = (schoolId: string | 'all') => {
    setSelectedSchoolId(schoolId);
    router.push('/students');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fffffe]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#2a2a2a]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (schools.length === 0) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fffffe] p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-[#0d0d0d] p-6 shadow-lg">
        <h2 className="text-xl font-bold text-[#0d0d0d] mb-6 text-center">
          教室を選択してください
        </h2>
        
        <div className="space-y-3">
          {/* すべての教室を表示するオプション */}
          {schools.length > 1 && (
            <button
              onClick={() => handleSelect('all')}
              className={`w-full px-4 py-3 rounded-lg border-2 transition-colors text-left ${
                selectedSchoolId === 'all'
                  ? 'border-[#ff8e3c] bg-[#ff8e3c]/10'
                  : 'border-[#0d0d0d] hover:bg-[#eff0f3]'
              }`}
            >
              <div className="font-bold text-[#0d0d0d]">すべての教室</div>
              <div className="text-sm text-[#2a2a2a] mt-1">
                担当しているすべての教室の情報を表示します
              </div>
            </button>
          )}

          {/* 各教室の選択ボタン */}
          {schools.map(school => (
            <button
              key={school.id}
              onClick={() => handleSelect(school.id)}
              className={`w-full px-4 py-3 rounded-lg border-2 transition-colors text-left ${
                selectedSchoolId === school.id
                  ? 'border-[#ff8e3c] bg-[#ff8e3c]/10'
                  : 'border-[#0d0d0d] hover:bg-[#eff0f3]'
              }`}
            >
              <div className="font-bold text-[#0d0d0d]">
                {school.code === 'DEFAULT' ? 'デフォルト' : school.name}
              </div>
              {school.code && school.code !== 'DEFAULT' && (
                <div className="text-sm text-[#2a2a2a] mt-1">コード: {school.code}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
