---
title: System Landscape Diagram
domain: architecture
kind: spec
status: active
summary: "This diagram illustrates the Next.js API acting as the central orchestration layer between the Microsoft ecosystem, external academic/government..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# System Landscape Diagram

This diagram illustrates the Next.js API acting as the central orchestration layer between the Microsoft ecosystem, external academic/government APIs, and the AI engine.

```mermaid
graph TD
    subgraph Users
        U[Client Browser]
    end

    subgraph "Core Hub (Next.js)"
        API[API Routes / Controller Layer]
        SVCS[Service Layer]
    end

    subgraph "Microsoft Ecosystem"
        DV[(Dynamics 365 / Dataverse)]
        SP[SharePoint / Graph API]
        ENTRA[Entra ID Auth]
    end

    subgraph "External Integrations"
        IRS[IRS BMF]
        LIT[PubMed / bioRxiv / ORCID]
    end

    subgraph "AI Engine"
        LLM[LLM Multi-Model Orchestration]
    end

    U <-->|NextAuth| ENTRA
    U --> API
    API --> SVCS

    SVCS <-->|DynamicsService| DV
    SVCS <-->|GraphService| SP
    
    SVCS -->|irs-bmf-service| IRS
    SVCS -->|literature-search-service| LIT
    
    SVCS <-->|llm-client| LLM
    
    classDef hub fill:#f9f6e6,stroke:#333,stroke-width:2px;
    class API,SVCS hub;
```
