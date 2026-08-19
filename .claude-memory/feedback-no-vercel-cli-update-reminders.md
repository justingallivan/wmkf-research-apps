---
name: feedback-no-vercel-cli-update-reminders
description: "Do not remind Justin to update the Vercel CLI. It auto-updates and Vercel releases too frequently for routine version-gap notices to be useful. Mention the version only when a concrete incompatibility blocks the requested work."
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-08-19 (owner restated this as a lasting rule)
---

## Recall Rule

Read this before reporting a Vercel CLI version difference or recommending a
Vercel CLI upgrade.

## The Rule

Do not remind Justin to update the Vercel CLI. His installation is configured
to auto-update, and Vercel releases versions frequently enough that routine
version-gap notices are noise.

Mention or recommend a Vercel CLI update only when a concrete, observed version
incompatibility blocks or materially impairs the requested work. Do not infer a
compatibility problem from the existence of a newer release alone.

## Why

This preference was stated more than once before being made durable. A generic
tool-version warning interrupted otherwise relevant status reporting without
helping the task. The durable rule prevents future sessions from repeating it.
