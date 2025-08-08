# Hypermodel 

## Overview 
Context is everything for coding agents. 

Make your coding agents better with the right documentation, _auto-updated_ for you and _in context_, all the time. 



## Auto-install in one command  

> npx -y -p @hypermodel/cli add-docs claude

### Usage with an AI coding agent like Claude Code or Amp

Use `@hypermodel/docs` MCP server with your favourite AI coding agent 

**Common Usage Patterns**
  
**Examples**: 

1. `can you call search the docs on how to use "contact" objects ?`
  
2. `Explain amp.tools.stopTimeout and its default in the docs of ampcode. use docs tool`

**Quick Start Flow**
  1. **Check available docs**: Use `list-docs` to see what documentation is already available.
  2. **Search documentation**: Use `search-docs` with the index name, your query, and optional result count.
  3. **Create new indices** (if needed): Use `index` tool to index a new documentation source if not already present. 
  
>  Tip: Use the base documentation URL (https://supabase.com/docs) instead of an inner link (https://supabase.com/docs/guides/functions/dependencies)



**Tools exposed for your coding agents**

| Tool           | Description                                                      | Output / Result                                                      |
|----------------|------------------------------------------------------------------|----------------------------------------------------------------------|
| `list-docs` | Check what documentation is available                            | `{ "indexes": ["ampcode-com", "developer-salesforce-com"] }`         |
| `search-docs`  | Search documentation for answers                                 | Returns ranked results with URLs, titles, snippets, and relevance scores |
| `index`        | Add a new documentation source if not already present            | Creates searchable index from the documentation site                  |

**Tips for Best Results**
  - Use natural language queries with the terms `search` `docs` anywhere in your prompt for the MCP tool to be used. 
  - Start with broader queries, then narrow down based on results
  - Results include relevance scores to help identify the most useful content

#### All IDEs supported

* Cursor (`cursor`)
  - Example:
    ```bash
    npx -y -p @hypermodel/cli add-docs cursor
    ```
* Vscode (`vscode`)
  - Example:
    ```bash
    npx -y -p @hypermodel/cli add-docs vscode
    ```
* Ampcode (`amp`)
  - Example:
    ```bash
    npx -y -p @hypermodel/cli add-docs amp
    ```

#### Don't see your IDE?

- **Request support** by opening a GitHub issue: [Request support for another IDE](https://github.com/hypermodel-labs/docs/issues/new?title=Support%20for%20IDE:%20Your%20IDE%20Name&body=Please%20add%20support%20for%20%60Your%20IDE%20Name%60.%0A%0AHelpful%20details%20to%20include:%0A-%20IDE%20version:%20%0A-%20OS:%20%0A-%20Relevant%20links%20or%20docs:%20)
- Or go to the issues page: `https://github.com/hypermodel-labs/docs/issues`



## Contributing
Looking to contribute? All kinds of help is highly appreciated. 

Checkout our contribution [guide](./CONTRIBUTING.md) for more. 


