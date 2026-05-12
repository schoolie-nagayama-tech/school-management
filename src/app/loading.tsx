import { Loading as LoadingSpinner } from '@/components/ui';

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}
