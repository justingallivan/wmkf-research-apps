# Dynamics Explorer Guide

Query your Dynamics 365 CRM data using natural language. No need to write OData queries — just ask questions in plain English.

## Overview

Dynamics Explorer is an AI-powered chatbot that translates your questions into
CRM queries, executes them, and presents the results in a readable format. It
uses live schema metadata, but only exposes entities and fields allowed by the
server-side restriction policy.

## Getting Started

1. Open **Dynamics Explorer** from the home page or navigation
2. Type a question in the chat box
3. The AI processes your request, queries the CRM, and returns results

## What You Can Ask

### Finding Records

- "Find all requests from Stanford University"
- "Show me proposals submitted in 2024"
- "Look up request number 1001289"
- "Find contacts with email ending in @mit.edu"

### Searching by Content

- "Search for proposals about fungi"
- "Find requests mentioning CRISPR"
- "Search for anything related to quantum computing"

Content searches use the Dataverse Search API, which searches across all indexed text fields simultaneously — including proposal abstracts.

### Counting and Summarizing

- "How many active requests are there?"
- "Count proposals by status"
- "What are the most common research topics this year?"

### Exploring Relationships

- "Who are the contacts for request 1001289?"
- "Show me the review history for this proposal"
- "What documents are linked to this request?"

Document lookups walk the active library plus three archive libraries (`akoya_request`, `RequestArchive1`, `RequestArchive2`, `RequestArchive3`) and recurse into subfolders, so older grants whose files were migrated from a previous system still surface correctly.

## Understanding Results

Results are displayed as formatted tables or summaries depending on the query type:

- **Record lists** show key fields in a table with clickable details
- **Single records** show all relevant fields in a structured view
- **Counts** are presented as numbers with context
- **Search results** include relevance scores and highlighted matching text

## Multi-Turn Conversations

The chat sends at most six messages with each request. Histories of six or
fewer messages are sent unchanged. When a longer history is trimmed, two
synthetic context notices plus the four most recent real messages—normally two
user/assistant exchanges—are sent, so you can:

1. Ask "Show me requests from 2024"
2. Follow up with "Which of those are from California?"
3. Then "Show me the details for the third one"

Within that bounded window, the AI can use recent results to refine or drill
into them. Older turns are not part of the active model context.

## Exporting Data

- Click **Export Chat** to download the conversation including all query results
- Query results can also be exported as Excel (`.xlsx`) for tabular data
- Tables in results can be copied to clipboard for pasting into spreadsheets

## Tips

- **Be specific** — "Find requests from Stanford" works better than "Show me some university requests"
- **Use field names** if you know them — "Filter by akoya_requeststatus = Active" gives precise results
- **Ask for help** — "What tables are available?" or "What fields does the request table have?" to explore the schema
- **Narrow searches** — If a search returns too many results, add qualifiers: time range, institution, status, etc.
- **Natural dates work** — "Requests from last month", "Proposals submitted before January 2024"

## Limitations

- List/export retrieval is capped (up to 5,000 rows for supported export paths);
  count requests use a distinct-count query and are not estimates based on that
  retrieval cap
- Some tables or fields may be restricted based on your role
- Complex aggregations (averages, percentiles) may require multiple queries
- The AI may occasionally misinterpret ambiguous queries — rephrase if results seem off
