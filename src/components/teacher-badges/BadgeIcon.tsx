'use client';

import { Star, Trophy, Award, Target, BookOpen, GraduationCap, Zap, Shield, Heart, Flag, Rocket, Gem, Crown, Medal, FileCheck, Compass, Key, Puzzle, CircleCheck } from 'lucide-react';

export function BadgeIcon({ icon, size = 24, className = '' }: { icon: string; size?: number; className?: string }) {
  const props = { size, className, strokeWidth: 1.5 };
  switch (icon) {
    case 'star': return <Star {...props} />;
    case 'trophy': return <Trophy {...props} />;
    case 'award': return <Award {...props} />;
    case 'target': return <Target {...props} />;
    case 'book': return <BookOpen {...props} />;
    case 'graduation': return <GraduationCap {...props} />;
    case 'lightning': return <Zap {...props} />;
    case 'shield': return <Shield {...props} />;
    case 'heart': return <Heart {...props} />;
    case 'flag': return <Flag {...props} />;
    case 'rocket': return <Rocket {...props} />;
    case 'gem': return <Gem {...props} />;
    case 'crown': return <Crown {...props} />;
    case 'medal': return <Medal {...props} />;
    case 'certificate': return <FileCheck {...props} />;
    case 'compass': return <Compass {...props} />;
    case 'key': return <Key {...props} />;
    case 'puzzle': return <Puzzle {...props} />;
    default: return <CircleCheck {...props} />;
  }
}
