# sdlc-kit

thesis/sdlc-kit holds the components of the AI software development process at Thesis. In that process, each stage of work has three documents. The intent states the problem and the outcome. The spec states how the functionality works, for business, product and engineering readers. The plan tells the agents that build the change what to do. Intent and spec start as Linear documents, where people discuss them, and the plan is a pull request in the target repository.

## Plugins

The `plugins/` directory holds one plugin per directory. The first plugin is `sdlc-kit`, in `plugins/sdlc-kit/`. It gives Claude the skills, the document templates and the writing rules for the intent and the spec. The marketplace file `.claude-plugin/marketplace.json` lists every plugin in this repository.

## Install in Claude Code

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

## Install in the Claude app

The Claude app loads plugins in Cowork. Plain Chat does not load plugins.

1. Open the plugin page in Cowork.
2. Add the marketplace `thesis/sdlc-kit`.
3. Install `sdlc-kit` from the marketplace.

As an alternative to the marketplace, upload the plugin to Cowork as a package.

## Commands

- `/sdlc-kit:intent` interviews the owner, writes the intent and creates it as a Linear document.
- `/sdlc-kit:spec` turns an agreed intent into a spec and creates it as a Linear document.

## Lint

The skills run a lint on each draft before they save it. The lint is a Node 22 script with no dependencies. To run it by hand on a document:

```
node plugins/sdlc-kit/scripts/lint.mjs --type intent path/to/intent.md
```

The types are `intent`, `spec`, `plan` and `prose`. The `prose` type runs the writing checks only, for text that has no template, such as this README. Add `--json` for output that a script can read. The exit code is 1 when a finding exists and 0 when the document is clean.

To run the tests of the lint:

```
node --test 'plugins/sdlc-kit/scripts/*.test.mjs'
```
