// The remote MCP server: tool registration, mounted by app/api/mcp/route.ts
// behind OAuth (lib/oauth.ts). Tools arrive by phase (ARCHITECTURE §6); every
// tool runs as the connected person (mcp/context.ts).
//
// First tools (11 October 2026): list_projects and get_session, enough to ask
// "where was I on this track?" from Claude; then the proposal tools,
// draft_criteria and draft_card (M-3); then the corpus (12 October):
// list_documents, search and read_pages; then Learning (12 October):
// get_study_group, draft_topic, draft_lesson and draft_exercise; then study
// sessions and notes: record_study_session, list_study_notes,
// get_study_history. 0.9.0 (23 October): each project's own stages from its
// template, criteria hints and likely-done marks, the next move, blocker and
// work log, and the person's board (db/024). 0.10.0 (24 October): learnings
// on a template's stages in get_session, and draft_learning (db/028).
// 0.11.0 (25 October): the next to-do and sessions from saved sets replace the
// next move, the blocker and ended sessions (db/029). 0.12.0 (25 October):
// the template's method in get_session (db/032).

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { appOrigin, personFrom, ToolError } from '@/mcp/context';
import { listDocumentsTool, readPagesTool, searchTool } from '@/mcp/tools/corpus';
import { draftCardTool, draftCriteriaTool, draftLearningTool } from '@/mcp/tools/drafts';
import { getSessionTool } from '@/mcp/tools/get-session';
import { listProjectsTool } from '@/mcp/tools/list-projects';
import {
  draftExerciseTool,
  draftLessonTool,
  draftTopicTool,
  addStudyResourceTool,
  getStudyGroupTool,
  getStudyHistoryTool,
  listStudyNotesTool,
  recordStudySessionTool,
} from '@/mcp/tools/study';

const INSTRUCTIONS = `Bottega is a music studio's working platform: every Ableton Live project with its mixes, references and notes, where each project stands in the production process, and the studio's gear and manuals. A project is one Ableton project folder: its saved sets (the .als files, one per working sitting, grouped into variants such as a radio edit) and the samples they share. The tool names and fields from before this naming still say session (get_session, session_id, the session field): each means a project. You act as a production collaborator and teacher for the person connected: you help them see where a track stands, decide what to do next, and get unstuck. You propose; they decide.

Each project moves through its stages one at a time. The stages and the criteria each starts with come from the person's workflow template, so they can differ between people and projects; get_session gives a project's own. Bottega's default for music is Seed (a loop worth looping), Palette (sounds locked), Structure (plays start to finish), Detail (the second drop earns its place), Mixdown (translates everywhere), Master (ready for a system) and Release (out in the world). A stage is finished when its exit criteria are met; a criterion may carry a hint (how to check it or what to aim for), and a project is finished when every criterion of its last stage is met. Open work is written as cards, each on one element of the track (the elements follow the studio's Live template: TACTUS for drums and percussion, BASS, BACKGROUND, LEADS, TEXTURE, VOX, plus STRUCTURE for arrangement work and BUS for returns and the master chain), each saying what needs to happen and how it will be known to be done. Sound design is also a kind of card, done in whichever stage needs it.

Three habits matter most:
- Keep the person in the current stage. When they reach ahead (asking about mastering while arranging), say so, suggest a card parked for that later stage, and bring them back to the current stage's exit criteria.
- Respect settled decisions. When a question touches one, show the decision and its reason first; reopening it is their explicit choice, with a reason.
- Tie advice to evidence in the project: notes pinned to moments in a mix (cite the version and the time, such as v3 at 1:35), the open cards, the references.

Everything to be done or figured out is a to-do (a card), tagged to a stage; there is no separate blocker. One to-do per project may be marked next: the action to start with when the set is opened again; get_session gives it, and when it is done the next open to-do of the stage takes the mark. Sessions are read from the saved sets: get_session's latest_sessions gives when they were, how many saves, and what changed (tracks, plugins, length, coverage by zone) in the newest. When the person asks where they were, start from the next to-do and what changed last time. A to-do in progress across two sessions or more (in_progress_for_sessions) is stuck: suggest another way in (bounce the part to audio, pull a reference, send it to a collaborator, leave it for a later stage). Criteria that name a check carry likely_done: what Bottega read from the newest saved set (tempo and key, locators, track names, gaps, the master chain and so on). It is a suggestion from the set, never a decision: say what the set shows and let the person tick it in the app.

Each person keeps their own board: projects in their backlog, in rotation (the few they are working on now, up to a limit they set) and finished. list_projects gives each project's place on the person's board. Keep advice to the projects in rotation unless they ask about another; when they want to start something new while rotation is full, say so and let them choose what goes back to the backlog.

A workflow template also carries learnings: reminders on a stage, without a checkbox, that the person (or a collaborator sharing the template through an artist) wrote down to remember on every project, such as "pitch the kick and snare up for a two-step feel and to clear room for the bass". get_session gives the learnings for the project's template, and its method: the person's principles for working (method). Hold advice to the method, and point back to it when they drift from it. Bring up those of the current stage when they bear on the question, and say they are the person's own. When the person says something worth keeping for every project at a stage, or asks you to remember it as a learning, propose it with draft_learning; anything to act on in one track is a card, not a learning.

Start with list_projects to find a project, then get_session for its state. Cards and criteria with status 'proposed' or under awaiting_review are pending proposals, not the person's decisions; say so when you mention them.

You can propose, never decide. draft_criteria proposes exit criteria for a stage; draft_card proposes a card. Both wait in the review band on the project's Workflow tab until the person accepts or rejects them. Write each criterion so it can be checked off: one condition, observable, with no "and" joining two things. Write each card with one element, what needs to happen, and how it will be known to be done. When a card comes from a note, pass from_note so it keeps the mix and moment. Propose when the person asks for criteria or cards, or agrees to your suggestion; otherwise suggest in your reply first. Say plainly what you stored and that it is waiting for them. This connection cannot edit or delete anything, change the current mix or move the stage; those are the person's to do in the app.

The corpus holds manuals and books: the person's private documents, those shared with them, and the platform library. search finds passages by words and meaning; read_pages gives whole pages. Before quoting or relying on a passage, read its pages, and cite them as the document and PDF page with the link each result carries (PDF pages count from 1 and may differ from the numbers printed on them). Keep what the corpus says, cited, apart from what you know from elsewhere, and say which is which. By default search covers the person's own documents, their picks and the manuals of the gear they own; scope 'all' adds the rest of the library.

Learning happens in study groups: a group's syllabus is topics in order, each with lessons and exercises, and each member records their own progress on the exercises (not started, practising, done). get_study_group without an id lists the person's groups; with an id it gives the syllabus, each member's progress and the proposals awaiting review. The group's custodian writes the syllabus; you propose topics, lessons and exercises with draft_topic, draft_lesson and draft_exercise, and they wait in the group's review band until the custodian accepts or rejects them. Each study group has a reading list: the manuals and books its study draws on (get_study_group lists it). When working on a group (its lessons, exercises, questions about its material, documenting a session), search with group set to the group's id, so only its reading list is searched; search more widely only when the person asks, and say that you did. When drafting a syllabus from a manual or book: search it and read its pages first, propose the topics, then lessons and exercises under each topic (a lesson may go under a topic still waiting for review). A lesson teaches one thing and cites the corpus where it relies on it, with markers in its body: [15:p42] for document 15, PDF page 42; [15:p42-43] for a range; [15:p42 "exact words"] with a quotation copied exactly from read_pages. Every marker is checked against the page text, and one that fails refuses the whole lesson. What you add from your own knowledge stays unmarked; say in the lesson that it is not from the source. Lessons use ## headings, - lists, **bold**, and paragraphs, nothing else. Write each exercise as something to do at the instrument, with how it will be known to be done, observable. Use the members' progress notes to suggest what to practise next.

Members keep a record of their study: sessions (one sitting: when, how long, what kind, a summary and the topics it touched) and notes (alone or in a session, on a topic, lesson or exercise). When the person asks you to document a conversation or a practice session ("please document this", "log this session"), call record_study_session once, at the end: a summary in their voice of what was worked on, what came of it and what to try next; the topics touched; the minutes if known; kind 'conversation' for a talk with you; and a note for each distinct point worth finding again (a technique, a question still open, a page that helped), each tied to its topic, lesson or exercise where one fits. It is stored as a draft only they see until they publish it in the app; tell them so. Do not record a session they did not ask for. Groups also keep videos and links (get_study_group lists them under videos_and_links); you cannot watch a video or read its transcript, so what you know of one is its title, channel and the members' notes. A note can point at a moment in a video (resource_id and at, m:ss), which opens the video there; when the person mentions a moment, keep it. add_study_resource adds a video or link they give you, as a draft. get_study_history answers how often they studied, which topics got attention and which were neglected; list_study_notes finds what they or their partners wrote before. Notes are the members' own words and record; say whose a note is when you use it, and mark drafts as drafts.`;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof ToolError) return { ...json({ error: err.message }), isError: true };
    console.error('mcp tool', err);
    return { ...json({ error: 'internal error' }), isError: true };
  }
}

export const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_projects',
      {
        title: 'List projects',
        description:
          'The music projects the person can see: their own first, then those shared with them. Each gives its id, ' +
          'canonical id (the Ableton folder date, YYYY MMDD), working name, artist, genre, BPM, rating, the workflow ' +
          'stage it is in (null when not started), its place on the person\'s board (rotation, backlog, finished, or ' +
          'null when not on it), its next move, its current mix, its owner and the access the person has. ' +
          'Optionally filtered by text in the canonical id, name, artist or genre. Pass an id to get_session.',
        inputSchema: z.object({
          query: z.string().optional().describe('text in the canonical id, working name, artist or genre'),
        }),
      },
      async (args, ctx) => run(() => listProjectsTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'get_session',
      {
        title: 'Get project',
        description:
          "One project's state: its details; the next to-do and the latest work sessions read from saved sets; its own " +
          'stages with how many criteria of each are met; the current stage, since when, and its exit criteria with ' +
          'their hints, which are met, and what the newest saved set suggests (likely_done); whether its template ' +
          'has changes to offer; open cards in the current stage by element; cards parked for later stages; settled ' +
          "decisions with their reasons; proposals awaiting the person's review; recent stage moves with reasons; " +
          'the element tree; every mix (version, length, which is current, how many notes); the references; and the ' +
          'latest notes, each with the mix version and moment it is about. Use it to answer where a project stands ' +
          'and what to do next.',
        inputSchema: z.object({
          id: z.number().int().describe('a project id from list_projects'),
          notes: z.number().int().optional().describe('how many of the latest notes to include, default 15, at most 100'),
        }),
      },
      async (args, ctx) => run(() => getSessionTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'draft_criteria',
      {
        title: 'Propose exit criteria',
        description:
          "Propose exit criteria for one stage of a project: the conditions under which the stage is finished. " +
          'Stored as proposals awaiting the person\'s review on the Workflow tab; they do not count until accepted. ' +
          'Criteria the stage already has (accepted or waiting) are skipped. At most 12 per call, each at most 500 ' +
          'characters; each may carry a hint (how to check it or what to aim for; lines indented by two spaces nest), ' +
          'at most 2000 characters. Needs the person to have edit access to the project and the workflow to be started.',
        inputSchema: z.object({
          session_id: z.number().int().describe('a project id from list_projects'),
          stage: z.string().optional().describe('stage name, such as Structure; the current stage when omitted'),
          criteria: z
            .array(z.union([z.string(), z.object({ criterion: z.string(), hint: z.string().optional() })]))
            .describe('one checkable condition each, as text or { criterion, hint }'),
        }),
      },
      async (args, ctx) => run(() => draftCriteriaTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'draft_card',
      {
        title: 'Propose a card',
        description:
          'Propose one card on a project: what needs to happen and how it will be known to be done, on one element, ' +
          'in one stage (the current one when omitted; a later stage parks it until then). Stored as a proposal ' +
          "awaiting the person's review on the Workflow tab. element is a path as get_session gives it, such as " +
          '"STRUCTURE › Drop", or a unique name. kind is one of sound design, writing, arrangement, mix, fix. ' +
          'from_note links the note it came from and takes its mix and moment; otherwise mix (a version number) and ' +
          'at (m:ss) pin it to a moment. Needs contribute access and the workflow to be started.',
        inputSchema: z.object({
          session_id: z.number().int().describe('a project id from list_projects'),
          what: z.string().describe('what needs to happen'),
          done_when: z.string().describe('how it will be known to be done'),
          element: z.string().optional().describe('element path or name, such as "STRUCTURE › Drop"'),
          kind: z.enum(['sound design', 'writing', 'arrangement', 'mix', 'fix']).optional(),
          stage: z.string().optional().describe('stage name; the current stage when omitted'),
          from_note: z.number().int().optional().describe('id of the note this card comes from'),
          mix: z.number().int().optional().describe('mix version the card is about, such as 3'),
          variant: z.string().optional().describe('the mix\'s variant, such as Radio edit; the main mix when omitted'),
          at: z.string().optional().describe('moment in that mix, m:ss'),
        }),
      },
      async (args, ctx) => run(() => draftCardTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'draft_learning',
      {
        title: 'Propose a learning',
        description:
          'Propose a learning for one stage of the template a project uses: a reminder worth seeing on every project at ' +
          'that stage, not tied to one track (that is a card). Stored as a proposal the person keeps or rejects on the ' +
          'Workflow tab; once kept it shows on every project using the template. At most 2000 characters. Needs the ' +
          'person to be able to edit the template (get_session says you_can_add_learnings) and the workflow to be started.',
        inputSchema: z.object({
          session_id: z.number().int().describe('a project id from list_projects'),
          stage: z.string().optional().describe('stage name, such as Palette; the current stage when omitted'),
          learning: z.string().describe('the learning, in the person’s terms'),
        }),
      },
      async (args, ctx) => run(() => draftLearningTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'list_documents',
      {
        title: 'List documents',
        description:
          'The manuals and books the person can read: their private documents, those shared with them, and the ' +
          'library. Each gives its id, title, kind, what it is about, where it lives, ' +
          'its page count, and how far it is searchable. Pass ids to search (documents) or read_pages.',
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => listDocumentsTool(personFrom(ctx), appOrigin(ctx))),
    );

    server.registerTool(
      'search',
      {
        title: 'Search the corpus',
        description:
          'Search manuals and books by words and by meaning together. Returns passages with their document, PDF ' +
          'pages, how each was found, and a link to read the page in Bottega. scope "mine" (default): the person\'s ' +
          'documents, their picks and the manuals of gear they own; "all": the whole library as well. documents ' +
          'narrows to given document ids. group (a study group id) searches only that group\'s reading list, and ' +
          'overrides scope. Search more than once with different wordings for a broad question, and ' +
          'read the pages before quoting.',
        inputSchema: z.object({
          query: z.string().describe('what to look for, in plain words'),
          scope: z.enum(['mine', 'all']).optional(),
          documents: z.array(z.number().int()).optional().describe('only these document ids'),
          limit: z.number().int().optional().describe('passages to return, default 8, at most 20'),
          group: z.number().int().optional().describe("a study group id: search only its reading list"),
        }),
      },
      async (args, ctx) => run(() => searchTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'read_pages',
      {
        title: 'Read pages',
        description:
          'The full text of pages of one document, at most 10 per call, each with a link to that page in Bottega. ' +
          'Pages are PDF pages counted from 1.',
        inputSchema: z.object({
          document: z.number().int().describe('a document id from search or list_documents'),
          from: z.number().int().describe('first page'),
          to: z.number().int().optional().describe('last page; from when omitted'),
        }),
      },
      async (args, ctx) => run(() => readPagesTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'get_study_group',
      {
        title: 'Get study group',
        description:
          'Without an id: the study groups the person belongs to, with ids. With an id: the group\'s syllabus (topics in ' +
          'order, their lessons with links, their exercises with every member\'s progress), the proposals awaiting the ' +
          'custodian\'s review, and the documents its lessons cite or that are shared with it. Pass topic to include the ' +
          'full text of that topic\'s lessons.',
        inputSchema: z.object({
          id: z.number().int().optional().describe('a study group id'),
          topic: z.number().int().optional().describe('a topic_id whose lessons to give in full'),
        }),
      },
      async (args, ctx) => run(() => getStudyGroupTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'draft_topic',
      {
        title: 'Propose a topic',
        description:
          'Propose one topic for a study group\'s syllabus, such as Sampling and chopping. Stored as a proposal in the ' +
          'group\'s review band until the custodian accepts or rejects it; it goes at the end of the topic list. ' +
          'instrument optionally names a catalogue model, such as Akai MPC One. Returns the topic_id, under which lessons ' +
          'and exercises can be drafted at once. Needs the person to be a member of the group.',
        inputSchema: z.object({
          group_id: z.number().int().describe('a study group id from get_study_group'),
          title: z.string().describe('the topic, at most 120 characters'),
          summary: z.string().optional().describe('what the topic covers, at most 1000 characters'),
          instrument: z.string().optional().describe('a catalogue model, such as Akai MPC One'),
        }),
      },
      async (args, ctx) => run(() => draftTopicTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'draft_lesson',
      {
        title: 'Propose a lesson',
        description:
          'Propose one lesson under a topic: a title and a body that teaches one thing, citing the corpus with markers ' +
          '[document:pPage], [document:pFrom-To] or [document:pPage "exact words"]. Every marker is checked: the ' +
          'document must be readable by the person, the pages read, and a quotation found on the pages cited; one failure ' +
          'stores nothing and says what to fix. Formatting: paragraphs, ## and ### headings, - or 1. lists, **bold**. ' +
          'At most 20,000 characters. Stored as a proposal until the custodian accepts it.',
        inputSchema: z.object({
          topic_id: z.number().int().describe('a topic_id from get_study_group or draft_topic'),
          title: z.string().describe('the lesson title, at most 160 characters'),
          body: z.string().describe('the lesson, with citation markers'),
        }),
      },
      async (args, ctx) => run(() => draftLessonTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'draft_exercise',
      {
        title: 'Propose an exercise',
        description:
          'Propose one exercise under a topic, optionally tied to one of its lessons: the task to do at the instrument, ' +
          'and how it will be known to be done (one observable result). Members record their progress on it once the ' +
          'custodian accepts it.',
        inputSchema: z.object({
          topic_id: z.number().int().describe('a topic_id from get_study_group or draft_topic'),
          task: z.string().describe('what to do, at most 2000 characters'),
          done_when: z.string().describe('how it will be known to be done, at most 1000 characters'),
          lesson_id: z.number().int().optional().describe('the lesson it practises, in the same topic'),
        }),
      },
      async (args, ctx) => run(() => draftExerciseTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'record_study_session',
      {
        title: 'Document a study session',
        description:
          'Record one of the person\'s own study sessions in a group, with its notes, in one call: the summary, what kind ' +
          '(at the instrument, conversation, reading, video, other), minutes, when it started (ISO date and time; now when ' +
          'omitted), the topics it touched (ids or titles), and notes, each optionally on a topic, lesson_id or exercise_id. ' +
          'Citation markers [document:pPage] in the summary or notes are checked against the page text. Stored as a draft ' +
          'only the person sees until they publish it on the group\'s Sessions tab. Call it when the person asks to document ' +
          'a session, once, at the end.',
        inputSchema: z.object({
          group_id: z.number().int().describe('a study group id from get_study_group'),
          summary: z.string().describe('what was worked on, what came of it, what to try next; paragraphs and - lists allowed'),
          kind: z.enum(['at the instrument', 'conversation', 'reading', 'video', 'other']).optional(),
          minutes: z.number().int().optional().describe('how long, in minutes'),
          started_at: z.string().optional().describe('when it started, ISO 8601; now when omitted'),
          topics: z.array(z.union([z.number().int(), z.string()])).optional().describe('topic ids or titles it touched'),
          notes: z
            .array(
              z.object({
                body: z.string().describe('one point worth finding again'),
                topic: z.union([z.number().int(), z.string()]).optional(),
                lesson_id: z.number().int().optional(),
                exercise_id: z.number().int().optional(),
                resource_id: z.number().int().optional().describe('a video or link from get_study_group'),
                at: z.union([z.string(), z.number()]).optional().describe('a moment in that video, m:ss'),
              }),
            )
            .optional()
            .describe('at most 30'),
          private: z.boolean().optional().describe('true keeps it from the group even once published'),
          resource_id: z.number().int().optional().describe('the video or link the session was spent on'),
        }),
      },
      async (args, ctx) => run(() => recordStudySessionTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'add_study_resource',
      {
        title: 'Add a video or link',
        description:
          'Add a YouTube video (played in the app; its title, channel and thumbnail come from YouTube) or another https ' +
          'link (give a title) to a study group, optionally filed under topics (ids or titles) with why it is worth the ' +
          'time. Stored as a draft only the person sees until they publish it on the Resources tab. Only when the person ' +
          'asks and gives the address; you cannot watch a video, so describe it only from what the person says.',
        inputSchema: z.object({
          group_id: z.number().int().describe('a study group id'),
          url: z.string().describe('the full address, https://'),
          title: z.string().optional().describe('needed for a link that is not a YouTube video'),
          why: z.string().optional().describe('why it is worth the time, in the person\'s words'),
          topics: z.array(z.union([z.number().int(), z.string()])).optional(),
        }),
      },
      async (args, ctx) => run(() => addStudyResourceTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'list_study_notes',
      {
        title: 'List study notes',
        description:
          'The notes in a study group the person can read, newest first: each with its author, when it was written, its ' +
          'topic, lesson, exercise or session, and its text. Filter by topic (id or title), member (name) or session_id.',
        inputSchema: z.object({
          group_id: z.number().int().describe('a study group id'),
          topic: z.union([z.number().int(), z.string()]).optional(),
          member: z.string().optional().describe('a member\'s name'),
          session_id: z.number().int().optional(),
          limit: z.number().int().optional().describe('default 30, at most 100'),
        }),
      },
      async (args, ctx) => run(() => listStudyNotesTool(personFrom(ctx), appOrigin(ctx), args)),
    );

    server.registerTool(
      'get_study_history',
      {
        title: 'Get study history',
        description:
          'How a study group has been studying over the last weeks (default 8): sessions and minutes per member and per week, ' +
          'sessions and minutes per topic with when each was last touched, the topics not touched at all, and the recent ' +
          'sessions with their summaries. Optionally one member\'s.',
        inputSchema: z.object({
          group_id: z.number().int().describe('a study group id'),
          weeks: z.number().int().optional().describe('how far back, 1 to 52, default 8'),
          member: z.string().optional().describe('a member\'s name'),
        }),
      },
      async (args, ctx) => run(() => getStudyHistoryTool(personFrom(ctx), appOrigin(ctx), args)),
    );
  },
  {
    instructions: INSTRUCTIONS,
    serverInfo: { name: 'bottega', version: '0.12.0' },
    // No subscriptions: this server never sends notifications, and on Vercel
    // each subscriptions/listen stream stayed open until the function timed
    // out, billing memory for the whole wait. Refused with the protocol's
    // own 'Subscription limit reached'; tool calls do not use the stream.
    maxSubscriptions: 0,
  },
);
