# sdlc-kit

thesis/sdlc-kit holds the components of the AI-native software development process at Thesis. The process follows [the AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook). The plugin in this repository supports the intent, the spec and the plan, the three documents of that process. Later components can add support for other stages.

## Claude plugin

The `sdlc-kit` plugin gives Claude the skills, the document templates and the writing rules for the intent, the spec and the plan. Claude writes the intent and the spec as Linear documents, in the template of the plugin, and posts the open questions as comments on them. Claude writes the plan in a pull request in the repository where the feature lands.

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

A stage of work starts with an intent, continues with a spec and ends with the build of the plan. This is the flow from a need to a finished stage:

1. Run `/sdlc-kit:intent`. Claude asks who owns the intent and which Linear team or project gets the document.
2. Answer the interview, one section at a time. Claude asks about the problem, who has it, what changes for them, and what is out of scope. Then it asks about the affected users and systems, the constraints, and what nobody knows yet. Say "unknown" when you do not know. The unknown becomes an open problem.
3. Claude writes the intent, runs the lint of the plugin on it, and creates the Linear document `Intent: <name>`. It posts a first comment that lists the open problems and @mentions the people who can answer them.
4. Discuss each open problem in its comment thread on the Linear document. Resolve the thread when the decision is made. When every open problem has an answer, or goes to the spec, set the `Status:` line of the intent to `agreed`.
5. Run `/sdlc-kit:spec <Linear URL of the intent>`. Claude reads the intent and its comment threads. It shows you the open problems and the decisions, and asks for your confirmation before it writes.
6. Claude does its research read-only, in the repository you name and in external sources. It asks you only about the forks that the research cannot settle. Then it creates the Linear document `Spec: <name>`, linked to the intent, with one comment per open decision.
7. Settle each open decision in its comment thread. When no open decision blocks the plan, set the `Status:` line of the spec to `agreed`.
8. Run `/sdlc-kit:plan <Linear URL of the spec>` in a checkout of the repository where the feature lands. Claude checks that the spec is agreed and that the text of each document holds the outcome of each resolved thread. It names each thread whose outcome is missing, and stops.
9. Claude proposes the name of the stage directory, `.sdlc-kit/YYYY-MM-<slug>/`. Accept the name or change it.
10. Claude sets the status of the intent and the spec to `frozen` in Linear and exports both documents to the stage directory. It opens a draft pull request with the two files and posts the link of the pull request on both Linear documents. From here, git holds the intent and the spec.
11. Claude reads the code that each deliverable of the spec touches. It asks you only about the choices of the repository, such as the CI gates, the test budget and stacked pull requests. Then it writes `plan.md`, with one pull request per phase.
12. The completeness judge reads the plan and the repository in a fresh context. It lists what an agent cannot find out from the plan alone. Claude fixes the plan until the list is empty, or gives you the list after three runs.
13. Claude pushes the plan to the pull request and marks the pull request ready for review. Review the shape of the plan, not each line.
14. Build each phase in its own pull request. Edit the plan in that pull request only when the work finds something unexpected that changes the plan. The edit adds an entry to "7. What changed" of the plan, with the correction to the phase, the spec or the intent.
15. When the last phase merges, the stage is done. Nothing in it changes again. A new need starts a new intent.

Every document and every comment follows the writing rules of the plugin, based on Simplified Technical English. The lint checks the rules that a script can check. The writing judge checks the other rules, in a fresh context with no access to the conversation. Claude runs the lint on each draft before it saves it. Then the gate of the plugin runs the lint and the judge on every save of an intent or a spec to Linear. It also runs them on every push of a stage document. The gate stops the save or the push of a document that fails. After three failed attempts, Claude gives you the outstanding findings and the path of the draft.

### All commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec <Linear URL of the intent>` turns an agreed intent into a spec and creates it as a Linear document.
- `/sdlc-kit:plan <Linear URL of the spec>` freezes the agreed intent and spec, exports them to the repository and writes the plan in a draft pull request.

The plugin also holds the `writing` skill and the `writing-judge` and `completeness-judge` agents. None of them has a command. Claude reads the skill before it writes a document or a comment. The gate runs the writing judge, and the plan skill runs the completeness judge.
