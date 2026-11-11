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

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecure6DigitCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => (b % 10).toString()).join('');
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

  let body: { action?: string; store_id?: string; code?: string; new_pin?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'بيانات الطلب غير صالحة.' }, 400);
  }

  const { action, store_id: storeId, code, new_pin: newPin } = body;
  if (!storeId) return json({ error: 'معرّف المتجر مطلوب.' }, 400);

  const { data: membership, error: memberError } = await admin
    .from('store_members')
    .select('role, is_active')
    .eq('store_id', storeId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (memberError || !membership || membership.role !== 'owner' || !membership.is_active) {
    return json({ error: 'استعادة رمز PIN متاحة لمالك المتجر فقط.' }, 403);
  }

  const { data: store } = await admin.from('stores').select('name').eq('id', storeId).maybeSingle();
  const safeStore = escapeHtml(store?.name || 'المتجر');
  const ownerEmail = userData.user.email;

  if (!ownerEmail) return json({ error: 'البريد الإلكتروني للحساب غير متوفر.' }, 400);

  if (action === 'send_code') {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recentCodes } = await admin
      .from('pin_reset_codes')
      .select('id, created_at')
      .eq('store_id', storeId)
      .eq('user_id', userData.user.id)
      .gte('created_at', oneMinuteAgo);

    if (recentCodes && recentCodes.length > 0) {
      return json({ error: 'يرجى الانتظار دقيقة واحدة قبل طلب رمز جديد.', cooldown_seconds: 60 }, 429);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await admin
      .from('pin_reset_codes')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('user_id', userData.user.id)
      .gte('created_at', oneHourAgo);

    if ((hourlyCount ?? 0) >= 3) {
      return json({ error: 'تم تجاوز الحد الأقصى لمحاولات استعادة PIN في الساعة (3 رموز). يرجى المحاولة لاحقاً.' }, 429);
    }

    await admin
      .from('pin_reset_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('store_id', storeId)
      .eq('user_id', userData.user.id)
      .is('used_at', null);

    const rawCode = generateSecure6DigitCode();
    const codeHash = await sha256Hex(rawCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await admin.from('pin_reset_codes').insert({
      store_id: storeId,
      user_id: userData.user.id,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    });

    if (insertError) {
      console.error('[PIN RESET INSERT ERROR]', insertError);
      return json({ error: 'تعذر إنشاء رمز التحقق. يرجى المحاولة لاحقاً.' }, 500);
    }

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">رمز استعادة PIN لمتجرك</h2>
        <p>مرحباً بك،</p>
        <p>لقد طلبت إعادة تعيين رمز PIN لمتجر <strong>${safeStore}</strong>. رمز التحقق الخاص بك هو:</p>
        <div style="text-align: center; margin: 25px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e1b4b; background: #e0e7ff; padding: 12px 28px; border-radius: 8px; border: 1px dashed #6366f1;">
            ${rawCode}
          </span>
        </div>
        <p style="color: #4b5563;">صلاحية هذا الرمز <strong>10 دقائق</strong> فقط، ويمكن استخدامه لمرة واحدة.</p>
        <p style="color: #dc2626; font-size: 13px;">إذا لم تطلب هذا الرمز بنفسك، يرجى تجاهل هذه الرسالة والتحقق من أمان حسابك.</p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">نظام نقاط البيع والمخزون.</p>
      </div>
    `;

    const mailRes = await sendEmail({
      to: ownerEmail,
      subject: `رمز استعادة PIN لمتجر ${safeStore}`,
      html,
    });

    return json({
      ok: true,
      message: 'تم إرسال رمز التحقق المكون من 6 أرقام إلى بريدك الإلكتروني.',
      cooldown_seconds: 60,
      email_sent: mailRes.ok,
    });
  }

  if (action === 'verify_and_reset') {
    if (!code || !/^\d{6}$/.test(code.trim())) {
      return json({ error: 'رمز التحقق يجب أن يتكون من 6 أرقام.' }, 400);
    }
    if (!newPin || !/^\d{4,8}$/.test(newPin.trim())) {
      return json({ error: 'رمز PIN الجديد يجب أن يتكون من 4 إلى 8 أرقام.' }, 400);
    }

    const { data: rpcRes, error: rpcError } = await caller.rpc('reset_admin_pin_with_code', {
      p_store_id: storeId,
      p_code: code.trim(),
      p_new_pin: newPin.trim(),
    });

    if (rpcError) {
      return json({ error: rpcError.message || 'تعذر إعادة تعيين رمز PIN.' }, 400);
    }
    if (rpcRes && rpcRes.ok === false) {
      return json({ error: rpcRes.error || 'تعذر إعادة تعيين رمز PIN.' }, 400);
    }

    const alertHtml = `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #16a34a; margin-top: 0;">تم تغيير رمز PIN بنجاح</h2>
        <p>مرحباً بك،</p>
        <p>تم بنجاح تغيير رمز PIN لمتجر <strong>${safeStore}</strong> بواسطة رمز الاستعادة المرسل لبريدك.</p>
        <p>تم إبطال جميع جلسات PIN السابقة على الأجهزة الأخرى لأمان متجرك.</p>
        <p style="color: #dc2626; font-size: 13px;">إذا لم تقم بهذه العملية، يرجى الدخول فوراً وتغيير كلمة مرور حسابك ورمز PIN.</p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">نظام نقاط البيع والمخزون.</p>
      </div>
    `;

    sendEmail({
      to: ownerEmail,
      subject: `تنبيه أمني: تم تغيير رمز PIN لمتجر ${safeStore}`,
      html: alertHtml,
    }).catch((e) => console.error('[ALERT EMAIL FAILED]', e));

    return json({ ok: true, message: 'تم تعيين رمز PIN الجديد بنجاح.' });
  }

  return json({ error: 'إجراء غير معروف.' }, 400);
});
