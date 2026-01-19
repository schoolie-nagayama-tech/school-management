import Link from 'next/link';

interface AccessDeniedProps {
  message?: string;
}

export default function AccessDenied({ 
  message = 'このページにアクセスする権限がありません' 
}: AccessDeniedProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-[#d9376e]/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-[#d9376e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#0d0d0d] mb-2">アクセス拒否</h2>
        <p className="text-[#2a2a2a] mb-6">{message}</p>
        <Link
          href="/students"
          className="inline-block px-6 py-3 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors"
        >
          生徒一覧に戻る
        </Link>
      </div>
    </div>
  );
}
