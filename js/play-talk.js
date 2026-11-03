// play-talk.js — what you can say to someone you've just heard play (docs/music.md "Practice").
// main.js's talk tree offers these once you've actually heard them: at a fire, out at their
// practice spot, or because you asked them to play. Every answer reads real state: how well
// their hands have the tune (music-sim.js fluencyOf), how hard it is, what you know.
//
//   "Keep practicing!" → a rough player of a hard tune owns up, and means to work at it (a
//   `practice` plan the Brain acts on). Anyone else takes it badly: "If you know of a better
//   song, sing it to me." → you play one (or, with nothing to play on, sing it), and they
//   learn from it by the ordinary rules (teachTune) and say whether it IS better (songVerdict);
//   or you say you don't know any, and they play theirs again.
// A reaction spends what you heard: to react again, hear them again.
//
// No THREE, no DOM, no sound of its own: c is what main.js lends it, so check-practice.mjs
// can drive the same nodes without a browser.
//   c: { npc, now(), v(key, lines), Pron, their, cap, label(kind), carried(), known(),
//        heard(), forget(), playMine(id, kind), playTheirs(id, kind, k), jot(verb, what), name }

import { addPlan } from './plans.js';
import { DRUMS } from './arrange.js';
import { fluencyOf, instrumentOf, keepAtReply, phraseCount, phrasesKnown, isHeritage, songVerdict, teachTune, ROUGH } from './music-sim.js';

const TOLD_DAYS = 1;   // how long being told to practise stays on their agenda

export function playTalk(c){
  const { npc, v, Pron, their, cap } = c;
  let on = null, said = '', sang = null;   // the tune being talked about; the last screen's words; the tune you just gave them
  const practise = id => { const k = instrumentOf(npc); if (k && !DRUMS.has(k)) addPlan(npc, { kind: 'practice', tune: id, until: c.now() + TOLD_DAYS }); };
  const hear = () => { const h = c.heard(); if (h) on = h; c.forget(); return on; };

  const nodes = {
    get keepAt(){
      if (said) return { text: said };
      return { text: '"If you know of a better song, sing it to me."',
        choices: [...c.known().filter(id => id !== on.id).map(id => { const kind = c.carried(); return { label: `${kind ? 'Play' : 'Sing'} ${id}.`, next: 'better', run: () => {
          const verdict = songVerdict(npc, on.id, id, c.now());
          const r = verdict === 'knows' ? null : teachTune(npc, id, c.now());
          if (kind) c.playMine(id, kind);
          sang = r?.got > 0 ? { id, k: phrasesKnown(npc, id, c.now()) } : null;
          if (r) c.jot('taught', `${c.name} ${r.got >= phraseCount(id) ? '' : 'some of '}${id}`);
          if (verdict === 'better' && r?.got > 0) practise(id);
          const did = kind ? `You play ${id} on your ${c.label(kind)}.` : `You sing ${id}, as well as you can.`;
          said = `${did} "${verdict === 'knows' ? v('pt-knows', ["I know that one. It's no better than mine.", "That one? I've known that for years."])
            : verdict === 'better' ? v('pt-better', ["Now that is a song. I'll have to work at that.", "Well. That is better. Give me a while with it."])
            : v('pt-nobetter', ["That's no harder than mine.", "Mine's as good as that, and you know it."])}"`;
        } }; }),
        { label: "I don't know any.", next: 'noSong' }] };
    },
    get better(){
      const kind = instrumentOf(npc);
      return { text: said, choices: sang && kind && !DRUMS.has(kind) ? [{ label: "Let's hear you play it, then.", next: 'tryIt' }] : [] };
    },
    get tryIt(){
      const kind = instrumentOf(npc);
      if (!sang || !kind) return { text: `"${v('pt-noinst', ['Not now.', 'Some other time.'])}"` };
      c.playTheirs(sang.id, kind, sang.k);
      const part = sang.k < phraseCount(sang.id);
      on = { id: sang.id }; 
      return { text: `${Pron} tries it on ${their} ${c.label(kind)}.${part ? ` ${Pron} stops partway. "${v('pt-part', ["That's as far as I have it.", 'It goes on from there, I know it does.'])}"` : ''}`,
        choices: reactions() };
    },
    get noSong(){
      const kind = instrumentOf(npc), k = on && phrasesKnown(npc, on.id, c.now());
      if (kind && k) c.playTheirs(on.id, kind, k);
      return { text: `"${v('pt-hush', ['Then hush.', 'Then let me get on.'])}"${kind && k ? ` ${Pron} plays it again.` : ''}` };
    },
    get praise(){ return { text: said }; },
  };

  // the choices to offer now: none, unless you've heard them play
  function reactions(){
    if (!c.heard()) return [];
    return [{ label: 'Keep practicing!', next: 'keepAt', run: () => {
      const { id } = hear(); said = ''; sang = null;
      if (keepAtReply(npc, id, c.now()) === 'retort') return;
      practise(id);
      said = `"${npc.practice ? v('pt-admit-out', ['I know. Why do you think I come out here?', "I know it's rough. That's why I'm out here."]) : v('pt-admit', ["I know. I'll have it yet.", "I know, I know. I'll go and work at it."])}"`;
    } },
    { label: v('pt-q-praise', ['That was lovely.', 'That was well played.']), next: 'praise', run: () => {
      const { id } = hear(), rough = fluencyOf(npc, id, c.now()) < ROUGH;
      said = `"${rough ? v('pt-kind', ["You're kind. It wasn't right yet.", "That's kind. I lost it twice."])
        : isHeritage(npc, id) ? v('pt-old', ['Thank you. We have always played that one.', 'My people have always played that. Thank you.'])
        : v('pt-new', ['Thank you. I only came by it lately.', "Thank you. I've been working at it."])}"`;
    } }];
  }
  return { nodes, reactions };
}
