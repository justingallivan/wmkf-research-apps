# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are W. M. Keck Foundation program directors and other internal
staff carrying out grant review and operations. Product decisions should
prioritize their ability to understand a request, work with its documents and
data, exercise judgment, and complete the next operational step.

Secondary users include superusers who administer and monitor the suite,
external reviewers who use narrowly scoped review workflows, and applicants.
The applicant-intake product is currently parked, so applicants are not the
priority audience for current internal-suite decisions.

## Product Purpose

The suite gives WMKF staff purpose-built tools for grant workflows that are
awkward or fragmented across AkoyaGO, Dataverse, and SharePoint. It brings CRM
records, documents, AI-assisted analysis, reviewer work, and operational actions
into focused workflows so staff spend less time moving files and repeating
procedural work and more time reading, deciding, editing, and collaborating.

Success means the tools reduce manual friction while preserving staff ownership
of consequential judgment and returning settled organizational records to the
systems that own them.

## Positioning

The product is a working layer over Dataverse and SharePoint, not a replacement
CRM or a second system of record. Its distinguishing mechanism is to unify grant
records and documents in task-specific interfaces, automate rote work in place,
and keep people actively responsible for interpretation and decisions. It is
not intended to replace AkoyaGO in the near term.

## Operating Context

Staff work across AkoyaGO/Dynamics 365, Dataverse, SharePoint, Microsoft Entra
ID, email, proposal and review documents, and the Vercel-hosted app suite. A
grant request is the principal unit of work. The Request Workbench is the main
per-request staff surface for reviewer and grant operations, while additional
apps support analysis, CRM exploration, integrity screening, reporting, and
other focused tasks.

The grant cycle and its processes continue to evolve. The suite is organized as
modular capabilities rather than a rigid end-to-end pipeline, and it supports
both governed task outputs and open-ended interactive analysis.

## Capabilities and Constraints

- Dataverse and SharePoint are the authoritative homes for settled
  organizational data and documents; application state elsewhere must have an
  explicit operational, staging, audit, or user-specific purpose.
- Internal access is authenticated through Microsoft Entra ID and filtered by
  per-app grants, active-user checks, and superuser privileges. External
  reviewers and applicants use separately scoped entry points.
- The suite handles sensitive grant, applicant, reviewer, and organizational
  information. Interfaces must preserve authorization boundaries, provenance,
  and explicit confirmation around consequential actions.
- AI output assists staff work but does not replace human review or judgment.
- The applicant-intake foundation exists, but the product build is parked while
  WMKF evaluates the GOApply re-engineering.
- There is no suite-wide WCAG 2.1 AA commitment at this time. Individual
  surfaces may carry their own explicit accessibility requirements.

## Brand Commitments

The product serves the W. M. Keck Foundation and should use established WMKF
terminology accurately. No logo or other visual asset is currently binding
across the internal-facing apps, and future design work should not introduce a
suite-wide logo treatment by assumption.

## Evidence on Hand

- `README.md` describes the deployed multi-app suite, authentication model, and
  active guide structure.
- `docs/SYSTEM_MODEL.md` defines the organizing principle, users' operating
  systems, interaction modes, and the relationship among the Workbench,
  Dataverse, SharePoint, and AkoyaGO.
- `docs/STRATEGY.md` records the product direction, current workflow friction,
  modularity, human-judgment boundary, and source-of-truth commitments.
- `shared/config/appRegistry.js` is the live authority for active app names,
  routes, descriptions, and access-grant keys.
- The repository contains working interfaces, tests, operational evidence, and
  production-status documentation. It does not provide permission to invent
  testimonials, impact metrics, customer claims, or adoption claims.
- `public/keck-logo.png` exists as an asset, but the owner confirmed that the
  internal-facing apps do not currently use a binding logo treatment.

## Product Principles

1. Automate what is rote; preserve people’s responsibility for judgment.
2. Treat Dataverse and SharePoint as organizational truth, and work with their
   records and documents in place.
3. Unite data, documents, and actions around the user’s real task instead of
   exposing storage-system boundaries.
4. Build modular capabilities that can adapt as the grant cycle changes.
5. Make consequential state changes explicit, attributable, and recoverable.
