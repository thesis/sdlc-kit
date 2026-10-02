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

Each document starts with a frontmatter of fields, such as `owner` and `status`. The skills write and update these fields. Do not edit the frontmatter by hand.

1. Run `/sdlc-kit:intent`. Answer the questions, one at a time. Say "unknown" when you do not know. You get a Linear document `Intent: <name>`, with a first comment that lists the open problems and @mentions the people who can answer them.
2. Discuss each open problem in its comment thread. Write the decision into the intent, then resolve the thread. When every thread is resolved, go to step 3. Each open problem then has an answer, or it goes to the spec as an open problem.
3. Run `/sdlc-kit:spec <Linear URL of the intent>`. The command stops when a thread on the intent is open. Otherwise it approves the intent first: the intent gets no more edits. Confirm the list of open problems and decisions that Claude shows you. Answer the questions that its research cannot settle. You get a Linear document `Spec: <name>`, linked to the intent, with one comment per open decision. A comment on the intent links the spec. When the run stops before the spec exists, run the command again. It goes on with the spec of the approved intent.
4. Settle each open decision in its comment thread. Write the decision into the spec, then resolve the thread. When every thread is resolved and no open decision blocks the plan, go to step 5.
5. Run `/sdlc-kit:plan <Linear URL of the spec>` in a checkout of the repository where the feature lands. The command stops when the intent is not approved or a thread on the spec is open. It also stops when a resolved thread has no outcome in the text. Accept or change the name of the stage directory, `.sdlc-kit/YYYY-MM-<slug>/`. Answer the questions about the repository, such as the CI gates and stacked pull requests. You get a pull request with the approved intent and spec and the plan, ready for review. Both Linear documents get its link. From here, git holds the intent and the spec.
6. Review the shape of the plan, not each line, and merge it. Build each phase in its own pull request. Edit the plan in a code pull request only when the work finds something unexpected that changes the plan. When the last phase merges, the stage is done.

When comments pile up on an intent, a spec or a plan pull request, run `/sdlc-kit:steward <URL>`. Pass the URL of the Linear document or of the pull request. One run works every open thread at that moment and stops. Claude makes the copy edits, answers the questions with a source, and leaves each decision to the owner.

Every document and every comment follows the writing rules of the plugin, based on Simplified Technical English. A save to Linear or a push of a stage document that breaks the rules is denied with the findings. Claude fixes the text and retries. After three failed attempts, Claude gives you the findings and the path of the draft, and offers to file them with `/sdlc-kit:feedback`.

Run `/sdlc-kit:feedback` to report a problem or an idea about the plugin. A reporter with no GitHub account can use it too, because the report goes to Linear only. The issue lands in the triage of the Linear team that the plugin names, and that team must exist.

### All commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec <Linear URL of the intent>` approves an intent with no open thread, turns it into a spec and creates the spec as a Linear document.
- `/sdlc-kit:plan <Linear URL of the spec>` approves a spec with no open thread, exports the spec and the intent to the repository and writes the plan in a draft pull request.
- `/sdlc-kit:steward <Linear URL of an intent or a spec | GitHub URL of a pull request>` works the open comment threads and leaves each decision to the owner.
- `/sdlc-kit:feedback` files a problem report or an improvement idea about the plugin as a Linear issue.

The plugin also holds the `writing` skill and the `writing-judge` agent. Neither has a command. Claude reads the skill before it writes a document or a comment, and the gate runs the agent.
