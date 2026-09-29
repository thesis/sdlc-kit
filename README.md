# sdlc-kit

thesis/sdlc-kit holds the components of the AI-native software development process at Thesis. The process follows [the AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook). The plugin in this repository supports the intent and the spec, two documents at the start of that process. Later components can add support for other stages.

## Claude plugin

The `sdlc-kit` plugin gives Claude the skills, the document templates and the writing rules for the intent and the spec. Claude writes each document as a Linear document, in the template of the plugin, and posts the open questions as comments on it.

### Install in Claude Code

Run these commands to add the marketplace and install the plugin:

```
claude plugin marketplace add thesis/sdlc-kit
claude plugin install sdlc-kit@thesis-sdlc-kit
```

The plugin installs for your user by default. For an install that covers every person in a repository, run this command in the repository:

```
claude plugin install sdlc-kit@thesis-sdlc-kit --scope project
```

The plugin adds the Linear MCP server. Log in to Linear before the first use. To log in, open the `/mcp` menu in Claude Code. Then select the Linear server.

### Install in the Claude app

The Claude app loads plugins in Cowork. Plain Chat does not load plugins.

1. Open the plugin page in Cowork.
2. Add the marketplace `thesis/sdlc-kit`.
3. Install `sdlc-kit` from the marketplace.

As an alternative to the marketplace, upload the plugin to Cowork as a package.

### Usage

A stage of work starts with an intent and continues with a spec. This is the flow from a need to an agreed spec:

1. Run `/sdlc-kit:intent`. Claude asks who owns the intent and which Linear team or project gets the document.
2. Answer the interview, one section at a time. Claude asks about the problem, who has it, what changes for them, and what is out of scope. Then it asks about the affected users and systems, the constraints, and what nobody knows yet. Say "unknown" when you do not know. The unknown becomes an open problem.
3. Claude writes the intent, runs the lint of the plugin on it, and creates the Linear document `Intent: <name>`. It posts a first comment that lists the open problems and @mentions the people who can answer them.
4. Discuss each open problem in its comment thread on the Linear document. Resolve the thread when the decision is made. When every open problem has an answer, or goes to the spec, set the `Status:` line of the intent to `agreed`.
5. Run `/sdlc-kit:spec <Linear URL of the intent>`. Claude reads the intent and its comment threads. It shows you the open problems and the decisions, and asks for your confirmation before it writes.
6. Claude does its research read-only, in the repository you name and in external sources. It asks you only about the forks that the research cannot settle. Then it creates the Linear document `Spec: <name>`, linked to the intent, with one comment per open decision.
7. Settle each open decision in its comment thread. When no open decision blocks the plan, set the `Status:` line of the spec to `agreed`.

Every document and every comment follows the writing rules of the plugin, based on Simplified Technical English. The lint checks the rules that a script can check. Claude runs it on each draft before it saves it and never saves a draft that fails. After three failed attempts, Claude gives you the outstanding findings and the path of the draft.

### All commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec <Linear URL of the intent>` turns an agreed intent into a spec and creates it as a Linear document.

The plugin also holds the `writing` skill. It has no command. Claude reads it before it writes a document or a comment.
