-- =====================================================
-- 権限管理機能 スキーマ
-- =====================================================

-- 1. ユーザープロファイル（auth.usersの拡張）
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'manager', 'teacher', 'parent')),
  is_active BOOLEAN DEFAULT TRUE,
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. ユーザーと教室の紐付け（多対多）
CREATE TABLE IF NOT EXISTS user_schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, school_id)
);

-- 3. 招待トークン（メール招待用）
CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'manager', 'teacher', 'parent')),
  school_ids UUID[] DEFAULT '{}',  -- 紐付ける教室ID（複数可）
  token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_schools_user ON user_schools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_schools_school ON user_schools(school_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);

-- RLS ポリシー
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

-- user_profiles: 自分のプロファイルは読み書き可、他人は管理者のみ読み取り可
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  );

CREATE POLICY "Admins can insert profiles" ON user_profiles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
    OR NOT EXISTS (SELECT 1 FROM user_profiles)  -- 最初のユーザー作成時
  );

CREATE POLICY "Admins can update all profiles" ON user_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  );

-- user_schools: 管理者のみ操作可
CREATE POLICY "Admins can manage user_schools" ON user_schools
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  );

CREATE POLICY "Users can view own schools" ON user_schools
  FOR SELECT USING (auth.uid() = user_id);

-- user_invitations: 管理者のみ操作可
CREATE POLICY "Admins can manage invitations" ON user_invitations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  );

-- 招待トークンは誰でも読み取り可（登録時に使用）
CREATE POLICY "Anyone can view invitations by token" ON user_invitations
  FOR SELECT USING (true);

-- =====================================================
-- 既存テーブルのRLS更新
-- =====================================================

-- students: 教室に紐付いたユーザーのみアクセス可
DROP POLICY IF EXISTS "Enable all for students" ON students;

CREATE POLICY "Users can access students in their schools" ON students
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.role = 'admin'
        OR EXISTS (
          SELECT 1 FROM user_schools us
          WHERE us.user_id = auth.uid()
          AND us.school_id = students.school_id
        )
      )
    )
  );
