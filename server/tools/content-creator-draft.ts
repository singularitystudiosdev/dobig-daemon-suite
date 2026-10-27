/* The outreach draft. The LLM writes only three short strings (subject, one sentence about the video, one sentence on why
   the creator fits) from real facts; everything else in the message is fixed wording in this file. Terms the owner has
   not given us (the offer, the budget, their name, the game link) stay as bracketed placeholders: this tool never
   invents an offer, a rate, a number or a claim. Each LLM string is checked and replaced by plain fixed wording when it
   fails: a digit that is not in the creator's own facts, a promise of money, free items or results, pressure words, a
   claim of having watched, a link, an email, a bracket. It is a draft for the owner to send; nothing here sends. */
import type { ContentCreatorDraft, ContentCreatorVideoRef } from '../../src/lib/details/content-creator.ts'
import { plain } from './content-creator-score.ts'
import { RunError, type RunContext } from './types.ts'

export interface DraftFacts {
  game: string
  genre: string
  channelName: string
  video: ContentCreatorVideoRef
}

/** Words that would promise money, free items or results, pressure the creator, or claim something we did not read. */
const BANNED = /\b(free|paid|pay|pays|payment|guarantee[sd]?|robux|exclusive|limited|urgent|urgently|hurry|asap|viral|boost|grow|growth|sales|revenue|money|earn|earnings|discount|promo|deal|offers?|offering|watched|loved?|obsessed|binged|favou?rite|amazing|incredible|best|viewers?|audiences?|fans?|subscribers?|followers?|community|came across|fun|great|cool|awesome|enjoy(?:ed|s)?|impressive|nice|brilliant|fantastic|wonderful|clearly|made me|inspired)\b|[$€£%@#]|https?:|www\./i

export const digitsOf = (s: string): string[] => s.match(/\d+/g) ?? []

/** True when the model's text is safe to put in a message: no banned wording, no bracket, and only digits the facts hold. */
export function draftTextOk(text: string, allowedDigits: Set<string>, maxLen: number): boolean {
  if (!text || text.length > maxLen || text.length < 6) return false
  if (BANNED.test(text) || /[[\]{}<>]/.test(text) || /!{2,}/.test(text)) return false
  return digitsOf(text).every((d) => allowedDigits.has(d))
}

const clean = (s: string): string => plain(String(s ?? '')).replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/^["']|["']$/g, '').trim()

/** Fixed fallback wording for the two model sentences, true to the video's relation to the game. */
export function fallbackWords(f: DraftFacts): { subject: string; hook: string; why: string } {
  const about = f.video.about
  return {
    subject: `Sponsorship request for ${f.game}`,
    hook: about === 'game' ? `It is about ${f.game}, the game I work on.` : about === 'similar' ? `It covers a game in the same style as ${f.game}, the game I work on.` : `I work on ${f.game}, and your channel covers Roblox games.`,
    why:
      about === 'game'
        ? `Your channel already covers ${f.game}, so a sponsored video would sit close to what you already make.`
        : `Your channel covers games like ${f.game}, so a sponsored video would sit close to what you already make.`,
  }
}

/** The whole message. Fixed wording around the three checked strings and the real video. */
export function assembleDraft(f: DraftFacts, words: { subject: string; hook: string; why: string }): ContentCreatorDraft {
  const body = [
    `Hi ${f.channelName},`,
    '',
    `I came across your video "${f.video.title}" (${f.video.url}). ${words.hook}`,
    '',
    words.why,
    '',
    `I am [your name], and I work on ${f.game}. This is a sponsorship request: I would like to ask whether you would consider a sponsored video or stream about it. The game is here: [link to your game].`,
    '',
    `What I have in mind: [your offer]. My budget: [your rate range]. If you prefer another format, or you have a rate card, I would be glad to hear it. A no is completely fine, and you do not need to reply if it is not for you.`,
    '',
    'Thank you for your time,',
    '[your name]',
  ].join('\n')
  const placeholders: string[] = []
  for (const m of body.matchAll(/\[[^\]]+\]/g)) if (!placeholders.includes(m[0])) placeholders.push(m[0])
  return { subject: words.subject, body, placeholders }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'hook', 'why'],
  properties: { subject: { type: 'string' }, hook: { type: 'string' }, why: { type: 'string' } },
}

/** Write one draft. Returns the draft and whether the model's wording or the fixed wording was used for each string. */
export async function writeDraft(ctx: RunContext, f: DraftFacts): Promise<{ draft: ContentCreatorDraft; usedModel: boolean }> {
  const allowed = new Set([...digitsOf(f.game), ...digitsOf(f.channelName), ...digitsOf(f.video.title)])
  const user = [
    `Game owner's game: ${f.game} (a Roblox game, genre ${f.genre || 'not stated'})`,
    `Creator's channel: ${f.channelName}`,
    `Video the message refers to: "${f.video.title}" (${f.video.about === 'game' ? `about ${f.game}` : f.video.about === 'similar' ? 'about a similar game' : 'their latest upload'})`,
  ]
    .filter(Boolean)
    .join('\n')
  let words = fallbackWords(f)
  let usedModel = false
  try {
    const res = await ctx.llm.json<{ subject: string; hook: string; why: string }>(
      {
        name: 'content_creator_outreach_draft',
        system: [
          'You help a Roblox game owner write a first sponsorship message to a YouTube creator. You write three short strings, in the first person of the game owner, plain and warm, never salesy.',
          '- subject: an email subject under 60 characters that names the game. No exclamation marks.',
          '- hook: ONE sentence under 150 characters that comes right after the words "I came across your video", its title and its link, which are already written. Say in plain words how that video relates to the game. Do not repeat the title or those words.',
          '- why: ONE sentence under 190 characters saying the plain reason this creator fits the game, using only the facts given (which of their videos are about this game or similar games). Say nothing about their viewers, audience or fans.',
          'Style examples (plain, factual, no opinion): hook "It is about hunting rare eggs, which is close to what my game is about." why "Your channel already makes videos about this game, so a sponsored video would sit close to what you make."',
          'Hard rules: use no numbers at all. Never mention money, rates, payment, free items, Robux, results, views, subscribers or audience size. No flattery, no opinions about the video (never fun, great, cool), no claim that you watched or enjoyed anything, no pressure or deadlines, no links, no brackets, no emojis, no em dashes. Do not invent anything about the creator or the game that is not in the facts.',
        ].join('\n'),
        user,
        schema: SCHEMA,
        maxTokens: 1400,
        temperature: 0.4,
      },
      ctx.signal,
    )
    const subject = clean(res.data.subject)
    const hook = clean(res.data.hook)
    const why = clean(res.data.why)
    const subjectOk = draftTextOk(subject, allowed, 70) && subject.toLowerCase().includes(f.game.toLowerCase())
    const hookOk = draftTextOk(hook, allowed, 170) && /[.?]$/.test(hook) && !hook.toLowerCase().includes(f.video.title.toLowerCase())
    const whyOk = draftTextOk(why, allowed, 210) && /[.?]$/.test(why)
    words = { subject: subjectOk ? subject : words.subject, hook: hookOk ? hook : words.hook, why: whyOk ? why : words.why }
    usedModel = subjectOk || hookOk || whyOk
  } catch (e) {
    if (e instanceof RunError && ['no-llm-key', 'credits', 'aborted'].includes(e.code)) throw e
  }
  return { draft: assembleDraft(f, words), usedModel }
}
