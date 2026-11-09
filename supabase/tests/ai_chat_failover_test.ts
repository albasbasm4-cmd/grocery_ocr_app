import { assertEquals, assertRejects, assert } from "jsr:@std/assert";
import {
  callProvider,
  createModelCaller,
  resetCooldowns,
  getModelCooldown,
  setModelCooldown,
  getGeminiGroupCooldownUntil,
  setGeminiGroupCooldownUntil,
  DEFAULT_GROQ_MODELS,
  DEFAULT_GEMINI_MODELS,
} from "../functions/ai-chat/index.ts";

const createMockResponse = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
};

Deno.test("Case 1: First model succeeds (أول نموذج ينجح) - calls first model and finishes", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    return createMockResponse(200, {
      choices: [{ message: { content: "إجابة من النموذج الأول" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 1);
  assertEquals(calledModels[0], DEFAULT_GROQ_MODELS[0]); // openai/gpt-oss-120b
  assertEquals(res.choices[0].message.content, "إجابة من النموذج الأول");
});

Deno.test("Case 2: First model 429, second succeeds (أول نموذج 429 والثاني ينجح)", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    if (body.model === DEFAULT_GROQ_MODELS[0]) {
      return createMockResponse(429, { error: "Rate limit reached" }, { "retry-after": "45" });
    }
    return createMockResponse(200, {
      choices: [{ message: { content: "إجابة من النموذج الثاني" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 2);
  assertEquals(calledModels[0], DEFAULT_GROQ_MODELS[0]);
  assertEquals(calledModels[1], DEFAULT_GROQ_MODELS[1]);
  assertEquals(res.choices[0].message.content, "إجابة من النموذج الثاني");
  assert(getModelCooldown("Groq", DEFAULT_GROQ_MODELS[0]) > Date.now());
});

Deno.test("Case 3: Cascading failures across models (تتابع عدة نماذج فاشلة)", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    if (calledModels.length <= 3) {
      return createMockResponse(503, { error: "Service Unavailable" });
    }
    return createMockResponse(200, {
      choices: [{ message: { content: "نجح بعد 3 إخفاقات" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 4);
  assertEquals(calledModels[0], DEFAULT_GROQ_MODELS[0]);
  assertEquals(calledModels[1], DEFAULT_GROQ_MODELS[1]);
  assertEquals(calledModels[2], DEFAULT_GROQ_MODELS[2]);
  assertEquals(calledModels[3], DEFAULT_GROQ_MODELS[3]);
  assertEquals(res.choices[0].message.content, "نجح بعد 3 إخفاقات");
});

Deno.test("Case 4: Decommissioned model 404 and skip (نموذج متقاعد 404 وتخطيه)", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    if (body.model === DEFAULT_GROQ_MODELS[0]) {
      return createMockResponse(404, { error: "Model decommissioned or not found" });
    }
    return createMockResponse(200, {
      choices: [{ message: { content: "إجابة بعد تخطي 404" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 2);
  assertEquals(res.choices[0].message.content, "إجابة بعد تخطي 404");
  // 404 sets 1 hour cooldown
  const cooldown = getModelCooldown("Groq", DEFAULT_GROQ_MODELS[0]);
  assert(cooldown >= Date.now() + 3_500_000);
});

Deno.test("Case 5: Skipping cooled-down model (تجاوز نموذج معطّل مؤقتاً)", async () => {
  resetCooldowns();
  // Pre-set cooldown for first model
  setModelCooldown("Groq", DEFAULT_GROQ_MODELS[0], Date.now() + 120_000);

  const calledModels: string[] = [];
  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    return createMockResponse(200, {
      choices: [{ message: { content: "إجابة مباشرة من الثاني لتجاوز الأول المعطل" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 1);
  assertEquals(calledModels[0], DEFAULT_GROQ_MODELS[1]); // Skipped model 0 completely
  assertEquals(res.choices[0].message.content, "إجابة مباشرة من الثاني لتجاوز الأول المعطل");
});

Deno.test("Case 6: Failure in round 2 of tools (فشل في الجولة الثانية من الأدوات)", async () => {
  resetCooldowns();
  let round1Call = 0;
  let round2Call = 0;

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.tools && body.tools.length > 0) {
      // Round 1
      round1Call += 1;
      return createMockResponse(200, {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call_stock_1",
                  type: "function",
                  function: { name: "get_low_stock", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    }

    // Round 2
    round2Call += 1;
    if (body.model === DEFAULT_GROQ_MODELS[0]) {
      return createMockResponse(500, { error: "Failed in round 2" });
    }

    // Next model receives messages including tool response
    const msgs = body.messages as Array<{ role: string; content?: string }>;
    assert(msgs.some((m) => m.role === "tool"));
    return createMockResponse(200, {
      choices: [{ message: { content: "المنتجات المنخفضة: حليب وزيت." } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const messages = [
    { role: "system", content: "مساعد بقالة" },
    { role: "user", content: "ما المنتجات الناقصة؟" },
  ];

  // Round 1
  const r1 = await caller({ messages, tools: [{ type: "function", function: { name: "get_low_stock" } }] }) as {
    choices: Array<{ message: { tool_calls: unknown[] } }>;
  };
  messages.push({ role: "assistant", content: "", tool_calls: r1.choices[0].message.tool_calls } as any);
  messages.push({ role: "tool", tool_call_id: "call_stock_1", name: "get_low_stock", content: "[{\"name\":\"حليب\"}]" } as any);

  // Round 2
  const r2 = await caller({ messages }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(r2.choices[0].message.content, "المنتجات المنخفضة: حليب وزيت.");
});

Deno.test("Case 7: All models fail (فشل كل النماذج)", async () => {
  resetCooldowns();

  const mockFetch = async () => {
    return createMockResponse(502, { error: "Bad Gateway" });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await caller({ messages: [{ role: "user", content: "مرحبا" }] });
    },
    Error,
    "All model attempts failed or timed out"
  );
});

Deno.test("Case 8: Single provider key (مفتاح مزود واحد فقط)", async () => {
  resetCooldowns();

  // Groq only
  const groqOnlyCalls: string[] = [];
  const callerGroq = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: undefined,
    fetchFn: (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      groqOnlyCalls.push(body.model);
      return createMockResponse(200, { choices: [{ message: { content: "رد من Groq فقط" } }] });
    }) as unknown as typeof fetch,
  });
  await callerGroq({ messages: [{ role: "user", content: "مرحبا" }] });
  assertEquals(groqOnlyCalls.length, 1);
  assert(DEFAULT_GROQ_MODELS.includes(groqOnlyCalls[0]));

  // Gemini only
  const geminiOnlyCalls: string[] = [];
  const callerGemini = createModelCaller({
    groqKey: undefined,
    geminiKey: "mock-gemini-key",
    fetchFn: (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      geminiOnlyCalls.push(body.model);
      return createMockResponse(200, { choices: [{ message: { content: "رد من Gemini فقط" } }] });
    }) as unknown as typeof fetch,
  });
  await callerGemini({ messages: [{ role: "user", content: "مرحبا" }] });
  assertEquals(geminiOnlyCalls.length, 1);
  assertEquals(geminiOnlyCalls[0], DEFAULT_GEMINI_MODELS[0]);
});

Deno.test("Case 9: Two consecutive Gemini 429s triggers Gemini group cooldown (تعطيل مجموعة Gemini)", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    // Let Gemini models return 429
    if (body.model.startsWith("gemini-")) {
      return createMockResponse(429, { error: "RESOURCE_EXHAUSTED: daily limit exceeded" });
    }
    return createMockResponse(500, { error: "Groq server error" });
  };

  const caller = createModelCaller({
    groqKey: undefined, // test Gemini group directly
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await caller({ messages: [{ role: "user", content: "مرحبا" }] });
    },
    Error
  );

  // First 2 Gemini models failed with 429 -> Group cooldown triggered
  assertEquals(calledModels.length, 2);
  assertEquals(calledModels[0], DEFAULT_GEMINI_MODELS[0]);
  assertEquals(calledModels[1], DEFAULT_GEMINI_MODELS[1]);
  assert(getGeminiGroupCooldownUntil() > Date.now());

  // Next request should immediately skip all Gemini models because group is cooling down
  calledModels.length = 0;
  await assertRejects(
    async () => {
      await caller({ messages: [{ role: "user", content: "مرحبا 2" }] });
    },
    Error
  );
  assertEquals(calledModels.length, 0); // No calls made at all
});

Deno.test("Case 10: Timeout triggers failover (انتهاء المهلة)", async () => {
  resetCooldowns();
  const calledModels: string[] = [];

  const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calledModels.push(body.model);
    if (body.model === DEFAULT_GROQ_MODELS[0]) {
      const err = new Error("AbortError: The signal has been aborted");
      err.name = "TimeoutError";
      throw err;
    }
    return createMockResponse(200, {
      choices: [{ message: { content: "إجابة بعد مهلة النموذج الأول" } }],
    });
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "مرحبا" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calledModels.length, 2);
  assertEquals(res.choices[0].message.content, "إجابة بعد مهلة النموذج الأول");
});

Deno.test("Case 11: Handler returns friendly 200 response when all models fail", async () => {
  Deno.env.set("SUPABASE_URL", "https://dummy.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "dummy-anon-key");
  Deno.env.set("GROQ_API_KEY", "dummy-groq-key");
  Deno.env.set("GEMINI_API_KEY", "dummy-gemini-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("auth/v1/user")) {
      return createMockResponse(200, { user: { id: "user-test" } });
    }
    if (url.includes("store_members")) {
      return createMockResponse(200, { role: "owner", is_active: true });
    }
    if (url.includes("rpc/check_and_increment_ai_rate_limit")) {
      return createMockResponse(200, { allowed: true });
    }
    return createMockResponse(500, { error: "All AI providers down" });
  }) as unknown as typeof fetch;

  try {
    const { handler } = await import("../functions/ai-chat/index.ts");
    const req = new Request("http://localhost/ai-chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer mock-jwt-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_id: "11111111-1111-1111-1111-111111111111",
        message: "أريد معرفة المنتجات المنتهية",
      }),
    });

    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reply, "المساعد الذكي مشغول قليلاً الآن، حاول بعد لحظات.");
    assertEquals(body.tools_used, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Case 12: 400 with tool_use_failed triggers failover, normal 400 throws immediately", async () => {
  resetCooldowns();

  // Normal 400 -> throws without calling second model
  let callCount = 0;
  const callerNormal400 = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: (async () => {
      callCount += 1;
      return createMockResponse(400, { error: "Bad Request: invalid_parameter" });
    }) as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await callerNormal400({ messages: [{ role: "user", content: "test" }] });
    },
    Error,
    "Unrecoverable error"
  );
  assertEquals(callCount, 1);

  // 400 containing tool_use_failed -> should failover to next model
  const modelsCalled: string[] = [];
  const callerToolFailed400 = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      modelsCalled.push(body.model);
      if (body.model === DEFAULT_GROQ_MODELS[0]) {
        return createMockResponse(400, { error: "generation error: tool_use_failed" });
      }
      return createMockResponse(200, {
        choices: [{ message: { content: "إجابة بعد tool_use_failed" } }],
      });
    }) as unknown as typeof fetch,
  });

  const res = await callerToolFailed400({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };
  assertEquals(modelsCalled.length, 2);
  assertEquals(res.choices[0].message.content, "إجابة بعد tool_use_failed");
});
