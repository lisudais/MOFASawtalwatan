// Country reference used ONLY to recognize country names that literally
// appear in official source text/fields — never to infer or invent them.
// canonical name → variants (all lowercase for matching).

export const COUNTRIES = [
  ['Afghanistan'], ['Albania'], ['Algeria'], ['Andorra'], ['Angola'],
  ['Antigua and Barbuda'], ['Argentina'], ['Armenia'], ['Australia'], ['Austria'],
  ['Azerbaijan'], ['Bahamas', 'the bahamas'], ['Bahrain'], ['Bangladesh'], ['Barbados'],
  ['Belarus'], ['Belgium'], ['Belize'], ['Benin'], ['Bhutan'],
  ['Bolivia', 'bolivia (plurinational state of)'], ['Bosnia and Herzegovina'], ['Botswana'],
  ['Brazil'], ['Brunei', 'brunei darussalam'], ['Bulgaria'], ['Burkina Faso'], ['Burundi'],
  ['Cabo Verde', 'cape verde'], ['Cambodia'], ['Cameroon'], ['Canada'],
  ['Central African Republic'], ['Chad'], ['Chile'], ['China', "people's republic of china"],
  ['Colombia'], ['Comoros'], ['Republic of the Congo', 'congo', 'congo republic', 'republic of congo'],
  ['Democratic Republic of the Congo', 'dr congo', 'drc', 'congo, democratic republic', 'democratic republic of congo', 'zaire'],
  ['Costa Rica'], ["Côte d'Ivoire", "cote d'ivoire", 'ivory coast'], ['Croatia'], ['Cuba'],
  ['Cyprus'], ['Czechia', 'czech republic'], ['Denmark'], ['Djibouti'], ['Dominica'],
  ['Dominican Republic'], ['Ecuador'], ['Egypt'], ['El Salvador'], ['Equatorial Guinea'],
  ['Eritrea'], ['Estonia'], ['Eswatini', 'swaziland'], ['Ethiopia'], ['Fiji'],
  ['Finland'], ['France'], ['Gabon'], ['Gambia', 'the gambia'], ['Georgia'],
  ['Germany'], ['Ghana'], ['Greece'], ['Grenada'], ['Guatemala'],
  ['Guinea'], ['Guinea-Bissau'], ['Guyana'], ['Haiti'], ['Honduras'],
  ['Hungary'], ['Iceland'], ['India'], ['Indonesia'],
  ['Iran', 'iran (islamic republic of)', 'islamic republic of iran'], ['Iraq'],
  ['Ireland'], ['Israel'], ['Italy'], ['Jamaica'], ['Japan'], ['Jordan'],
  ['Kazakhstan'], ['Kenya'], ['Kiribati'],
  ['North Korea', "democratic people's republic of korea", 'dprk'],
  ['South Korea', 'republic of korea', 'korea, south', 'korea (the republic of)'],
  ['Kuwait'], ['Kyrgyzstan'], ['Laos', "lao people's democratic republic", 'lao pdr'],
  ['Latvia'], ['Lebanon'], ['Lesotho'], ['Liberia'], ['Libya'], ['Liechtenstein'],
  ['Lithuania'], ['Luxembourg'], ['Madagascar'], ['Malawi'], ['Malaysia'],
  ['Maldives'], ['Mali'], ['Malta'], ['Marshall Islands'], ['Mauritania'],
  ['Mauritius'], ['Mexico'], ['Micronesia', 'federated states of micronesia'],
  ['Moldova', 'republic of moldova'], ['Monaco'], ['Mongolia'], ['Montenegro'],
  ['Morocco'], ['Mozambique'], ['Myanmar', 'burma'], ['Namibia'], ['Nauru'],
  ['Nepal'], ['Netherlands', 'the netherlands', 'netherlands (kingdom of the)'],
  ['New Zealand'], ['Nicaragua'], ['Niger', 'the niger'], ['Nigeria'],
  ['North Macedonia', 'macedonia'], ['Norway'], ['Oman'], ['Pakistan'], ['Palau'],
  ['Palestine', 'occupied palestinian territory', 'palestinian territory', 'west bank and gaza', 'gaza strip'],
  ['Panama'], ['Papua New Guinea'], ['Paraguay'], ['Peru'], ['Philippines', 'the philippines'],
  ['Poland'], ['Portugal'], ['Qatar'], ['Romania'],
  ['Russia', 'russian federation'], ['Rwanda'], ['Saint Kitts and Nevis'],
  ['Saint Lucia'], ['Saint Vincent and the Grenadines'], ['Samoa'], ['San Marino'],
  ['Sao Tome and Principe', 'são tomé and príncipe'], ['Saudi Arabia', 'kingdom of saudi arabia'],
  ['Senegal'], ['Serbia'], ['Seychelles'], ['Sierra Leone'], ['Singapore'],
  ['Slovakia'], ['Slovenia'], ['Solomon Islands'], ['Somalia'], ['South Africa'],
  ['South Sudan'], ['Spain'], ['Sri Lanka'], ['Sudan', 'the sudan'], ['Suriname'],
  ['Sweden'], ['Switzerland'], ['Syria', 'syrian arab republic'],
  ['Taiwan', 'taiwan, china', 'taiwan (province of china)'], ['Tajikistan'],
  ['Tanzania', 'united republic of tanzania'], ['Thailand'],
  ['Timor-Leste', 'east timor'], ['Togo'], ['Tonga'], ['Trinidad and Tobago'],
  ['Tunisia'], ['Turkey', 'türkiye', 'turkiye'], ['Turkmenistan'], ['Tuvalu'],
  ['Uganda'], ['Ukraine'], ['United Arab Emirates', 'uae'],
  ['United Kingdom', 'uk', 'great britain', 'united kingdom of great britain and northern ireland', 'england', 'scotland', 'wales', 'northern ireland'],
  ['United States', 'usa', 'united states of america', 'us', 'u.s.'],
  ['Uruguay'], ['Uzbekistan'], ['Vanuatu'],
  ['Venezuela', 'venezuela (bolivarian republic of)'], ['Vietnam', 'viet nam'],
  ['Yemen'], ['Zambia'], ['Zimbabwe'],
  // Territories that appear as event locations in the archives
  ['Puerto Rico'], ['Greenland'], ['New Caledonia'], ['French Polynesia'],
  ['Guam'], ['Hong Kong', 'hong kong sar'], ['Macao', 'macau'],
  ['Réunion', 'reunion'], ['Mayotte'], ['Martinique'], ['Guadeloupe'],
  ['Bermuda'], ['Cayman Islands'], ['Aruba'], ['Curaçao', 'curacao'],
  ['Kosovo'], ['Western Sahara'], ['American Samoa'], ['Northern Mariana Islands'],
  ['Cook Islands'], ['Niue'], ['Tokelau'], ['Wallis and Futuna'],
  ['British Virgin Islands'], ['U.S. Virgin Islands', 'us virgin islands', 'virgin islands'],
  ['Turks and Caicos Islands'], ['Anguilla'], ['Montserrat'], ['Gibraltar'],
  ['Faroe Islands'], ['Isle of Man'], ['Jersey'], ['Guernsey'],
];

/** lowercase variant → canonical name */
export const COUNTRY_LOOKUP = new Map();
for (const entry of COUNTRIES) {
  const canonical = entry[0];
  COUNTRY_LOOKUP.set(canonical.toLowerCase(), canonical);
  for (const v of entry.slice(1)) COUNTRY_LOOKUP.set(v, canonical);
}

export function canonicalCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/^the\s+/, '').replace(/\.$/, '');
  return COUNTRY_LOOKUP.get(key) ?? COUNTRY_LOOKUP.get(raw.trim().toLowerCase()) ?? null;
}

/** Scan free text (official source text only) for country names that
 *  literally appear in it. Returns unique canonical names, in text order. */
export function scanCountries(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];
  for (const [variant, canonical] of COUNTRY_LOOKUP) {
    if (variant.length < 4 && !['us', 'uk', 'uae', 'drc'].includes(variant)) continue;
    const re = new RegExp(`(?<![a-z])${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i');
    if (re.test(lower) && !found.includes(canonical)) found.push(canonical);
  }
  return found;
}

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
export const US_STATE_NAMES = new Set(Object.values(US_STATES).map((s) => s.toLowerCase()));
