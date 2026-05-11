'use client';

import { ReactNode } from 'react';
import type { TdHTMLAttributes } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`w-full overflow-auto ${className}`}>
      <table className="w-full border-collapse">
        {children}
      </table>
    </div>
  );
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

export function TableHeader({ children, className = '' }: TableHeaderProps) {
  return (
    <thead className={className}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className = '' }: TableBodyProps) {
  return (
    <tbody className={className}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function TableRow({ children, className = '', onClick }: TableRowProps) {
  return (
    <tr
      className={`border-b border-border/20 ${onClick ? 'cursor-pointer hover:bg-surface-hover' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps {
  children?: ReactNode;
  className?: string;
}

export function TableHead({ children, className = '' }: TableHeadProps) {
  return (
    <th className={`px-4 py-3 text-left text-sm font-semibold text-text-heading bg-surface-hover ${className}`}>
      {children}
    </th>
  );
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
  className?: string;
}

export function TableCell({ children, className = '', ...rest }: TableCellProps) {
  return (
    <td className={`px-4 py-3 text-sm text-text-body ${className}`} {...rest}>
      {children ?? null}
    </td>
  );
}
