import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '@netlify/functions';
import { requirePerson } from '../lib/auth.mts';
import { isPreflight, json, preflight, text } from '../lib/http.mts';

/**
 * Paste or dictate a mess, get back structured bullets.
 *
 * The Netlify AI Gateway injects ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL into
 * the function environment, so the bare constructor works with no key to
 * manage anywhere. Results land in a review sheet — nothing is ever created
 * without confirmation, and any failure here is silent by design.
 */
const anthropic = new Anthropic();

const SYSTEM = `You turn a messy brain dump into structured to-do bullets for a two-person creative agency (Clark and Angie).

Horizons, pick exactly one per bullet:
- "now"   super urgent, today
- "next"  this week, but not today
- "shelf" undecided, not committed to yet

Rules:
- Default to "shelf" unless the text gives a real timing signal. Do not invent urgency.
- Only set "deadline" (YYYY-MM-DD) when the text actually states or clearly implies a date. Never guess one.
- Use "count" for repeated work: "20 TikToks" becomes {"total":20,"unit":"posts"}. Omit it for one-off work.
- Match "clientName" against the known client list only. Omit if no clear match.
- Keep titles short and concrete. Strip filler like "I need to" or "we should".
- Split genuinely separate pieces of work into separate bullets. Do not split one task into steps.

Reply with JSON only, no prose and no code fence:
{"bullets":[{"title":"...","clientName":"...","horizon":"...","deadline":"YYYY-MM-DD","count":{"total":0,"unit":"..."}}]}`;

export default async (req: Request) => {
  if (isPreflight(req)) return preflight();
  if (!(await requirePerson(req))) return text('Unauthorized', 401);

  let body: { text?: string; clients?: string[]; today?: string };
  try {
    body = await req.json();
  } catch {
    return text('Bad request', 400);
  }

  const dump = (body.text ?? '').slice(0, 8000).trim();
  if (!dump) return json({ bullets: [] });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: `${SYSTEM}\n\nToday is ${body.today ?? 'unknown'}.\nKnown clients: ${
        body.clients?.join(', ') || 'none yet'
      }.`,
      messages: [{ role: 'user', content: dump }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as { bullets?: unknown[] };

    /**
     * Clamp the horizon the model chose. It is prompted with three, but a model
     * will occasionally reach for a fourth, and this endpoint is the one place
     * a value that never came from a user can enter the system. Anything that
     * is not a commitment is the Shelf — the same complement the client uses.
     */
    const bullets = (Array.isArray(parsed.bullets) ? parsed.bullets : []).map(b => {
      const row = b as Record<string, unknown>;
      const h = row.horizon;
      return { ...row, horizon: h === 'now' || h === 'next' ? h : 'shelf' };
    });

    return json({ bullets });
  } catch {
    // The app is fully functional with AI off; never surface a failure here.
    return json({ bullets: [] });
  }
};

export const config: Config = {
  path: '/api/ai/braindump',
  method: ['POST', 'OPTIONS'],
  rateLimit: { windowSize: 60, windowLimit: 10 },
};
