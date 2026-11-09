import { assertEquals, assertRejects, assert } from "jsr:@std/assert";
import {
  callProvider,
  createModelCaller,
  setGroqCooldownUntil,
  getGroqCooldownUntil,
} from "../functions/ai-chat/index.ts";

// Helper to create mock responses
const createMockResponse = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
};

Deno.test("Case 1: Groq succeeds (Groq ينجح) - calls Groq, skips Gemini", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      return createMockResponse(200, {
        choices: [{ message: { content: "مرحباً، إجابة من Groq" } }],
      });
    }
    throw new Error("Gemini should not be called when Groq succeeds");
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calls.length, 1);
  assert(calls[0].includes("api.groq.com"));
  assertEquals(res.choices[0].message.content, "مرحباً، إجابة من Groq");
});

Deno.test("Case 2: Groq returns 429 (Groq يعيد 429) - fails over to Gemini and sets cooldown", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      return createMockResponse(429, { error: "Rate limit reached" }, { "retry-after": "30" });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(200, {
        choices: [{ message: { content: "إجابة احتياطية من Gemini بعد 429" } }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calls.length, 2);
  assert(calls[0].includes("api.groq.com"));
  assert(calls[1].includes("generativelanguage.googleapis.com"));
  assertEquals(res.choices[0].message.content, "إجابة احتياطية من Gemini بعد 429");
  assert(getGroqCooldownUntil() > Date.now());

  // Subsequent call while in cooldown should bypass Groq and call Gemini directly
  calls.length = 0;
  const res2 = await caller({ messages: [{ role: "user", content: "test 2" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };
  assertEquals(calls.length, 1);
  assert(calls[0].includes("generativelanguage.googleapis.com"));
  assertEquals(res2.choices[0].message.content, "إجابة احتياطية من Gemini بعد 429");
});

Deno.test("Case 3: Groq returns 500 (Groq يعيد 500) - fails over to Gemini", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      return createMockResponse(500, { error: "Internal Server Error" });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(200, {
        choices: [{ message: { content: "إجابة من Gemini بعد خطأ 500 في Groq" } }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calls.length, 2);
  assert(calls[0].includes("api.groq.com"));
  assert(calls[1].includes("generativelanguage.googleapis.com"));
  assertEquals(res.choices[0].message.content, "إجابة من Gemini بعد خطأ 500 في Groq");
});

Deno.test("Case 4: Groq times out (Groq ينتهي بمهلة) - fails over to Gemini", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      const err = new Error("The signal has been aborted");
      err.name = "TimeoutError";
      throw err;
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(200, {
        choices: [{ message: { content: "إجابة من Gemini بعد انتهاء مهلة Groq" } }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calls.length, 2);
  assert(calls[0].includes("api.groq.com"));
  assert(calls[1].includes("generativelanguage.googleapis.com"));
  assertEquals(res.choices[0].message.content, "إجابة من Gemini بعد انتهاء مهلة Groq");
});

Deno.test("Case 5: Groq fails in round 2 of tools (Groq يفشل في الجولة الثانية) - Gemini completes conversation seamlessly", async () => {
  setGroqCooldownUntil(0);
  let groqCallCount = 0;
  let geminiCallCount = 0;

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes("api.groq.com")) {
      groqCallCount += 1;
      if (groqCallCount === 1) {
        // Round 1: Groq succeeds and returns a tool call
        return createMockResponse(200, {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_abc123",
                    type: "function",
                    function: {
                      name: "get_low_stock",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      // Round 2: Groq fails with 503
      return createMockResponse(503, { error: "Service Unavailable" });
    }

    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCallCount += 1;
      // Verify that Gemini receives the messages history including tool response
      const body = JSON.parse(init?.body as string);
      const msgs = body.messages as Array<{ role: string; content?: string; name?: string }>;
      assert(msgs.some((m) => m.role === "tool" && m.name === "get_low_stock"));

      return createMockResponse(200, {
        choices: [
          {
            message: {
              content: "المنتجات المنخفضة هي: حليب المراعي (2 علبة)، سكر الأسرة (1 كيس).",
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> = [
    { role: "system", content: "أنت مساعد متجر بقالة." },
    { role: "user", content: "ما هي المنتجات منخفضة المخزون؟" },
  ];

  // Round 1: Groq calls tool
  const round1 = await caller({ messages, tools: [], tool_choice: "required" }) as {
    choices: Array<{ message: { tool_calls: Array<{ id: string; function: { name: string } }> } }>;
  };
  assertEquals(round1.choices[0].message.tool_calls[0].function.name, "get_low_stock");

  // Push tool call & tool result to messages
  messages.push({
    role: "assistant",
    content: "",
    tool_calls: round1.choices[0].message.tool_calls,
  });
  messages.push({
    role: "tool",
    tool_call_id: "call_abc123",
    name: "get_low_stock",
    content: JSON.stringify([{ name: "حليب المراعي", stock: 2 }, { name: "سكر الأسرة", stock: 1 }]),
  });

  // Round 2: Groq fails -> Gemini picks up
  const round2 = await caller({ messages }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(groqCallCount, 2);
  assertEquals(geminiCallCount, 1);
  assertEquals(
    round2.choices[0].message.content,
    "المنتجات المنخفضة هي: حليب المراعي (2 علبة)، سكر الأسرة (1 كيس)."
  );
});

Deno.test("Case 6: Both fail (كلاهما يفشل) - error thrown to trigger friendly fallback", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      return createMockResponse(502, { error: "Bad Gateway" });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(503, { error: "Service Overloaded" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await caller({ messages: [{ role: "user", content: "test" }] });
    },
    Error,
    "Both Groq and Gemini failed"
  );

  assertEquals(calls.length, 2);
});

Deno.test("Case 7A: Only Groq key exists (Groq فقط) - succeeds or fails without Gemini", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("api.groq.com")) {
      return createMockResponse(500, { error: "Internal Error" });
    }
    throw new Error("Should not reach Gemini when key is missing");
  };

  const caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: undefined,
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await caller({ messages: [{ role: "user", content: "test" }] });
    },
    Error,
    "Groq failed"
  );

  assertEquals(calls.length, 1);
});

Deno.test("Case 7B: Only Gemini key exists (Gemini فقط) - calls Gemini directly", async () => {
  setGroqCooldownUntil(0);
  const calls: string[] = [];

  const mockFetch = async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(200, {
        choices: [{ message: { content: "إجابة من Gemini مباشرة" } }],
      });
    }
    throw new Error("Should not reach Groq when key is missing");
  };

  const caller = createModelCaller({
    groqKey: undefined,
    geminiKey: "mock-gemini-key",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const res = await caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };

  assertEquals(calls.length, 1);
  assert(calls[0].includes("generativelanguage.googleapis.com"));
  assertEquals(res.choices[0].message.content, "إجابة من Gemini مباشرة");
});

Deno.test("Case 8: Groq 400 with tool_use_failed triggers failover, but normal 400 does not", async () => {
  setGroqCooldownUntil(0);

  // Normal 400 (e.g. malformed body) -> should NOT failover
  const normal400Caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("api.groq.com")) {
        return createMockResponse(400, { error: "Invalid parameter: max_tokens must be positive" });
      }
      throw new Error("Should not failover on normal 400");
    }) as unknown as typeof fetch,
  });

  await assertRejects(
    async () => {
      await normal400Caller({ messages: [{ role: "user", content: "test" }] });
    },
    Error,
    "Groq failed"
  );

  // 400 containing 'tool_use_failed' -> SHOULD failover to Gemini
  const toolFail400Caller = createModelCaller({
    groqKey: "mock-groq-key",
    geminiKey: "mock-gemini-key",
    fetchFn: (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("api.groq.com")) {
        return createMockResponse(400, { error: "failed generation: tool_use_failed" });
      }
      if (url.includes("generativelanguage.googleapis.com")) {
        return createMockResponse(200, {
          choices: [{ message: { content: "نجح بعد tool_use_failed" } }],
        });
      }
      throw new Error("Unexpected URL");
    }) as unknown as typeof fetch,
  });

  const res = await toolFail400Caller({ messages: [{ role: "user", content: "test" }] }) as {
    choices: Array<{ message: { content: string } }>;
  };
  assertEquals(res.choices[0].message.content, "نجح بعد tool_use_failed");
});

Deno.test("Case 9: Handler fallback response when both providers fail - returns 200 with friendly Arabic message", async () => {
  // Set required dummy env vars for handler
  Deno.env.set("SUPABASE_URL", "https://dummy.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "dummy-anon-key");
  Deno.env.set("GROQ_API_KEY", "dummy-groq-key");
  Deno.env.set("GEMINI_API_KEY", "dummy-gemini-key");

  // Mock global fetch to fail for both model providers, but return mock data for Supabase auth/RPC
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("auth/v1/user")) {
      return createMockResponse(200, { user: { id: "user-123" } });
    }
    if (url.includes("store_members")) {
      return createMockResponse(200, { role: "owner", is_active: true });
    }
    if (url.includes("rpc/check_and_increment_ai_rate_limit")) {
      return createMockResponse(200, { allowed: true });
    }
    if (url.includes("api.groq.com")) {
      return createMockResponse(500, { error: "Groq Down" });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return createMockResponse(503, { error: "Gemini Down" });
    }
    return originalFetch(input);
  }) as unknown as typeof fetch;

  try {
    const { handler } = await import("../functions/ai-chat/index.ts");
    const req = new Request("http://localhost/ai-chat", {
      method: "POST",
      headers: {
        "Authorization": "Bearer mock-token-12345",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_id: "00000000-0000-0000-0000-000000000000",
        message: "كم عدد المنتجات المنتهية؟",
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
