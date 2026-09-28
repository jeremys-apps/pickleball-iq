// Where a card's advice came from, in plain words. Every card shows this after
// the answer so you can tell a pro's words from a host's words from Claude's.

const TIER = {
  touring_pro: 'touring pro',
  senior_pro: 'senior pro',
  provisional_pro: 'provisional pro',
  elite_coach: 'coach',
  advanced_amateur: 'advanced amateur',
  host: 'host',
  unknown: 'unidentified speaker',
};

export function sourceLines(principle, index) {
  return (principle?.sources ?? []).map((s) => {
    if (s.kind === 'illustrative') return { text: 'Sample content written to test the app. Not from a podcast.' };
    const show = index.shows[s.show_id]?.name ?? s.show_id;
    if (s.kind === 'show_notes') {
      return { text: `From the ${show} description of ${s.episode_title}. Not yet checked against the audio.`, url: s.url };
    }
    const sp = index.speakers[s.speaker_id];
    const name = sp?.name ?? s.speaker_id;
    const tier = TIER[sp?.tier ?? s.speaker_tier] ?? 'speaker';
    const endorser = s.endorser_id ? (index.speakers[s.endorser_id]?.name ?? s.endorser_id) : 'a pro';
    const who = {
      pro_stated: `${name} (${tier})`,
      endorsed_explicit: `${name} (${tier}), and ${endorser} agreed`,
      endorsed_implicit: `${name} (${tier}), with ${endorser} in the conversation and not objecting`,
      qualified: `${name} (${tier}), with a condition added by ${endorser}`,
    }[s.endorsement] ?? name;
    const ep = index.episodes[s.episode_id];
    const where = ep ? `${ep.show}, "${ep.title}"` : s.episode_id;
    return { text: `${who}. ${where}, at ${s.timestamp}.`, url: ep?.url };
  });
}
