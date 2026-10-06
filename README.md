# sdlc-kit

thesis/sdlc-kit holds the components of the AI-native software development process at Thesis. The process follows [the AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook). The plugin in this repository supports the intent, the spec and the plan, the three documents of that process. Later components can add support for other stages.

## Claude plugin

The `sdlc-kit` plugin gives Claude the skills, the document templates and the writing rules for the intent, the spec and the plan. Claude writes the intent and the spec as Linear documents, in the template of the plugin. Each open problem or decision is a numbered item in its section of the document, with its owner. Claude writes the plan in a pull request in the repository where the feature lands.

### Install

#### Claude Code

```
claude plugin marketplace add thesis/sdlc-kit
claude plugin install sdlc-kit@thesis-sdlc-kit
```

Turn on auto-update. Run `/plugin`, open the **Marketplaces** tab, select `thesis-sdlc-kit` and select **Enable auto-update**.

Log in to Linear before the first use. Open `/mcp` and select the Linear server.

#### Claude App

1. Open **Customize > Plugins**.
2. Select **Add > Add marketplace** and enter `thesis/sdlc-kit`.
3. Add `sdlc-kit`.
4. Turn on **Sync automatically** for the marketplace.
5. Open the **Connectors** tab of the plugin and connect Linear.

The Claude App runs the plugin in Chat and in Cowork. Chat does not run the hook that checks each document against the writing rules. Cowork and Claude Code run it.

### Updates

#### Claude Code

Auto-update is the recommended way. Claude Code gets a new version when a session starts, and the next session loads it.

To update on demand, run these commands. Then run `/reload-plugins` in each open session.

```
claude plugin marketplace update thesis-sdlc-kit
claude plugin update sdlc-kit@thesis-sdlc-kit
```

#### Claude App

**Sync automatically** is the recommended way. To update on demand, open **Customize > Plugins** and select **Check for updates** on the marketplace.

### Usage

A stage of work starts with an intent, continues with a spec and ends with the build of the plan. You decide when a document is ready for the next command. Each document starts with a frontmatter of fields, such as `owner` and `relates`. The skills keep these fields. Do not edit the frontmatter by hand.

1. Run `/sdlc-kit:intent`. Answer the questions, one at a time. Say "unknown" when you do not know. You get a Linear document `Intent: <name>`. Its section "7. Open problems" lists each open problem with the person who can answer it.
2. Settle each open problem with its owner. Write the answer into the intent. A problem with no answer yet goes to the spec.
3. Run `/sdlc-kit:spec <Linear URL of the intent>`. When a spec of the intent exists, the command asks you what to do. Confirm the list of open problems and decisions that Claude shows you. Answer the questions that its research cannot settle. You get a Linear document `Spec: <name>`, linked to the intent. Its section "10. Open decisions" lists each open decision with its owner and date.
4. Settle each open decision with its owner. Write the decision into the spec.
5. Run `/sdlc-kit:plan <Linear URL of the spec>` in a checkout of the repository where the feature lands. When a plan of the spec exists, the command asks you what to do. Accept or change the name of the stage directory, `.sdlc-kit/YYYY-MM-<slug>/`. Answer the questions about the repository, such as the CI gates and stacked pull requests. You get a pull request with the intent, the spec and the plan, ready for review. From here, git holds the intent and the spec.
6. Review the shape of the plan, not each line, and merge it. Build each phase in its own pull request. Edit the plan only when the work finds something unexpected that changes it. When the last phase merges, the stage is done.

When comments pile up on an intent, a spec or a plan pull request, run `/sdlc-kit:steward <URL>`. Claude makes the copy edits, answers the questions with a source, and leaves each decision to you.

Every document and every comment follows the writing rules of the plugin, based on Simplified Technical English. The plugin checks each save and each push of a document. Each finding of the check has a severity: high, medium or low.

A save or a push with a high finding is denied. With only medium and low findings, the save or the push goes through, and Claude gets the findings. Claude fixes each finding that it can and retries. After three failed attempts, Claude gives you the findings that are left, with their severity, and offers to file them with `/sdlc-kit:feedback`.

Run `/sdlc-kit:feedback` to report a problem or an idea about the plugin. The report goes to Linear only, so a reporter with no GitHub account can use it too.

### All commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec <Linear URL of the intent>` turns an intent into a spec and creates the spec as a Linear document.
- `/sdlc-kit:plan <Linear URL of the spec>` exports the spec and the intent to the repository and writes the plan in a pull request.
- `/sdlc-kit:steward <Linear URL of an intent or a spec | GitHub URL of a pull request>` works the open comment threads and leaves each decision to the owner.
- `/sdlc-kit:feedback` files a problem report or an improvement idea about the plugin as a Linear issue.

The plugin also holds the `writing` skill and the `writing-judge` agent. Neither has a command. Claude reads the skill before it writes a document or a comment, and the gate runs the agent.
