// faerie-books.js — what the Faerie palaces keep on their shelves (docs/magic.md "Faerie
// palaces"; research: docs/texts/historical-recipes.md). The Gentry's library is from
// everywhere: real recipes from mortal books, kitchen and still-room and altar alike,
// from every age and shore. Nothing here is eaten in Faerie (no food there, at all); these are
// books to read and carry home in your head. Most want things the Lea doesn't have yet.
//
// No real names anywhere in them: no people, places, gods or book titles; this is the
// Gentry's world. The real ones are in the research note.
// Each book: `from`, the book it's out of (the page's running head); `intro`, its
// opening line; `body`, the recipe in English; `wants`, what it calls for, for the Recipes
// page (a word in `kinds` is one the game has, so the page can mark it if you carry it).
// Where each really comes from, and how near the text is to it, is kept out of the game,
// in docs/texts/historical-recipes.md "The Gentry's library, book by book".
// Pure data; main.js reads them (readShelf) and lists them (recipesPage).

export const FAERIE_BOOKS = {
  'oil to see the Fairies': {
    from: 'A book of secrets, in a cramped hand', magic: true,
    intro: 'To enable one to see the Fairies.',
    body: [
      'Take a pint of sallet oil and put it into a vial glass, but first wash it with rose water and marigold water, the flowers to be gathered towards the east. Wash it till the oil come white.',
      'Then put into the glass the buds of hollyhock, the flowers of marigold, the flowers or tops of wild thyme, and the buds of young hazel. The thyme must be gathered near the side of a hill where Fairies use to be. Take also the grass of a fairy throne.',
      'Set the glass to dissolve three days in the sun, and keep it for thy use. Anoint the eyelids with it.',
    ],
    wants: ['sallet oil', 'rose water', 'marigolds, gathered towards the east', 'hollyhock buds', 'wild thyme from a fairy hill', 'young hazel buds', 'grass of a fairy throne'],
    kinds: [],
  },
  'salve against the elfin race': {
    from: 'The third book of leechcraft', magic: true,
    intro: 'A salve against elfkind, and against the nightgoers.',
    body: [
      'Take eowohumelan, wormwood, bishopwort, lupin, ashthroat, henbane, harewort, haransprecel, heathberry plants, cropleek, garlic, the grains of hedgerife, githrife, and fennel. Work them into a salve.',
      'Smear his forehead with the salve, and put it on his eyes, and where his body is sore. Cense him with incense, and sign him often.',
    ],
    wants: ['fourteen herbs, some unknown: wormwood, lupin, henbane, garlic, fennel among them', 'incense'],
    kinds: [],
  },
  'against a sudden stitch': {
    from: 'A book of remedies', magic: true,
    intro: 'Against a sudden stitch: for the spears of the elves.',
    body: [
      'Take feverfew, and the red nettle that grows in through a house, and waybread. Boil them in butter.',
      'Loud were they, lo, loud, when they rode over the hill. Out, little spear, if herein thou be.',
    ],
    wants: ['feverfew', 'red nettle, grown in through a wall', 'waybread (plantain)', 'butter'],
    kinds: [],
  },
  'an eyesalve': {
    from: 'A leech\'s book',
    intro: 'Make an eyesalve against a wen.',
    body: [
      'Take cropleek and garlic, of both equally much; pound them well together. Take wine and oxen\'s gall, of both equally much; mix with the leek.',
      'Put it in a brass vessel. Let it stand nine nights in the brass. Wring it through a cloth and clear it well. Put it in a horn, and at night put it on the eye with a feather. It is the best of leechdoms.',
    ],
    wants: ['onions or leeks', 'garlic', 'wine', "an ox's gall", 'a brass vessel'],
    kinds: ['onions', 'leeks'],
  },
  'excrescences of the mountains': {
    from: 'The book of the hermit of the mountains', magic: true,
    intro: 'Of the excrescences, which are the medicines of the immortals.',
    body: [
      'There are five kinds: of stone, on the crags and at the feet of high peaks; of wood, grown from the roots or the hardened sap of ancient trees; of herbs, that look like any plant; of flesh, which are creatures grown very old; and of mushroom, that come up where the common fungi do, in the shapes of dragons and palaces and birds.',
      'Enter the mountains only in the third month or the ninth, on a lucky day. Carry an amulet, a white dog and a white chicken, and make offerings to the gods of the mountain. Go to it with the halting step of the old flood-king, and cut it with a knife of bone.',
      'The ordinary seeker does not know the art of entering mountains. The spirits hide the excrescences from him, and he walks over them and does not see them.',
    ],
    wants: ['a knife of bone', 'a white dog', 'a white chicken', 'an amulet', 'the third or ninth month'],
    kinds: [],
  },
  'kyphi': {
    from: 'A book of the temple perfumers', magic: true,
    intro: 'Of the incense that is burned at nightfall.',
    body: [
      'At dawn they burn resin, to waken the air; at midday myrrh, when the sun draws up the earth\'s heavy breath; and at nightfall kyphi, for the night is a mixture of many lights and powers.',
      'Kyphi is of sixteen things: honey and wine, raisins, cyperus, resin and myrrh, aspalathus and seselis, mastic, bitumen, rush and sorrel, the two junipers, the greater and the less, cardamom, and sweet flag.',
      'These are not mixed at random. While the perfumers compound them, the sacred writings are read aloud to them. It lulls to sleep, and loosens the cares of the day, without the aid of wine.',
    ],
    wants: ['honey', 'wine', 'raisins', 'resins: pine, myrrh, mastic', 'junipers, cardamom, sweet flag and seven more', 'a reader, reading aloud'],
    kinds: [],
  },
  'cakes for the god of doors': {
    from: 'A farmer\'s book',
    intro: 'Before the harvest, cakes for the father of doors, and for the sky-father.',
    body: [
      'Bray two pounds of cheese well in a mortar. When it is well broken, add a pound of wheat flour, or half a pound of fine flour if you would have it daintier, and one egg, and work it well together. Shape a loaf, set it on bay leaves, and bake it slowly on a warm hearth under a crock.',
      'Before you reap, offer incense and wine to the father of doors, the sky-father and the queen of heaven. Then offer the cakes to the father of doors, saying: "Father of doors, in offering these cakes I humbly pray that thou be gracious and merciful to me and my children, my house and my household." Offer a cake to the sky-father in the same words, then wine to each.',
    ],
    wants: ['cheese', 'wheat flour', 'an egg', 'bay leaves', 'incense', 'wine'],
    kinds: [],
  },
  'tuh\'u': {
    from: 'A tablet of clay',
    intro: 'Tuh\'u. Leg meat is used.',
    body: [
      'Prepare water; add fat. Sear the meat. Add salt, beer, onion, rocket, coriander, shallot, cumin and beet. Crush leek and garlic and add them.',
      'Sprinkle coriander and kurrat on top, and fresh coriander. It is ready to serve.',
    ],
    wants: ['meat', 'fat', 'beer', 'onions', 'leeks', 'garlic', 'beet', 'coriander and cumin'],
    kinds: ['meat', 'onions', 'leeks'],
  },
  'sikbaj': {
    from: 'A book of dishes, of the round city',
    intro: 'Sikbaj, which is sour and sweet together.',
    body: [
      'Cut fat meat in middling pieces and cover it with water, with green coriander, a stick of cinnamon and salt. When it boils, skim it. Take out the green coriander and put in the dry. Add white onions, leeks and carrots, as the season gives.',
      'When it is nearly done, take vinegar and date juice, or honey, and mix them so that it is between sour and sweet; pour it in and boil an hour. Grind saffron into a little of the broth and return it.',
      'Lay split almonds on top, with raisins, currants and dried figs. Cover it and let it rest an hour on the embers. Wipe the pot clean, sprinkle it with rose water, and serve.',
    ],
    wants: ['meat', 'onions', 'leeks', 'vinegar', 'dates or honey', 'saffron', 'almonds', 'raisins and figs', 'rose water'],
    kinds: ['meat', 'onions', 'leeks'],
  },
  'mugwort broth': {
    from: 'A tale of cookery, from the islands of the east',
    intro: 'Yomogi-jiru, a broth of mugwort, for the first three months of the year.',
    body: [
      'Put dashi to the miso. Chop the mugwort roughly, rub it with a little salt and wash it hard, or else scald it. Put in tofu, cut in dice.',
    ],
    wants: ['miso', 'dashi', 'young mugwort, in the year\'s first months', 'tofu'],
    kinds: [],
  },
  'a tun of metheglin': {
    from: 'A gentleman\'s closet, opened',
    intro: 'A receipt to make a tun of metheglin.',
    body: [
      'Take two handfuls of dock, a reasonable burthen of saxifrage, wild sage, scabious, betony, agrimony and wild marjoram, and wild thyme a peck, roots and all. All these are to be gathered in the fields, between the two feasts of the harvest.',
      'Of the garden take bay and rosemary, avens and violet leaves, sage and sweet marjoram, borage and parsley that hath not born seed. Seethe your herbs till they be tender, and as the liquor cools, set your servants to temper honey and wax in it, combs and all; let their hands and nails be very clean.',
      'To know when it is strong enough, put in two new-laid eggs. If it be strong enough, it will cause the egg to ascend upward, and to be on the top as broad as a small coin.',
    ],
    wants: ['field herbs, gathered between the two harvest feasts', 'garden herbs that have not seeded', 'honey in the comb', 'beeswax', 'two new-laid eggs'],
    kinds: ['beeswax'],
  },
  'mushrooms in broth': {
    from: 'A book of the king\'s cooks',
    intro: 'Funges, which are mushrooms.',
    body: [
      'Take mushrooms and pare them clean and dice them. Take leek and shred it small, and seethe it in good broth. Colour it with saffron, and put in strong powder of spices.',
    ],
    wants: ['mushrooms', 'leeks', 'good broth', 'saffron', 'strong spice'],
    kinds: ['mushrooms', 'leeks'],
  },
};
export const FAERIE_BOOK_IDS = Object.keys(FAERIE_BOOKS);
