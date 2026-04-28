'use client';

import Link from 'next/link';
import type { Form } from '@/types/database';

interface PublicFormListProps {
  forms: Form[];
  schoolCode: string;
}

export function PublicFormList({ forms, schoolCode }: PublicFormListProps) {
  if (forms.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[#4b5563] text-lg">現在受付中のお申込みはありません</p>
      </div>
    );
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <div className="space-y-4">
      {forms.map((form) => {
        const endDate = formatDate(form.publish_end);
        return (
          <div
            key={form.id}
            className="bg-white rounded-xl border border-[#e5e7eb] p-6 hover:shadow-lg transition-shadow duration-150"
          >
            <h3 className="text-xl font-bold text-[#1f2937] mb-2">{form.title}</h3>
            {form.description && (
              <p className="text-[#4b5563] mb-4 line-clamp-2">{form.description}</p>
            )}
            <div className="flex items-center justify-between">
              {endDate && (
                <p className="text-sm text-[#4b5563]/60">{endDate}まで</p>
              )}
              <Link
                href={`/portal/${schoolCode}/${form.slug}`}
                className="px-6 py-3 bg-[#3b82f6] text-white font-semibold rounded-lg hover:bg-[#60a5fa] transition-colors min-h-[44px] flex items-center justify-center"
              >
                回答する
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
