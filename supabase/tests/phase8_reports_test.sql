-- Run against a local Supabase database as postgres:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/phase8_reports_test.sql
-- Verifies store isolation and that report RPCs do not expose owner-only figures to staff.
BEGIN;
CREATE TEMP TABLE phase8_test_ids (store_id uuid, outsider_store_id uuid, owner_id uuid, staff_id uuid) ON COMMIT DROP;
GRANT SELECT ON phase8_test_ids TO authenticated;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_store uuid;
  v_other_store uuid;
BEGIN
  INSERT INTO auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    VALUES (v_owner, 'authenticated', 'authenticated', v_owner::text || '@phase8.test', '', now(), now(), now()),
           (v_staff, 'authenticated', 'authenticated', v_staff::text || '@phase8.test', '', now(), now(), now());
  INSERT INTO public.stores(name) VALUES ('اختبار تقارير') RETURNING id INTO v_store;
  INSERT INTO public.stores(name) VALUES ('متجر آخر') RETURNING id INTO v_other_store;
  INSERT INTO public.store_members(store_id,user_id,role) VALUES (v_store,v_owner,'owner'),(v_store,v_staff,'staff');
  INSERT INTO phase8_test_ids VALUES (v_store,v_other_store,v_owner,v_staff);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub',(SELECT staff_id::text FROM phase8_test_ids),true);
DO $$
DECLARE v_store uuid; v_other uuid; v_report jsonb; v_alerts jsonb;
BEGIN
  SELECT store_id,outsider_store_id INTO v_store,v_other FROM phase8_test_ids;
  v_report := public.get_store_reports(v_store,current_date,current_date,30,NULL,NULL);
  IF v_report->'profit_summary' IS DISTINCT FROM 'null'::jsonb
     OR v_report->'profit_products' IS DISTINCT FROM 'null'::jsonb
     OR v_report->'profit_categories' IS DISTINCT FROM 'null'::jsonb
     OR v_report->'inventory_by_category' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: staff report includes owner-only financial fields';
  END IF;
  v_alerts := public.get_store_alert_counts(v_store,30);
  IF NOT (v_alerts ? 'low_stock_count') THEN RAISE EXCEPTION 'FAIL: alert count missing'; END IF;
  BEGIN
    PERFORM public.get_store_reports(v_other,current_date,current_date,30,NULL,NULL);
    RAISE EXCEPTION 'FAIL: cross-store report access was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%لا تملك صلاحية قراءة تقارير هذا المتجر%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: staff receives no owner financial data and cannot read another store';
END $$;

SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM phase8_test_ids),true);
DO $$
DECLARE v_store uuid; v_report jsonb;
BEGIN
  SELECT store_id INTO v_store FROM phase8_test_ids;
  v_report := public.get_store_reports(v_store,current_date,current_date,30,NULL,NULL);
  IF v_report->'profit_summary' IS NULL OR v_report->'profit_summary' = 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: owner report is missing profit summary';
  END IF;
  RAISE NOTICE 'PASS: owner receives owner-only report structure';
END $$;
ROLLBACK;
