// verse-puck.js — how Puck gives directions: his form and his grammar for js/verse.js. The form is
// his own from the play: seven syllables, strong-weak-strong-weak-strong-weak-strong, in couplets
// ("I will lead them up and down"), with the eight-syllable iambic line he also uses.
//
// The rules themselves are data, in js/grammars/puck.js, edited with the verse tool (verse.html).
// Each rule says one thing, and every alternative in it must mean that thing: a `dir:east` is east,
// however it's put. A `fill:` line carries no facts, only what's true anywhere; a `kind:` line only
// what's true of that kind of place. tools/check-verse.mjs holds them to it.

import { PUCK, SECTIONS } from './grammars/puck.js';
export { PUCK, SECTIONS };

export const COUPLET = { lines: [{ meter: ['SwSwSwS', 'wSwSwSwS'], rhyme: 'a' }, { meter: ['SwSwSwS', 'wSwSwSwS'], rhyme: 'a' }], ends: [',', '.'] };
export const ONE_LINE = { lines: [{ meter: ['SwSwSwS', 'wSwSwSwS'] }], ends: ['!'] };

// words of the Lea's place names worth rhyming on: the grammar never says them, but the names do
export const NAME_WORDS = 'among stones ring caves cavern vault garth hall chapel meadows wood woods weald grove pines marsh reeds fen fens moss carr ings mead field green heath moor downs crags tor scar lake mere water isle holm cairn ruin farm lane minster abbey tower barrow hill';

// the ways a place can be told, none preferred (verse.js composeShaped). Between its two lines, each
// says the name, the direction and how far; tools/check-verse.mjs holds them to it. `c.rule` is what kind of place it is.
export function placeShapes(c){
  return [[c.rule, 'lies:far'], ['ahead:far', c.rule], ['lies:dir', 'how-far'], ['far:then-see', 'seen'], ['far:dir-tag', 'then:name'], ['all:one', 'fill'], ['lead', 'all:one']];
}
// A line said only for the rhyme can come first as well as last, and either way is as good. First,
// it can't lean on what hasn't been said yet ("you will see it"), so it's a `lead` rather than a `fill`.
export const eitherEnd = rules => rules[1] === 'fill' ? [rules, ['lead', rules[0]]]
  : rules[1]?.startsWith('kind:') ? [rules, [rules[1], rules[0]]] : [rules];

// everything he says that isn't a whole dialog screen: which rules say it, tried in order, and what
// each needs to know. puck-guide.js says these; verse.html shows them. `form` is COUPLET unless given.
export const SAYINGS = {
  'you-are':      { label: 'Where you stand', needs: ['at'], tries: [['you-are', 'fill']] },
  'road-here':    { label: 'The road is underfoot', tries: [['road-here', 'fill']] },
  'road-off':     { label: 'Which way the road lies', needs: ['dir'], tries: [['road-off', 'fill']] },
  place:          { label: 'A place, and how far', needs: ['dest', 'far', 'dir'], shaped: true, tries: placeShapes },
  'last-seen':    { label: 'Where a friend was last seen', needs: ['at', 'far', 'dir'], tries: [['last-saw', 'lies:far']] },
  'set-off':      { label: 'Setting off', tries: [['set-off', 'fill']] },
  'set-off:road': { label: 'Setting off by the road', tries: [['set-off:road', 'fill']] },
  bound:          { label: 'Where we are bound, and how far yet', needs: ['dest', 'far'], tries: [['bound', 'still-far'], ['bound', 'fill']] },
  'on-road':      { label: 'Onto the road', tries: [['on-road', 'fill']] },
  'off-road':     { label: 'Off the road, into open country', tries: [['off-road', 'fill']] },
  enter:          { label: 'Coming into a place', needs: ['place'], tries: c => [['enter', 'kind:' + c.kind], ['enter', 'fill']] },
  'off-enter':    { label: 'Off the road, into a place', needs: ['place'], tries: c => [['off-enter', 'kind:' + c.kind], ['off-enter', 'fill']] },
  turn:           { label: 'A turn', needs: ['side'], tries: [['turn-line', 'fill']] },
  'pass-by':      { label: 'Passing somewhere', needs: ['dest', 'dir'], tries: [['pass-by', 'fill']] },
  halfway:        { label: 'Halfway', tries: [['halfway', 'fill']] },
  'not-long':     { label: 'Not long now', tries: [['not-long', 'fill']] },
  nearly:         { label: 'Nearly there', tries: [['nearly', 'fill']] },
  arrive:         { label: 'Arriving', needs: ['dest'], tries: [['arrive', 'fill']] },
  moved:          { label: 'They have moved on', needs: ['dest'], tries: [['moved-on', 'after-them'], ['moved-on', 'fill']] },
  'call:wait':    { label: 'Calling you on', form: 'one', tries: [['call:wait']] },
  'call:wrong':   { label: 'You are going the wrong way', form: 'one', tries: [['call:wrong']] },
};
