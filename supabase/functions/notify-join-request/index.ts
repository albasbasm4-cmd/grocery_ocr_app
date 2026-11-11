import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendEmail(options: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY') || Deno.env.get('MAIL_API_KEY');
  const from = Deno.env.get('MAIL_FROM') || 'onboarding@resend.dev';

  if (!apiKey) {
    console.warn('[MAIL NOTICE] No MAIL_API_KEY or RESEND_API_KEY found. Simulating delivery to:', options.to);
    return { ok: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[RESEND ERROR]', res.status, errData);
      return { ok: false, error: errData.message || 'فشل إرسال البريد.' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[MAIL EXCEPTION]', err);
    return { ok: false, error: 'تعذر الاتصال بمزود البريد.' };
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'طريقة الطلب غير مدعومة.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'إعدادات الخادم غير مكتملة.' }, 500);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'يجب تسجيل الدخول.' }, 401);
  const token = authorization.slice('Bearer '.length);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: userData, error: authError } = await caller.auth.getUser(token);
  if (authError || !userData.user) return json({ error: 'جلسة الدخول غير صالحة.' }, 401);

  let body: { action?: string; request_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'بيانات الطلب غير صالحة.' }, 400);
  }

  const { action, request_id: requestId } = body;
  if (!requestId) return json({ error: 'معرّف الطلب مطلوب.' }, 400);

  const { data: joinReq, error: reqError } = await admin
    .from('store_join_requests')
    .select('id, store_id, user_id, requester_email, status, created_at, notified_at')
    .eq('id', requestId)
    .maybeSingle();

  if (reqError || !joinReq) return json({ error: 'طلب الانضمام غير موجود.' }, 404);

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id, name')
    .eq('id', joinReq.store_id)
    .maybeSingle();

  if (storeError || !store) return json({ error: 'المتجر غير موجود.' }, 404);

  if (action === 'notify_owner' || !action) {
    if (joinReq.user_id !== userData.user.id) {
      return json({ error: 'غير مصرح: يجب أن يكون المستدعي هو صاحب الطلب.' }, 403);
    }
    if (joinReq.status !== 'pending') {
      return json({ error: 'الطلب لم يعد معلقاً.' }, 400);
    }
    if (joinReq.notified_at) {
      return json({ ok: true, message: 'تم إرسال الإشعار مسبقاً.' });
    }

    const { data: ownerMember } = await admin
      .from('store_members')
      .select('user_id')
      .eq('store_id', joinReq.store_id)
      .eq('role', 'owner')
      .eq('is_active', true)
      .maybeSingle();

    if (!ownerMember) return json({ error: 'تعذر العثور على مالك المتجر.' }, 404);

    const { data: ownerUser } = await admin.auth.admin.getUserById(ownerMember.user_id);
    const ownerEmail = ownerUser?.user?.email;

    if (!ownerEmail) return json({ error: 'بريد مالك المتجر غير متوفر.' }, 400);

    const safeStore = escapeHtml(store.name);
    const safeEmail = escapeHtml(joinReq.requester_email || userData.user.email || '');
    const dateStr = new Date(joinReq.created_at).toLocaleString('ar-SA');

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #16a34a; margin-top: 0;">طلب انضمام جديد لمتجرك</h2>
        <p>مرحباً بك،</p>
        <p>تلقى متجرك <strong>${safeStore}</strong> طلب انضمام جديد من:</p>
        <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; margin: 15px 0;">
          <p style="margin: 4px 0;"><strong>البريد الإلكتروني للمتقدم:</strong> ${safeEmail}</p>
          <p style="margin: 4px 0;"><strong>تاريخ الطلب:</strong> ${dateStr}</p>
        </div>
        <p style="color: #4b5563;">لمراجعة الطلب واتخاذ القرار (قبول مع تعيين الصلاحيات أو رفض):</p>
        <p style="background: #eef2ff; padding: 10px 14px; border-right: 4px solid #6366f1; border-radius: 4px; font-weight: bold;">
          افتح التطبيق &larr; الإعدادات &larr; قسم طلبات الانضمام.
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">هذه الرسالة آلية من نظام نقاط البيع والمخزون.</p>
      </div>
    `;

    const mailRes = await sendEmail({
      to: ownerEmail,
      subject: `طلب انضمام جديد إلى متجر ${safeStore}`,
      html,
    });

    if (mailRes.ok) {
      await admin.from('store_join_requests').update({ notified_at: new Date().toISOString() }).eq('id', requestId);
    }

    return json({ ok: true, email_sent: mailRes.ok, error: mailRes.error });
  }

  if (action === 'notify_decision') {
    const { data: ownerMember } = await admin
      .from('store_members')
      .select('user_id')
      .eq('store_id', joinReq.store_id)
      .eq('user_id', userData.user.id)
      .eq('role', 'owner')
      .eq('is_active', true)
      .maybeSingle();

    if (!ownerMember) return json({ error: 'هذه العملية متاحة لمالك المتجر فقط.' }, 403);

    const { data: applicantUser } = await admin.auth.admin.getUserById(joinReq.user_id);
    const applicantEmail = applicantUser?.user?.email || joinReq.requester_email;

    if (!applicantEmail) return json({ error: 'بريد المتقدم غير متوفر.' }, 400);

    const safeStore = escapeHtml(store.name);
    const isApproved = joinReq.status === 'approved';

    const html = isApproved
      ? `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #16a34a; margin-top: 0;">تم قبول طلب انضمامك!</h2>
        <p>مرحباً بك،</p>
        <p>يسعدنا إبلاغك بأنه تمت الموافقة على انضمامك إلى متجر <strong>${safeStore}</strong>.</p>
        <p>يمكنك الآن فتح التطبيق والتبديل إلى متجر <strong>${safeStore}</strong> مباشرة من القائمة لبدء العمل.</p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">نظام نقاط البيع والمخزون.</p>
      </div>`
      : `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #dc2626; margin-top: 0;">تحديث بخصوص طلب الانضمام</h2>
        <p>مرحباً بك،</p>
        <p>نود إبلاغك بأنه تعذر قبول طلب انضمامك إلى متجر <strong>${safeStore}</strong> في الوقت الحالي.</p>
        <p>يمكنك التواصل مع إدارة المتجر أو إنشاء متجرك الخاص عبر التطبيق.</p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">نظام نقاط البيع والمخزون.</p>
      </div>`;

    const mailRes = await sendEmail({
      to: applicantEmail,
      subject: isApproved ? `تم قبول انضمامك إلى متجر ${safeStore}` : `تحديث حول طلب انضمامك إلى متجر ${safeStore}`,
      html,
    });

    return json({ ok: true, email_sent: mailRes.ok, error: mailRes.error });
  }

  return json({ error: 'إجراء غير معروف.' }, 400);
});
