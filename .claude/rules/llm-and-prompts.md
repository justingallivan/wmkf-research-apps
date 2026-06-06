---
paths:
  - "lib/services/llm-client.js"
  - "lib/services/execute-prompt.js"
  - "lib/services/*prompt*"
  - "shared/config/prompts/**"
  - "pages/api/**"
---

# LLM And Prompt Surfaces

Use `lib/services/llm-client.js` instead of direct provider fetches. Shared execution follows `docs/EXECUTOR_CONTRACT.md`; bundled prompt fallback restrictions remain in source. Preserve untrusted-content boundaries and run `check:prompt-injection-tagging` plus its self-test sequentially when touching registered prompt surfaces.
