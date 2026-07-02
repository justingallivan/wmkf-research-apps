---
title: "Security Fortress & Identity Diagram"
domain: architecture
kind: spec
status: active
summary: "This flowchart demonstrates the \"Fail-Closed\" security architecture mandated by the project guidelines, highlighting the specific restriction..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# Security Fortress & Identity Diagram

This flowchart demonstrates the "Fail-Closed" security architecture mandated by the project guidelines, highlighting the specific restriction scopes and sanitization methods.

```mermaid
flowchart TD
    Req[Incoming Request] --> NA{NextAuth signIn}
    NA -- "Error/Failure" --> Fail[Fail-Closed / Reject]
    NA -- "Success" --> Mid[Next.js Middleware]
    
    Mid --> API[API Route Handler]
    
    API --> DS[DynamicsService]
    API --> GS[GraphService]
    
    subgraph "Strict Boundaries"
        DS --> CR{checkRestriction\nwith requestId}
        CR -- Pass --> D_Query[(Execute Query)]
        CR -- Fail --> Blocked[Reject Query]
        
        GS --> PS{Path Sanitization\nBlock '..'}
        PS -- Pass --> G_Query[(Read SharePoint)]
        PS -- Fail --> Blocked
    end
    
    D_Query --> SP[sanitizeProfile]
    SP --> Res[Clean JSON Response]
```
