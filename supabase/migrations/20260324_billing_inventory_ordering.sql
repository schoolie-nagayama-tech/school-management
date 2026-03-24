-- ==============================
-- 在庫管理 (Inventory Management)
-- ==============================

CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  unit text NOT NULL DEFAULT '冊',
  stock_quantity integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_school_id ON materials(school_id);
CREATE INDEX IF NOT EXISTS idx_materials_school_active ON materials(school_id, is_active);

CREATE TABLE IF NOT EXISTS material_stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('in', 'out', 'adjust')),
  quantity integer NOT NULL,
  reason text,
  related_order_id uuid,
  related_student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  performed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_txns_material ON material_stock_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_txns_school ON material_stock_transactions(school_id);

-- ==============================
-- 発注管理 (Ordering Management)
-- ==============================

CREATE TABLE IF NOT EXISTS material_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'delivered', 'distributed', 'cancelled')),
  ordered_at timestamptz,
  delivered_at timestamptz,
  distributed_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_school ON material_orders(school_id);
CREATE INDEX IF NOT EXISTS idx_orders_student ON material_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_material ON material_orders(material_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON material_orders(school_id, status);

-- FK from stock_transactions to orders
ALTER TABLE material_stock_transactions
  ADD CONSTRAINT fk_stock_txns_order
  FOREIGN KEY (related_order_id) REFERENCES material_orders(id) ON DELETE SET NULL;

-- ==============================
-- 請求管理 (Billing Management)
-- ==============================

CREATE TABLE IF NOT EXISTS billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_periods_school ON billing_periods(school_id);

CREATE TABLE IF NOT EXISTS billing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  billing_period_id uuid NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'free' CHECK (source_type IN ('free', 'form_charged', 'order')),
  source_form_response_id uuid,
  source_order_id uuid REFERENCES material_orders(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_items_period ON billing_items(billing_period_id);
CREATE INDEX IF NOT EXISTS idx_billing_items_school ON billing_items(school_id);

CREATE TABLE IF NOT EXISTS student_billings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  billing_item_id uuid NOT NULL REFERENCES billing_items(id) ON DELETE CASCADE,
  is_billed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, billing_item_id)
);

CREATE INDEX IF NOT EXISTS idx_student_billings_school ON student_billings(school_id);
CREATE INDEX IF NOT EXISTS idx_student_billings_student ON student_billings(student_id);
CREATE INDEX IF NOT EXISTS idx_student_billings_item ON student_billings(billing_item_id);

-- ==============================
-- RLS Policies
-- ==============================

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_billings ENABLE ROW LEVEL SECURITY;

-- Materials
CREATE POLICY "materials_all" ON materials FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- Stock transactions
CREATE POLICY "stock_txns_all" ON material_stock_transactions FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- Orders
CREATE POLICY "orders_all" ON material_orders FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- Billing periods
CREATE POLICY "billing_periods_all" ON billing_periods FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- Billing items
CREATE POLICY "billing_items_all" ON billing_items FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- Student billings
CREATE POLICY "student_billings_all" ON student_billings FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- ==============================
-- Updated_at triggers
-- ==============================

CREATE OR REPLACE TRIGGER update_materials_updated_at
  BEFORE UPDATE ON materials FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_material_orders_updated_at
  BEFORE UPDATE ON material_orders FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_billing_periods_updated_at
  BEFORE UPDATE ON billing_periods FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_billing_items_updated_at
  BEFORE UPDATE ON billing_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_student_billings_updated_at
  BEFORE UPDATE ON student_billings FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
