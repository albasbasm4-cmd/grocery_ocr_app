import { supabase } from '../lib/supabase';
import { ar } from '../i18n/ar';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  isError?: boolean;
}

export interface SendMessageResponse {
  reply: string;
  tools_used?: string[];
}

export const SAMPLE_AI_PROMPTS = [
  'ما المنتجات التي اقترب نفادها؟',
  'ما إجمالي أسعار قسم الألبان؟',
  'ابحث عن منتج حليب',
  'ما ملخص مبيعات اليوم؟',
  'ما أكثر المنتجات مبيعاً؟',
  'ما المنتجات القريبة من انتهاء الصلاحية؟',
  'ما إجمالي ديون العملاء؟',
];

export async function sendAiChatMessage(
  storeId: string,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<SendMessageResponse> {
  const cleanMsg = message.trim();
  if (!cleanMsg) {
    throw new Error(ar.aiEmptyMessage);
  }

  const { data, error } = await supabase.functions.invoke<SendMessageResponse>('ai-chat', {
    body: {
      store_id: storeId,
      message: cleanMsg,
      history: history.slice(-6),
    },
  });

  if (error) {
    // محاولة استخراج رسالة الخطأ العربية من استجابة الوظيفة
    let errorDetail = error.message;
    if (error && typeof error === 'object' && 'context' in error) {
      try {
        const ctx = error as { context?: { json?: () => Promise<{ error?: string }> } };
        if (ctx.context?.json) {
          const body = await ctx.context.json();
          if (body?.error) errorDetail = body.error;
        }
      } catch {
        // تجاهل أخطاء استخراج التفاصيل
      }
    }
    throw new Error(errorDetail || ar.aiServiceError);
  }

  if (!data?.reply) {
    throw new Error(ar.aiNoResponse);
  }

  return data;
}
