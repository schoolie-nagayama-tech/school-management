'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { getSchools } from '@/lib/api/schools';
import { getSubjects } from '@/lib/api/subjects';
import { useAuth } from '@/contexts/AuthContext';
import type { School, Subject } from '@/types/database';

interface MasterDataContextType {
  schools: School[];
  subjects: Subject[];
  schoolsLoading: boolean;
  subjectsLoading: boolean;
  refreshSchools: () => Promise<School[]>;
  refreshSubjects: () => Promise<Subject[]>;
}

const MasterDataContext = createContext<MasterDataContextType | undefined>(undefined);

export function MasterDataProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const fetchedRef = useRef(false);

  const refreshSchools = useCallback(async () => {
    setSchoolsLoading(true);
    try {
      const data = await getSchools();
      setSchools(data);
      return data;
    } catch (err) {
      console.error('MasterData: schools fetch failed', err);
      return [];
    } finally {
      setSchoolsLoading(false);
    }
  }, []);

  const refreshSubjects = useCallback(async () => {
    setSubjectsLoading(true);
    try {
      const data = await getSubjects();
      setSubjects(data);
      return data;
    } catch (err) {
      console.error('MasterData: subjects fetch failed', err);
      return [];
    } finally {
      setSubjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || fetchedRef.current) return;
    fetchedRef.current = true;
    Promise.all([refreshSchools(), refreshSubjects()]);
  }, [authLoading, user, refreshSchools, refreshSubjects]);

  // ログアウト時にリセット
  useEffect(() => {
    if (!user) {
      fetchedRef.current = false;
      setSchools([]);
      setSubjects([]);
      setSchoolsLoading(true);
      setSubjectsLoading(true);
    }
  }, [user]);

  return (
    <MasterDataContext.Provider
      value={{ schools, subjects, schoolsLoading, subjectsLoading, refreshSchools, refreshSubjects }}
    >
      {children}
    </MasterDataContext.Provider>
  );
}

export function useMasterData() {
  const ctx = useContext(MasterDataContext);
  if (!ctx) throw new Error('useMasterData must be used within MasterDataProvider');
  return ctx;
}
