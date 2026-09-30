# Plan: <name>
Implements: spec.md @ <sha> · intent.md @ <sha>

## 1. Summary
<!-- One line per spec deliverable: the deliverable, where it lands in the repository, and the phase that ships it. Refer to the section of the spec for each deliverable in the cross-reference form. -->

## 2. Work order
<!-- One row per phase, in merge order. "Phase" holds the number and the title of the phase, such as "1. Count the words". "Depends on" names the phases that merge first, or "None". "Merge gate" names the check that must pass before the merge. -->

| Phase | Depends on | Merge gate |
| --- | --- | --- |

## 3. Phases
<!-- One subsection "### 3.N Phase N: <title>" per phase, in the order of the work order. Each phase holds the five subsections below, numbered 3.N.1 to 3.N.5, in this order. A subsection that a phase adds takes the next number. -->

### 3.1 Phase 1: <title>

#### 3.1.1 Files that change
<!-- One line per file: the path from the repository root, then new, changed or deleted, then what changes. -->

#### 3.1.2 Behavior
<!-- What the phase makes the code do, with a cross-reference to each section of the spec that it implements. -->

#### 3.1.3 Tests
<!-- One line per test: its name, its file, and the claim that it proves. -->

#### 3.1.4 Commands
<!-- One line per command: the command, run from the repository root, and its expected result. -->

#### 3.1.5 Definition of done
<!-- The merge gate. Each item is a check that a script can do, such as a command and its exit code. -->

## 4. Test matrix
<!-- One row per spec requirement: the requirement, then the tests that prove it. -->

## 5. Risks before the work starts
<!-- What the code survey found that the spec did not know, and what can go wrong before the first phase merges. Write "None." when nothing is left. -->

## 6. Blockers
<!-- Each blocker is a spec gap that needs a human. Name the section of the spec. Write "None." when no blocker is left. -->

## 7. What changed
<!-- Empty in the first plan. During the build, one entry per unexpected finding that changes the plan, numbered 7.1, 7.2 and so on, in this form:

### 7.1 <YYYY-MM-DD> · Phase <N>
What changed in the plan, and why.
-->

<!--
Not here: the reason behind a spec decision, text polish for its own sake, and what a script can read from the repository. For the reason, refer to the section of the spec.
-->
