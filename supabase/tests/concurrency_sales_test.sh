#!/bin/bash
# ==============================================================================
# اختبار التزامن في قاعدة البيانات (PostgreSQL Database Concurrency Sales Test)
# يختبر السيناريوهات المتوازية بجلستين مستقلتين عبر psql:
# 1. بيعتان متزامنتان لنفس المنتج لا تنتجان مخزوناً سالباً (Over-selling Race Condition).
# 2. استدعاءان متوازيان بنفس client_uuid يعيدان الفاتورة نفسها دون تكرار الخصم (Idempotency).
# ==============================================================================

set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-lovable}"
PGDATABASE="${PGDATABASE:-grocery_pos}"

echo "======================================================================"
echo "🧪 بدء اختبارات التزامن والأمان المالي لقاعدة البيانات (Database Concurrency)"
echo "قاعدة البيانات: $PGDATABASE على $PGHOST:$PGPORT"
echo "======================================================================"

run_sql() {
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 -At -c "$1"
}

TMP_DIR=$(mktemp -d /tmp/db_concurrency_test.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

# ------------------------------------------------------------------------------
# إعداد المستخدم والمتجر وبيئة الاختبار المشتركة
# ------------------------------------------------------------------------------
echo "🔹 تهيئة مستخدم ومتجر اختبار التزامن..."
TEST_USER_ID=$(run_sql "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'concurrency_runner@test.local') RETURNING id;")
TEST_STORE_ID=$(run_sql "INSERT INTO stores (name, currency_code, currency_symbol) VALUES ('متجر تدقيق التزامن', 'SAR', 'ر.س') RETURNING id;")
run_sql "INSERT INTO store_members (store_id, user_id, role, is_active) VALUES ('$TEST_STORE_ID', '$TEST_USER_ID', 'owner', true);"
run_sql "INSERT INTO admin_sessions (store_id, user_id, expires_at) VALUES ('$TEST_STORE_ID', '$TEST_USER_ID', now() + interval '2 hours');"

TEST_CAT_ID=$(run_sql "SELECT id FROM categories WHERE store_id = '$TEST_STORE_ID' LIMIT 1;")
if [ -z "$TEST_CAT_ID" ]; then
    TEST_CAT_ID=$(run_sql "SET request.jwt.claim.sub = '$TEST_USER_ID'; INSERT INTO categories (store_id, name) VALUES ('$TEST_STORE_ID', 'تصنيف التزامن') RETURNING id;")
fi

# ==============================================================================
# السيناريو 1: محاولة بيع متزامنة لمنتج مخزونه 5 (كمية 3 لكل جلسة بـ client_uuid مختلف)
# ==============================================================================
echo ""
echo "----------------------------------------------------------------------"
echo "🔹 السيناريو 1: فحص سباق المخزون (منتج مخزونه 5، جلستان تطلبان 3 في نفس اللحظة)..."
echo "----------------------------------------------------------------------"

PROD1_ID=$(run_sql "SET request.jwt.claim.sub = '$TEST_USER_ID';
                    INSERT INTO products (store_id, category_id, name, barcode, price, cost_price, stock_quantity, min_stock, is_active)
                    VALUES ('$TEST_STORE_ID', '$TEST_CAT_ID', 'منتج تزامن 1 (مخزون 5)', '628999000101', 20.00, 15.00, 5.000, 1.000, true)
                    RETURNING id;")

UUID_S1=$(run_sql "SELECT gen_random_uuid();")
UUID_S2=$(run_sql "SELECT gen_random_uuid();")

CMD_TEMPLATE="SET request.jwt.claim.sub = '$TEST_USER_ID'; SELECT process_sale('$TEST_STORE_ID'::uuid, '%s'::uuid, '[{\"product_id\": \"$PROD1_ID\", \"quantity\": 3, \"unit_price\": 20.00}]'::jsonb, 0, 'cash');"

# تشغيل الجلستين في نفس اللحظة بالخلفية
printf "$CMD_TEMPLATE" "$UUID_S1" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 > "$TMP_DIR/s1.out" 2> "$TMP_DIR/s1.err" &
PID1=$!
printf "$CMD_TEMPLATE" "$UUID_S2" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 > "$TMP_DIR/s2.out" 2> "$TMP_DIR/s2.err" &
PID2=$!

EXIT1=0
EXIT2=0
wait $PID1 || EXIT1=$?
wait $PID2 || EXIT2=$?

# التحقق من نجاح واحدة وفشل الأخرى
SUCCESS_COUNT=0
FAIL_COUNT=0
FAIL_MSG=""

if [ $EXIT1 -eq 0 ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_MSG=$(cat "$TMP_DIR/s1.err")
fi

if [ $EXIT2 -eq 0 ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_MSG=$(cat "$TMP_DIR/s2.err")
fi

if [ "$SUCCESS_COUNT" -ne 1 ] || [ "$FAIL_COUNT" -ne 1 ]; then
    echo "❌ فشل السيناريو 1: كان متوقعاً نجاح جلسة واحدة وفشل جلسة واحدة (الناجح: $SUCCESS_COUNT، الفاشل: $FAIL_COUNT)"
    echo "مخرجات الجلسة 1 (كود $EXIT1):" && cat "$TMP_DIR/s1.err" "$TMP_DIR/s1.out"
    echo "مخرجات الجلسة 2 (كود $EXIT2):" && cat "$TMP_DIR/s2.err" "$TMP_DIR/s2.out"
    exit 1
fi

# التأكد من أن رسالة الخطأ توضح نقص المخزون
if [[ ! "$FAIL_MSG" =~ "المخزون غير كافٍ" ]]; then
    echo "❌ فشل السيناريو 1: لم تحتوِ رسالة الخطأ على نص 'المخزون غير كافٍ'. الرسالة المستلمة: $FAIL_MSG"
    exit 1
fi

# فحص المخزون النهائي في جدول products
FINAL_STOCK=$(run_sql "SELECT stock_quantity FROM products WHERE id = '$PROD1_ID';")
if [ "$FINAL_STOCK" != "2.000" ] && [ "$FINAL_STOCK" != "2" ]; then
    echo "❌ فشل السيناريو 1: المخزون النهائي غير صحيح: $FINAL_STOCK (المتوقع 2.000)"
    exit 1
fi

# فحص حركات المخزون في stock_movements
MOVEMENTS_COUNT=$(run_sql "SELECT count(*) FROM stock_movements WHERE product_id = '$PROD1_ID' AND type = 'sale';")
if [ "$MOVEMENTS_COUNT" -ne 1 ]; then
    echo "❌ فشل السيناريو 1: عدد حركات البيع في stock_movements هو $MOVEMENTS_COUNT (المتوقع 1 فقط)"
    exit 1
fi

echo "✅ نجح السيناريو 1 تماماً: بيعة واحدة نجحت، والأخرى رُفضت بخطأ نقص المخزون، والمخزون النهائي 2.000 وليس سالباً."

# ==============================================================================
# السيناريو 2: استدعاء process_sale مرتين بنفس client_uuid متوازياً (Idempotency)
# ==============================================================================
echo ""
echo "----------------------------------------------------------------------"
echo "🔹 السيناريو 2: فحص Idempotency المتوازي (استدعاءان بنفس client_uuid بالتوازي)..."
echo "----------------------------------------------------------------------"

PROD2_ID=$(run_sql "SET request.jwt.claim.sub = '$TEST_USER_ID';
                    INSERT INTO products (store_id, category_id, name, barcode, price, cost_price, stock_quantity, min_stock, is_active)
                    VALUES ('$TEST_STORE_ID', '$TEST_CAT_ID', 'منتج تزامن 2 (Idempotency)', '628999000202', 30.00, 20.00, 10.000, 2.000, true)
                    RETURNING id;")

SHARED_CLIENT_UUID=$(run_sql "SELECT gen_random_uuid();")

IDEM_CMD="SET request.jwt.claim.sub = '$TEST_USER_ID'; SELECT process_sale('$TEST_STORE_ID'::uuid, '$SHARED_CLIENT_UUID'::uuid, '[{\"product_id\": \"$PROD2_ID\", \"quantity\": 4, \"unit_price\": 30.00}]'::jsonb, 0, 'cash');"

printf "$IDEM_CMD" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 > "$TMP_DIR/idem1.out" 2> "$TMP_DIR/idem1.err" &
PID_I1=$!
printf "$IDEM_CMD" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 > "$TMP_DIR/idem2.out" 2> "$TMP_DIR/idem2.err" &
PID_I2=$!

EXIT_I1=0
EXIT_I2=0
wait $PID_I1 || EXIT_I1=$?
wait $PID_I2 || EXIT_I2=$?

if [ $EXIT_I1 -ne 0 ] || [ $EXIT_I2 -ne 0 ]; then
    echo "❌ فشل السيناريو 2: إحدى الجلسات فشلت بكود خطأ بدلاً من إعادة الفاتورة المخزنة."
    echo "أخطاء 1:" && cat "$TMP_DIR/idem1.err"
    echo "أخطاء 2:" && cat "$TMP_DIR/idem2.err"
    exit 1
fi

FINAL_STOCK2=$(run_sql "SELECT stock_quantity FROM products WHERE id = '$PROD2_ID';")
if [ "$FINAL_STOCK2" != "6.000" ] && [ "$FINAL_STOCK2" != "6" ]; then
    echo "❌ فشل السيناريو 2: خصم المخزون تم مرتين! المخزون النهائي: $FINAL_STOCK2 (المتوقع 6.000 حيث 10 - 4 = 6)"
    exit 1
fi

SALES_COUNT=$(run_sql "SELECT count(*) FROM sales WHERE store_id = '$TEST_STORE_ID' AND client_uuid = '$SHARED_CLIENT_UUID';")
if [ "$SALES_COUNT" -ne 1 ]; then
    echo "❌ فشل السيناريو 2: عدد الفواتير المنشأة بهذا الـ UUID هو $SALES_COUNT (المتوقع 1)"
    exit 1
fi

MOVEMENTS2_COUNT=$(run_sql "SELECT count(*) FROM stock_movements WHERE product_id = '$PROD2_ID' AND type = 'sale';")
if [ "$MOVEMENTS2_COUNT" -ne 1 ]; then
    echo "❌ فشل السيناريو 2: عدد حركات البيع للمنتج هو $MOVEMENTS2_COUNT (المتوقع 1 فقط)"
    exit 1
fi

echo "✅ نجح السيناريو 2 تماماً: الجلستان المتوازيتان أعادتا نفس الفاتورة دون تكرار خصم المخزون (المخزون 6.000)."

echo ""
echo "======================================================================"
echo "🎉 اكتملت جميع اختبارات التزامن بنجاح 100%! قاعدة البيانات محصنة ضد تعارض السباق."
echo "======================================================================"
