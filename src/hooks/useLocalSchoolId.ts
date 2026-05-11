'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { School } from '@/types/database';

interface UseLocalSchoolIdReturn {
  localSchoolId: string;
  setLocalSchoolId: (id: string) => void;
  isAllSelected: boolean;
  availableSchools: School[];
}

export function useLocalSchoolId(): UseLocalSchoolIdReturn {
  const { selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { schools } = useMasterData();
  const [localSchoolId, setLocalSchoolId] = useState<string>('');

  const isAllSelected = selectedSchoolId === 'all';
  const selectedIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);

  const availableSchools = useMemo(
    () => schools.filter((s) => selectedIds.includes(s.id)),
    [schools, selectedIds]
  );

  useEffect(() => {
    if (isAllSelected) {
      if (selectedIds.length > 0 && !selectedIds.includes(localSchoolId)) {
        setLocalSchoolId(selectedIds[0]);
      }
    } else if (selectedSchoolId) {
      setLocalSchoolId(selectedSchoolId);
    }
  }, [isAllSelected, selectedSchoolId, selectedIds, localSchoolId]);

  const handleSetLocalSchoolId = useCallback((id: string) => {
    setLocalSchoolId(id);
  }, []);

  return {
    localSchoolId,
    setLocalSchoolId: handleSetLocalSchoolId,
    isAllSelected,
    availableSchools,
  };
}
