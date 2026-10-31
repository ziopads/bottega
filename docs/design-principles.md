# Design principles

The intended behaviour of Bottega's core, for anyone changing it, human or Claude. `REQUIREMENTS.md` says what is built, requirement by requirement; this says why it works the way it does. Where the two disagree, raise it rather than choosing silently.

## 1. A workflow is a series of stages

Every project moves through ordered stages and is in exactly one at a time (W-2). There is a default template, and a user can create their own to customize the stages and the criteria in each stage (W-13).

## 2. A stage has criteria and to-dos

Two kinds of item sit under a stage. Criteria come from the template and say what it takes to finish the stage. To-dos are the user's own list of actions. Both have to be done for the stage to be complete.

**Criteria** are the pre-made, templated conditions for finishing each stage.
- Each is a condition the user can check, written to be checkable: "Kick and snare chosen and tuned to the key", not "work on drums".
- They come from the user's template and are copied to each project when its workflow starts, so later stages show how far there is to go (W-3). They are guidance, not fixed: the user can add, change and remove them on a project, and Claude can propose more, which the user accepts or rejects.
- A criterion can carry a hint (how to check it or what to aim for) and, where Bottega can read it from a saved Live set, a check that marks it "likely done" (W-18). Bottega only suggests; the user ticks it.
- They can be ticked in any order, including ahead of the current stage.

**To-dos** are the user's own list of actions, each assigned to a specific stage.
- Actions still to be done are added as to-dos, each tagged with the stage it belongs to. Each says what needs to happen and how it will be known to be done (W-6). In the code a to-do is a `card`.
- Only the current stage's to-dos are on deck. Those for later stages are parked until the project gets there (W-8).
- A to-do can be marked done, deleted, or moved to a different stage.
- They can be checked off in any order, including ahead of the current stage.

A stage is complete when all its criteria are ticked and all its to-dos are done. Section 3 says exactly which items are part of a stage.

## 3. The stage follows what is done

A project's stage is not set by hand. It is the first stage, in order, that is not complete: one with a criterion not yet met or a to-do not yet done. When every stage is complete, the project stays in its last stage and is finished.

**What has to be done for a stage to be complete.**
- Every criterion in the stage is ticked. A criterion Claude proposed that the user has not accepted yet, or one the user rejected, is not part of the stage.
- Every to-do in the stage is done. A to-do Claude proposed that the user has not accepted yet is not part of the stage, and a settled decision is not outstanding work.
- To-dos for a later stage are parked (W-8). They do not hold up the current stage; they only start to matter once the project reaches their stage.

**How the stage moves.**
- Checking off the last open item of the current stage moves the project on, past any later stage that is already complete.
- Unticking a criterion, reopening a done to-do, or adding a criterion or to-do to an earlier stage makes that stage current again, so it becomes the next thing to work on. Later stages' to-dos wait until that stage is complete again.
- Adding a to-do to the current stage keeps the project there. Adding one to a later stage parks it and moves nothing.
- Deleting a to-do, or moving it to a later stage, means it no longer holds up the current stage. Moving one to an earlier stage makes that stage current again.

**Every move is logged with its cause**, not a reason typed by hand: for example `Open criterion: <the one left open>` or `Open to-do: <the one left open>`.

**Why the stage is derived, not set by the user.** A stored stage that only buttons move can disagree with the work, and then everything that reads "the current stage" is wrong at once: pick up here, the Workflow tab, the stage count and the to-do filters. The stage has one source of truth, what is done in each stage.

## 4. Always have a next action

One to-do per project can be marked next, and it heads "pick up here" and the on-deck list. When it is done, the next open to-do of the current stage takes the mark. When the current stage has no open to-do, its first unmet criterion is shown instead, so there is always a next action.

## 5. The Board

The Board's most important job is to help the user keep momentum toward finishing a project.

- **An immediate next action.** Opening a project on the Board shows what to do next: the next to-do of the current stage or, if it has none, its first unmet criterion (section 4). The user can start without deciding what to work on.
- **It keeps going.** When that item is done, the next one is pulled up automatically, so there is always something to do.
- **Progress is visible.** The Board shows progress across the stages, and how many criteria and to-dos are done in each.

## 6. Words

| Word | Means | In the code |
|---|---|---|
| Stage | One phase of a kind of project, in order | `stage`, `project_stages` |
| Criterion (plural criteria; "exit criteria") | A checkable condition for finishing a stage | `exit_criteria`, `criterion` |
| To-do | The user's own action, tagged to a stage | `cards` |
| Template | A kind of project's stages and criteria, kept per account | `workflow_templates` |
