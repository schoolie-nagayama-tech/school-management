import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

interface AccessDeniedProps {
  message?: string;
}

export default function AccessDenied({ 
  message = 'このページにアクセスする権限がありません' 
}: AccessDeniedProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-[#ef4444]/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-[#ef4444]" />
        </div>
        <h2 className="text-2xl font-bold text-[#1f2937] mb-2">アクセス拒否</h2>
        <p className="text-[#4b5563] mb-6">{message}</p>
        <Link
          href="/students"
          className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors duration-150"
        >
          生徒一覧に戻る
        </Link>
      </div>
    </div>
  );
}
