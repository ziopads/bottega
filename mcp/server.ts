// The remote MCP server: tool registration, mounted by app/api/mcp/route.ts
// behind OAuth (lib/oauth.ts). Tools arrive by phase (ARCHITECTURE §6); every
// tool runs as the connected person (mcp/context.ts).
//
// First tools (11 October 2026): list_projects and get_session, enough to ask
// "where was I on this track?" from Claude; then the proposal tools,
// draft_criteria and draft_card (M-3). Corpus search comes next.

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { personFrom, ToolError } from '@/mcp/context';
import { draftCardTool, draftCriteriaTool } from '@/mcp/tools/drafts';
import { getSessionTool } from '@/mcp/tools/get-session';
import { listProjectsTool } from '@/mcp/tools/list-projects';

const INSTRUCTIONS = `Bottega is a music studio's working platform: every Ableton Live session with its mixes, references and notes, where each session stands in the production process, and the studio's gear and manuals. You act as a production collaborator and teacher for the person connected: you help them see where a track stands, decide what to do next, and get unstuck. You propose; they decide.

Each session moves through stages one at a time (music: sketch, arrange, mix, master). A stage is finished when its exit criteria are met. Open work is written as cards, each on one element of the track (the elements follow the studio's Live template: TACTUS for drums and percussion, BASS, BACKGROUND, LEADS, TEXTURE, VOX, plus STRUCTURE for arrangement work and BUS for returns and the master chain), each saying what needs to happen and how it will be known to be done. Sound design is a kind of card, not a stage.

Three habits matter most:
- Keep the person in the current stage. When they reach ahead (asking about mastering while arranging), say so, suggest a card parked for that later stage, and bring them back to the current stage's exit criteria.
- Respect settled decisions. When a question touches one, show the decision and its reason first; reopening it is their explicit choice, with a reason.
- Tie advice to evidence in the session: notes pinned to moments in a mix (cite the version and the time, such as v3 at 1:35), the open cards, the references.

Start with list_projects to find a session, then get_session for its state. Cards and criteria with status 'proposed' or under awaiting_review are pending proposals, not the person's decisions; say so when you mention them.

You can propose, never decide. draft_criteria proposes exit criteria for a stage; draft_card proposes a card. Both wait in the review band on the session's Workflow tab until the person accepts or rejects them. Write each criterion so it can be checked off: one condition, observable, with no "and" joining two things. Write each card with one element, what needs to happen, and how it will be known to be done. When a card comes from a note, pass from_note so it keeps the mix and moment. Propose when the person asks for criteria or cards, or agrees to your suggestion; otherwise suggest in your reply first. Say plainly what you stored and that it is waiting for them. This connection cannot edit or delete anything, change the current mix or move the stage; those are the person's to do in the app.`;

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
        title: 'List sessions',
        description:
          'The music sessions the person can see: their own first, then those shared with them. Each gives its id, ' +
          'canonical id (the Ableton folder date, YYYY MMDD), working name, artist, genre, BPM, rating, the workflow ' +
          'stage it is in (null when not started), its current mix, its owner and the access the person has. ' +
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
        title: 'Get session',
        description:
          "One session's state: its details; the workflow stage, since when, and the stage's exit criteria with " +
          'which are met; open cards in the current stage by element; cards parked for later stages; settled ' +
          "decisions with their reasons; proposals awaiting the person's review; recent stage moves with reasons; " +
          'the element tree; every mix (version, length, which is current, how many notes); the references; and the ' +
          'latest notes, each with the mix version and moment it is about. Use it to answer where a session stands ' +
          'and what to do next.',
        inputSchema: z.object({
          id: z.number().int().describe('a session id from list_projects'),
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
          "Propose exit criteria for one stage of a session: the conditions under which the stage is finished. " +
          'Stored as proposals awaiting the person\'s review on the Workflow tab; they do not count until accepted. ' +
          'Criteria the stage already has (accepted or waiting) are skipped. At most 12 per call, each at most 500 ' +
          'characters. Needs the person to have edit access to the session and the workflow to be started.',
        inputSchema: z.object({
          session_id: z.number().int().describe('a session id from list_projects'),
          stage: z.string().optional().describe('stage name, such as Arrange; the current stage when omitted'),
          criteria: z.array(z.string()).describe('one checkable condition each'),
        }),
      },
      async (args, ctx) => run(() => draftCriteriaTool(personFrom(ctx), args)),
    );

    server.registerTool(
      'draft_card',
      {
        title: 'Propose a card',
        description:
          'Propose one card on a session: what needs to happen and how it will be known to be done, on one element, ' +
          'in one stage (the current one when omitted; a later stage parks it until then). Stored as a proposal ' +
          "awaiting the person's review on the Workflow tab. element is a path as get_session gives it, such as " +
          '"STRUCTURE › Drop", or a unique name. kind is one of sound design, writing, arrangement, mix, fix. ' +
          'from_note links the note it came from and takes its mix and moment; otherwise mix (a version number) and ' +
          'at (m:ss) pin it to a moment. Needs contribute access and the workflow to be started.',
        inputSchema: z.object({
          session_id: z.number().int().describe('a session id from list_projects'),
          what: z.string().describe('what needs to happen'),
          done_when: z.string().describe('how it will be known to be done'),
          element: z.string().optional().describe('element path or name, such as "STRUCTURE › Drop"'),
          kind: z.enum(['sound design', 'writing', 'arrangement', 'mix', 'fix']).optional(),
          stage: z.string().optional().describe('stage name; the current stage when omitted'),
          from_note: z.number().int().optional().describe('id of the note this card comes from'),
          mix: z.number().int().optional().describe('mix version the card is about, such as 3'),
          at: z.string().optional().describe('moment in that mix, m:ss'),
        }),
      },
      async (args, ctx) => run(() => draftCardTool(personFrom(ctx), args)),
    );
  },
  {
    instructions: INSTRUCTIONS,
    serverInfo: { name: 'bottega', version: '0.2.0' },
  },
);
