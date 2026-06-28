# 🚀 Codebase Evolution Plan: Phase II Research Tools

**Reviewer:** Senior Engineering Lead  
**Status:** Strategic Refactoring  
**Target:** Improved Maintainability, Type Safety, and Composability

## 1. Executive Summary
The foundation of this system is exceptionally strong. The implementation of the `LLMClient` shows a high degree of maturity regarding error handling, retry logic, and security (SSRF protection and secret redaction). The security-first approach to authentication and Dynamics integration is excellent.

Our next phase is not about adding features, but about **technical debt reduction** and **architectural hardening**. As the system grows to 13+ applications, we must move away from "God Components" and manual logic toward reusable abstractions.

---

## 2. Priority 1: Decomposing "God Components"
The current page components (e.g., `pages/phase-ii-writeup.js`) are handling too many responsibilities: state management, modal logic, SSE streaming, and manual UI rendering.

### 📝 Action Items:
*   **Extract Modals:** Move `QAModal`, `FeedbackModal`, and `WordExportModal` into `shared/components/`. Use props for state and callbacks.
*   **Encapsulate UI Logic:** Create a `QAPanel` component that manages its own internal scrolling and message list rendering.
*   **Logic Extraction:** Move the `renderMarkdown` regex logic out of the component. (See Section 3).

---

## 3. Priority 2: Standardizing Logic & Utilities
We have several instances where we are "reinventing the wheel" with manual logic that is brittle and hard to test.

### 📝 Action Items:
*   **Deprecate Manual Markdown Parsing:** In `phase-ii-writeup.js`, replace the `renderMarkdown` function with the `marked` library already in `package.json`.
    *   *Why:* Regex-based HTML generation is prone to XSS and fails on nested markdown structures.
*   **Unified AI Streaming Hook:** Create a `useAIStream` custom hook.
    *   *Target:* Abstract the `reader.read()` and SSE `data: ` parsing logic.
    *   *Benefit:* This will reduce the code in `pages/` by ~100 lines per file and ensure progress tracking is handled identically across all app pages.

---

## 4. Priority 3: Service Layer Organization
The `lib/services/` directory is becoming a "flat-file jungle" with 40+ files. This increases cognitive load for new developers.

### 📝 Action Items:
*   **Categorize Services:** Move files into the following structure:
    *   `lib/services/ai/` (`llm-client.js`, `prompt-resolver.js`, `model-resolver.js`)
    *   `lib/services/data/` (`database-service.js`, `dynamics-service.js`, `dataverse-settings.js`)
    *   `lib/services/integrations/` (`arxiv-service.js`, `pubmed-service.js`, `orcid-service.js`)
*   **Clean Up Dead Code:** In `DatabaseService.js`, the "gutted" researcher operations should be removed. We have Git history if we ever need to see them again; keeping them as comments creates "broken window" syndrome.

---

## 5. Priority 4: Introduction of Type Safety
With ~54,000 lines of code, the absence of types is our biggest risk for regression.

### 📝 Action Items:
*   **TypeScript Migration (Incremental):** Start by converting core utility and service files to `.ts`.
    *   *First Targets:* `lib/services/llm-client.js` and `shared/config/baseConfig.js`.
*   **Define Core Interfaces:** Create types for `LLMResponse`, `UserProfile`, and `DynamicsQuery`. This will eliminate the frequent `if (!data) return` checks and `undefined` errors.

---

## 6. Implementation Roadmap

### Phase 1: Quick Wins (Week 1)
1.  **Switch to `marked`** for all markdown rendering to improve security and reliability.
2.  **Move "Gutted" code** from `DatabaseService.js` to a legacy archive or delete it.
3.  **Implement `useAIStream` hook** and refactor one page to use it as a proof of concept.

### Phase 2: Structural Refactor (Week 2-3)
1.  **Sub-folder organization** of `lib/services/`.
2.  **Component Extraction:** Break down `phase-ii-writeup.js` into at least 4 smaller components.
3.  **Standardize ESM:** Replace remaining `require()` calls with `import` unless there is a documented architectural reason for CommonJS.

### Phase 3: Hardening (Ongoing)
1.  **Add JSDoc or TypeScript** to all new service methods.
2.  **Expand Unit Tests** to cover the new `useAIStream` hook and decomposed components.

---

## 💡 Pro-Tip for the Junior Dev:
"Seniority isn't just about solving the problem; it's about solving it in a way that the next person (who might be you in six months) can understand without a map. Focus on **predictability** and **isolation of concerns**. If a file is over 300 lines, it's usually trying to do too much."
