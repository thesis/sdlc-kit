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

A stage of work starts with an intent, continues with a spec and ends with the build of the plan.

1. Run `/sdlc-kit:intent`. Answer the questions, one at a time. Say "unknown" when you do not know. You get a Linear document `Intent: <name>`, with a first comment that lists the open problems and @mentions the people who can answer them.
2. Discuss each open problem in its comment thread. Resolve the thread when the decision is made. When every open problem has an answer, or goes to the spec, set the `Status:` line of the intent to `agreed`.
3. Run `/sdlc-kit:spec <Linear URL of the intent>`. Confirm the list of open problems and decisions that Claude shows you. Answer the questions that its research cannot settle. You get a Linear document `Spec: <name>`, linked to the intent, with one comment per open decision.
4. Settle each open decision in its comment thread. When no open decision blocks the plan, set the `Status:` line of the spec to `agreed`.
5. Run `/sdlc-kit:plan <Linear URL of the spec>` in a checkout of the repository where the feature lands. The command stops when the spec is not agreed, or when a resolved thread has no outcome in the text. Accept or change the name of the stage directory, `.sdlc-kit/YYYY-MM-<slug>/`. Answer the questions about the repository, such as the CI gates and stacked pull requests. You get a pull request with the frozen intent and spec and the plan, ready for review. Both Linear documents get its link. From here, git holds the intent and the spec.
6. Review the shape of the plan, not each line, and merge it. Build each phase in its own pull request. Edit the plan in a code pull request only when the work finds something unexpected that changes the plan. When the last phase merges, the stage is done.

When comments pile up on an intent, a spec or a plan pull request, run `/sdlc-kit:steward <URL>`. Pass the URL of the Linear document or of the pull request. One run works every open thread at that moment and stops. Claude makes the copy edits, answers the questions with a source, and leaves each decision to the owner.

Every document and every comment follows the writing rules of the plugin, based on Simplified Technical English. A save to Linear or a push of a stage document that breaks the rules is denied with the findings. Claude fixes the text and retries. After three failed attempts, Claude gives you the findings and the path of the draft.

### All commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec <Linear URL of the intent>` turns an agreed intent into a spec and creates it as a Linear document.
- `/sdlc-kit:plan <Linear URL of the spec>` freezes the agreed intent and spec, exports them to the repository and writes the plan in a draft pull request.
- `/sdlc-kit:steward <Linear URL of an intent or a spec | GitHub URL of a pull request>` works the open comment threads and leaves each decision to the owner.

The plugin also holds the `writing` skill and the `writing-judge` agent. Neither has a command. Claude reads the skill before it writes a document or a comment, and the gate runs the agent.
