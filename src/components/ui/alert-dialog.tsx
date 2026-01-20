'use client';

import { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog';
import { Button } from './Button';

interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface AlertDialogHeaderProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogHeader({ children, className = '' }: AlertDialogHeaderProps) {
  return <DialogHeader className={className}>{children}</DialogHeader>;
}

interface AlertDialogTitleProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogTitle({ children, className = '' }: AlertDialogTitleProps) {
  return <DialogTitle className={className}>{children}</DialogTitle>;
}

interface AlertDialogDescriptionProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogDescription({ children, className = '' }: AlertDialogDescriptionProps) {
  return <DialogDescription className={className}>{children}</DialogDescription>;
}

interface AlertDialogFooterProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogFooter({ children, className = '' }: AlertDialogFooterProps) {
  return <DialogFooter className={className}>{children}</DialogFooter>;
}

interface AlertDialogActionProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function AlertDialogAction({ children, onClick, className = '' }: AlertDialogActionProps) {
  return (
    <Button onClick={onClick} className={className}>
      {children}
    </Button>
  );
}

interface AlertDialogCancelProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function AlertDialogCancel({ children, onClick, className = '' }: AlertDialogCancelProps) {
  return (
    <Button variant="secondary" onClick={onClick} className={className}>
      {children}
    </Button>
  );
}
