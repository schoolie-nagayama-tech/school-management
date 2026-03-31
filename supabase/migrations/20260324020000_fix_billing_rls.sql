-- =============================================
-- RLS修正: billing/inventory/ordering テーブル
-- 問題: FOR ALL に TO authenticated と WITH CHECK が不足
-- =============================================

-- Materials
DROP POLICY IF EXISTS "materials_all" ON materials;
CREATE POLICY "materials_allow_all_auth" ON materials
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stock transactions
DROP POLICY IF EXISTS "stock_txns_all" ON material_stock_transactions;
CREATE POLICY "stock_txns_allow_all_auth" ON material_stock_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Orders
DROP POLICY IF EXISTS "orders_all" ON material_orders;
CREATE POLICY "orders_allow_all_auth" ON material_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Billing periods
DROP POLICY IF EXISTS "billing_periods_all" ON billing_periods;
CREATE POLICY "billing_periods_allow_all_auth" ON billing_periods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Billing items
DROP POLICY IF EXISTS "billing_items_all" ON billing_items;
CREATE POLICY "billing_items_allow_all_auth" ON billing_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Student billings
DROP POLICY IF EXISTS "student_billings_all" ON student_billings;
CREATE POLICY "student_billings_allow_all_auth" ON student_billings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
