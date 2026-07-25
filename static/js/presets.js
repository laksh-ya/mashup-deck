/* The jukebox, with every video id already resolved.

   These were looked up once, offline, and written in here on purpose. It means
   picking a jukebox mix costs nobody a YouTube search: the browser already knows
   the id, the title and the length, so it goes straight to the rack. That is the
   same for every visitor on every device, not a cache that only helps you after
   you have already waited once.

   Times sit on each song's hook and inside its real length. Everything stays
   editable once it lands in the rack. */

export const MIXES = [
  {
    id: 'sangeet',
    name: 'Sangeet Floor',
    blurb: 'the one everyone asks for',
    clips: [
      { id: 'jCEdTq3j-0U', name: "Gallan Goodiyaan", duration: 278, start: 62, end: 94 },
      { id: 'k4yXQkG2s1E', name: "Kala Chashma", duration: 173, start: 30, end: 62 },
      { id: 'YxWlaYCA8MU', name: "Jhoome Jo Pathaan", duration: 203, start: 62, end: 94 },
    ],
  },
  {
    id: 'baraat',
    name: 'Baraat Entry',
    blurb: 'walk in like that',
    clips: [
      { id: '9yT4F8hzykY', name: "Chaiyya Chaiyya", duration: 416, start: 70, end: 102 },
      { id: 'udra3Mfw2oo', name: "London Thumakda", duration: 215, start: 26, end: 58 },
      { id: 'HgIW7P4dsXU', name: "Nachde Ne Saare", duration: 202, start: 44, end: 76 },
    ],
  },
  {
    id: 'firstdance',
    name: 'First Dance',
    blurb: 'slow, for the couple',
    clips: [
      { id: 'BddP6PYo2gs', name: "Kesariya", duration: 172, start: 45, end: 80 },
      { id: 'zlt38OOqwDc', name: "Raabta", duration: 232, start: 55, end: 90 },
      { id: 'SBfPs-PMGTA', name: "Pehla Nasha", duration: 258, start: 42, end: 77 },
    ],
  },
  {
    id: 'nineties',
    name: 'Nineties Rewind',
    blurb: 'your parents approve',
    clips: [
      { id: 'cNV5hLSa9H8', name: "Tujhe Dekha To", duration: 314, start: 60, end: 92 },
      { id: 'bKZTnnFU9HA', name: "Kuch Kuch Hota Hai", duration: 309, start: 66, end: 98 },
      { id: 'Yqj1_V90KJo', name: "Chura Ke Dil Mera", duration: 453, start: 78, end: 110 },
    ],
  },
  {
    id: 'highway',
    name: 'Windows Down',
    blurb: 'for the drive up',
    clips: [
      { id: 'fdubeMFwuGs', name: "Ilahi", duration: 203, start: 40, end: 72 },
      { id: 'sOhESxhibAM', name: "Safarnama", duration: 251, start: 46, end: 78 },
      { id: '8HDTS80dlr4', name: "Patakha Guddi", duration: 249, start: 52, end: 84 },
    ],
  },
  {
    id: 'pump',
    name: 'Last Set',
    blurb: 'gym, but louder',
    clips: [
      { id: '4NRXx6U8ABQ', name: "Blinding Lights", duration: 263, start: 50, end: 80 },
      { id: '7wtfhZwyrcc', name: "Believer", duration: 217, start: 55, end: 85 },
      { id: 'TUVcZfQe-Kw', name: "Levitating", duration: 230, start: 44, end: 74 },
    ],
  },
  {
    id: 'pina',
    name: 'Piña Colada Problem',
    blurb: 'yacht rock, no notes',
    clips: [
      { id: 'zROIlspgOjM', name: "Escape (The Piña Colada Song)", duration: 260, start: 8, end: 40 },
      { id: 'fJWmbLS2_ec', name: "Kokomo", duration: 212, start: 12, end: 44 },
      { id: 'FTQbiNvZqaY', name: "Africa", duration: 271, start: 60, end: 92 },
    ],
  },
  {
    id: 'wind',
    name: 'Lights Out',
    blurb: 'for falling asleep',
    clips: [
      { id: 'UfcAVejslrU', name: "Weightless", duration: 489, start: 20, end: 80 },
      { id: 'WNcsUNKlAKw', name: "Clair de Lune", duration: 314, start: 10, end: 70 },
    ],
  },
];

/* Quick fills for the cue card, so the first box is never blank and scary.
   Links are shown by the example inside the pad, not by a sticker. */
export const STICKERS = [
  {
    label: 'sangeet',
    text: 'Gallan Goodiyan from 1:02 to 1:34\nthen Kala Chashma from 0:30 to 1:02\nthen Jhoome Jo Pathaan from 1:02 to 1:34',
  },
  {
    label: 'road trip',
    text: 'Ilahi from 0:40 to 1:12\nthen Safarnama from 0:46 to 1:18\nthen Patakha Guddi from 0:52 to 1:24',
  },
  {
    label: 'gym set',
    text: 'Blinding Lights from 0:50 to 1:20\nthen Believer from 0:55 to 1:25\nthen Levitating from 0:44 to 1:14',
  },
];

/* A preset is already resolved, so turn it straight into rack clips. No search,
   no waiting, and the thumbnail comes from the id. */
export function mixToClips(mix) {
  return mix.clips.map((c) => ({
    video_id: c.id,
    title: c.name,
    thumbnail: `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
    duration: c.duration,
    start: c.start,
    end: c.end,
  }));
}

/* The same mix written out the way someone would type it, so the cue card
   shows what they could have written themselves. */
export function mixToText(mix) {
  return mix.clips
    .map((c) => `${c.name} from ${fmt(c.start)} to ${fmt(c.end)}`)
    .join('\nthen ');
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
