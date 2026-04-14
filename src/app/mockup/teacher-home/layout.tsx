import { Zen_Kaku_Gothic_New, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

const zen = Zen_Kaku_Gothic_New({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-zen',
  display: 'swap',
});

const jbMono = JetBrains_Mono({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export default function MockupLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${zen.variable} ${jbMono.variable} th-root`}>
      {children}
    </div>
  );
}
