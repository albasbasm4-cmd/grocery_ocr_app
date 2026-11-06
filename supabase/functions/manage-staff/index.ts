import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
type Action = 'list' | 'create' | 'deactivate' | 'remove';
type RequestBody = { action?: Action; store_id?: string; email?: string; password?: string; user_id?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'طريقة الطلب غير مدعومة.' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'إعدادات الخدمة غير مكتملة.' }, 500);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'يجب تسجيل الدخول.' }, 401);
  const token = authorization.slice('Bearer '.length);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await caller.auth.getUser(token);
  if (authError || !userData.user) return json({ error: 'جلسة الدخول غير صالحة.' }, 401);
  let body: RequestBody;
  try { body = await request.json() as RequestBody; } catch { return json({ error: 'بيانات الطلب غير صالحة.' }, 400); }
  const { action, store_id: storeId } = body;
  if (!action || !storeId) return json({ error: 'الإجراء والمتجر مطلوبان.' }, 400);

  const { data: membership, error: membershipError } = await admin.from('store_members')
    .select('role,is_active').eq('store_id', storeId).eq('user_id', userData.user.id).maybeSingle();
  if (membershipError || !membership || membership.role !== 'owner' || membership.is_active !== true) {
    return json({ error: 'هذه العملية متاحة لمالك المتجر فقط.' }, 403);
  }
  const { data: pinSession } = await admin.from('admin_sessions').select('expires_at')
    .eq('store_id', storeId).eq('user_id', userData.user.id).gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false }).limit(1).maybeSingle();
  if (!pinSession) return json({ error: 'تحقق PIN مطلوب أو انتهت صلاحيته.' }, 403);

  if (action === 'list') {
    const { data: rows, error } = await admin.from('store_members').select('user_id,role,is_active')
      .eq('store_id', storeId).eq('role', 'staff').order('created_at', { ascending: false });
    if (error) return json({ error: 'تعذر تحميل الموظفين.' }, 500);
    const allUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (allUsers.error) return json({ error: 'تعذر تحميل بيانات الحسابات.' }, 500);
    const emails = new Map(allUsers.data.users.map((user) => [user.id, user.email ?? null]));
    return json({ staff: (rows ?? []).map((row) => ({ ...row, email: emails.get(row.user_id) ?? null })) });
  }

  if (action === 'create') {
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'أدخل بريداً إلكترونياً صحيحاً.' }, 400);
    if (!password || password.length < 8) return json({ error: 'كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل.' }, 400);
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) return json({ error: createError?.message ?? 'تعذر إنشاء الحساب.' }, 400);
    const { error: insertError } = await admin.from('store_members').insert({ store_id: storeId, user_id: created.user.id, role: 'staff' });
    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: 'تعذر إضافة المستخدم إلى المتجر.' }, 500);
    }
    return json({ staff: [{ user_id: created.user.id, email, role: 'staff', is_active: true }] }, 201);
  }

  const targetId = body.user_id;
  if (!targetId || targetId === userData.user.id) return json({ error: 'معرّف الموظف غير صالح.' }, 400);
  const { data: target, error: targetError } = await admin.from('store_members').select('user_id,role,is_active')
    .eq('store_id', storeId).eq('user_id', targetId).eq('role', 'staff').maybeSingle();
  if (targetError || !target) return json({ error: 'لم يتم العثور على الموظف في هذا المتجر.' }, 404);
  if (action === 'deactivate') {
    const { error } = await admin.from('store_members').update({ is_active: false }).eq('store_id', storeId).eq('user_id', targetId);
    if (error) return json({ error: 'تعذر تعطيل الموظف.' }, 500);
    return json({ ok: true });
  }
  if (action === 'remove') {
    const { error } = await admin.from('store_members').delete().eq('store_id', storeId).eq('user_id', targetId);
    if (error) return json({ error: 'تعذر حذف عضوية الموظف.' }, 500);
    return json({ ok: true });
  }
  return json({ error: 'الإجراء غير معروف.' }, 400);
});
