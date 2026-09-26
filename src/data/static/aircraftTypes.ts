/**
 * Reference data for aircraft types commonly seen around Singapore, keyed by ICAO type
 * designator. Figures are typical values for the type (seats vary by airline layout).
 */

export type TypeCategory =
  | 'narrowbody'
  | 'widebody'
  | 'regional'
  | 'turboprop'
  | 'bizjet'
  | 'helicopter'
  | 'military'
  | 'light'
  | 'freighter';

export interface AircraftType {
  name: string;
  maker: string;
  cat: TypeCategory;
  engines?: string;
  seats?: string;
  /** Length and wingspan, metres. */
  length?: number;
  span?: number;
  /** Typical maximum range, km. */
  rangeKm?: number;
  firstFlight?: number;
  /** Wake turbulence category: L light, M medium, H heavy, J super. */
  wake?: 'L' | 'M' | 'H' | 'J';
  fact?: string;
  /** Rare or remarkable at Changi: triggers a "special" alert. */
  special?: boolean;
}

const t = (name: string, maker: string, cat: TypeCategory, rest: Partial<AircraftType> = {}): AircraftType => ({
  name,
  maker,
  cat,
  ...rest,
});

export const AIRCRAFT_TYPES: Record<string, AircraftType> = {
  // ------------------------------------------------------------------ Airbus
  A319: t('A319', 'Airbus', 'narrowbody', {
    engines: '2 × CFM56-5B or IAE V2500', seats: '124–156', length: 33.8, span: 35.8, rangeKm: 6850,
    firstFlight: 1995, wake: 'M', fact: 'A shortened A320. Its ACJ319 corporate version is a popular VIP jet.',
  }),
  A19N: t('A319neo', 'Airbus', 'narrowbody', {
    engines: '2 × CFM LEAP-1A or PW1100G', seats: '120–160', length: 33.8, span: 35.8, rangeKm: 6850,
    firstFlight: 2017, wake: 'M', fact: 'The rarest member of the neo family: only a few dozen have been built.',
  }),
  A320: t('A320', 'Airbus', 'narrowbody', {
    engines: '2 × CFM56-5B or IAE V2500', seats: '150–180', length: 37.6, span: 35.8, rangeKm: 6150,
    firstFlight: 1987, wake: 'M', fact: 'The first airliner with digital fly-by-wire controls and a sidestick instead of a yoke.',
  }),
  A20N: t('A320neo', 'Airbus', 'narrowbody', {
    engines: '2 × CFM LEAP-1A or PW1100G', seats: '150–186', length: 37.6, span: 35.8, rangeKm: 6300,
    firstFlight: 2014, wake: 'M', fact: '"neo" means New Engine Option: up to 20% less fuel per seat than the original A320.',
  }),
  A321: t('A321', 'Airbus', 'narrowbody', {
    engines: '2 × CFM56-5B or IAE V2500', seats: '185–220', length: 44.5, span: 35.8, rangeKm: 5950,
    firstFlight: 1993, wake: 'M', fact: 'The stretched A320. It needed double-slotted flaps to cope with the extra weight.',
  }),
  A21N: t('A321neo', 'Airbus', 'narrowbody', {
    engines: '2 × CFM LEAP-1A or PW1100G', seats: '180–244', length: 44.5, span: 35.8, rangeKm: 7400,
    firstFlight: 2016, wake: 'M', fact: 'Its XLR version flies up to 8,700 km, so single-aisle jets now cross oceans.',
  }),
  BCS1: t('A220-100', 'Airbus', 'narrowbody', {
    engines: '2 × PW1500G', seats: '100–135', length: 35.0, span: 35.1, rangeKm: 6390, firstFlight: 2013, wake: 'M',
    fact: 'Designed by Bombardier as the CSeries; Airbus took over the programme in 2018.',
  }),
  BCS3: t('A220-300', 'Airbus', 'narrowbody', {
    engines: '2 × PW1500G', seats: '120–160', length: 38.7, span: 35.1, rangeKm: 6300, firstFlight: 2015, wake: 'M',
    fact: 'Designed by Bombardier as the CSeries; Airbus took over the programme in 2018.',
  }),
  A332: t('A330-200', 'Airbus', 'widebody', {
    engines: '2 × GE CF6, PW4000 or RR Trent 700', seats: '220–260', length: 58.8, span: 60.3, rangeKm: 13450,
    firstFlight: 1997, wake: 'H', fact: 'The RSAF flies an air-to-air refuelling version, the A330 MRTT.',
  }),
  A333: t('A330-300', 'Airbus', 'widebody', {
    engines: '2 × GE CF6, PW4000 or RR Trent 700', seats: '250–300', length: 63.7, span: 60.3, rangeKm: 11750,
    firstFlight: 1992, wake: 'H', fact: 'Developed alongside the four-engine A340; the two share the same wing.',
  }),
  A338: t('A330-800', 'Airbus', 'widebody', {
    engines: '2 × Rolls-Royce Trent 7000', seats: '220–260', length: 58.8, span: 64.0, rangeKm: 15000,
    firstFlight: 2018, wake: 'H', fact: 'One of the rarest current widebodies: only a handful of airlines fly it.',
  }),
  A339: t('A330-900', 'Airbus', 'widebody', {
    engines: '2 × Rolls-Royce Trent 7000', seats: '260–300', length: 63.7, span: 64.0, rangeKm: 13300,
    firstFlight: 2017, wake: 'H', fact: 'A new 64 m wing inspired by the A350, and engines from Rolls-Royce only.',
  }),
  A343: t('A340-300', 'Airbus', 'widebody', {
    engines: '4 × CFM56-5C', seats: '250–300', length: 63.7, span: 60.3, rangeKm: 13500, firstFlight: 1991,
    wake: 'H', special: true,
    fact: 'Four engines let it fly long over-water routes before twin-engine rules (ETOPS) were relaxed.',
  }),
  A346: t('A340-600', 'Airbus', 'widebody', {
    engines: '4 × Rolls-Royce Trent 500', seats: '320–370', length: 75.4, span: 63.5, rangeKm: 14450,
    firstFlight: 2001, wake: 'H', special: true, fact: 'It was the longest airliner in the world until the 747-8 arrived.',
  }),
  A359: t('A350-900', 'Airbus', 'widebody', {
    engines: '2 × Rolls-Royce Trent XWB', seats: '300–350', length: 66.8, span: 64.75, rangeKm: 15000,
    firstFlight: 2013, wake: 'H',
    fact: 'Singapore Airlines flies an ultra-long-range A350-900 non-stop to New York, about 15,300 km and 18+ hours.',
  }),
  A35K: t('A350-1000', 'Airbus', 'widebody', {
    engines: '2 × Rolls-Royce Trent XWB-97', seats: '350–410', length: 73.8, span: 64.75, rangeKm: 16100,
    firstFlight: 2016, wake: 'H',
    fact: 'Qantas ordered a special version for non-stop Sydney–London "Project Sunrise" flights.',
  }),
  A388: t('A380-800', 'Airbus', 'widebody', {
    engines: '4 × RR Trent 900 or Engine Alliance GP7200', seats: '480–575', length: 72.7, span: 79.8,
    rangeKm: 15000, firstFlight: 2005, wake: 'J', special: true,
    fact: 'The world\'s largest airliner. Singapore Airlines flew the first A380 passenger service, Singapore–Sydney, on 25 Oct 2007.',
  }),
  A306: t('A300-600', 'Airbus', 'freighter', {
    engines: '2 × GE CF6 or PW4000', length: 54.1, span: 44.8, rangeKm: 7500, firstFlight: 1983, wake: 'H',
    fact: 'Descended from the A300, Airbus\'s first airliner (1972) and the first twin-engine widebody.',
  }),
  A3ST: t('A300-600ST Beluga', 'Airbus', 'freighter', {
    engines: '2 × GE CF6', length: 56.2, span: 44.8, firstFlight: 1994, wake: 'H', special: true,
    fact: 'Built to carry whole Airbus wings and fuselage sections between factories.',
  }),
  A337: t('BelugaXL', 'Airbus', 'freighter', {
    engines: '2 × Rolls-Royce Trent 700', length: 63.1, span: 60.3, firstFlight: 2018, wake: 'H', special: true,
    fact: 'Based on the A330, it can carry both wings of an A350 at once.',
  }),
  A400: t('A400M Atlas', 'Airbus', 'military', {
    engines: '4 × Europrop TP400 turboprops', length: 45.1, span: 42.4, firstFlight: 2009, wake: 'H', special: true,
    fact: 'The propellers on each wing spin in opposite directions to cancel out swirl.',
  }),

  // ------------------------------------------------------------------ Boeing
  B737: t('737-700', 'Boeing', 'narrowbody', {
    engines: '2 × CFM56-7B', seats: '126–149', length: 33.6, span: 35.8, rangeKm: 6370, firstFlight: 1997, wake: 'M',
    fact: 'The Boeing Business Jet (BBJ), a favourite of governments and billionaires, is based on it.',
  }),
  B738: t('737-800', 'Boeing', 'narrowbody', {
    engines: '2 × CFM56-7B', seats: '162–189', length: 39.5, span: 35.8, rangeKm: 5400, firstFlight: 1997,
    wake: 'M', fact: 'The best-selling 737 of all: nearly 5,000 were built.',
  }),
  B739: t('737-900', 'Boeing', 'narrowbody', {
    engines: '2 × CFM56-7B', seats: '177–220', length: 42.1, span: 35.8, rangeKm: 5000, firstFlight: 2000, wake: 'M',
  }),
  B37M: t('737 MAX 7', 'Boeing', 'narrowbody', {
    engines: '2 × CFM LEAP-1B', seats: '138–153', length: 35.6, span: 35.9, rangeKm: 7130, firstFlight: 2018, wake: 'M',
  }),
  B38M: t('737 MAX 8', 'Boeing', 'narrowbody', {
    engines: '2 × CFM LEAP-1B', seats: '162–210', length: 39.5, span: 35.9, rangeKm: 6570, firstFlight: 2016,
    wake: 'M', fact: 'Look for the split-tip winglets and the saw-tooth edges on the engine covers.',
  }),
  B39M: t('737 MAX 9', 'Boeing', 'narrowbody', {
    engines: '2 × CFM LEAP-1B', seats: '178–220', length: 42.2, span: 35.9, rangeKm: 6570, firstFlight: 2017, wake: 'M',
  }),
  B3XM: t('737 MAX 10', 'Boeing', 'narrowbody', {
    engines: '2 × CFM LEAP-1B', seats: '188–230', length: 43.8, span: 35.9, rangeKm: 5740, firstFlight: 2021,
    wake: 'M', fact: 'The longest 737 ever. Its landing gear extends on take-off so the tail clears the runway.',
  }),
  B752: t('757-200', 'Boeing', 'narrowbody', {
    engines: '2 × RR RB211 or PW2000', seats: '200–239', length: 47.3, span: 38.1, rangeKm: 7250, firstFlight: 1982,
    wake: 'M', special: true, fact: 'Famous for steep, powerful take-offs; now flown mostly as a freighter.',
  }),
  B763: t('767-300', 'Boeing', 'widebody', {
    engines: '2 × GE CF6 or PW4000', seats: '218–269', length: 54.9, span: 47.6, rangeKm: 11070, firstFlight: 1986,
    wake: 'H', fact: 'Its 767-300F freighter version is a workhorse for DHL, FedEx and UPS.',
  }),
  B772: t('777-200', 'Boeing', 'widebody', {
    engines: '2 × GE90, PW4000 or RR Trent 800', seats: '301–368', length: 63.7, span: 60.9, rangeKm: 13080,
    firstFlight: 1994, wake: 'H', fact: 'The first airliner designed entirely on computer, with no full-scale mock-up.',
  }),
  B77L: t('777-200LR / 777F', 'Boeing', 'widebody', {
    engines: '2 × GE90-110B / -115B', seats: '301–317', length: 63.7, span: 64.8, rangeKm: 15800,
    firstFlight: 2005, wake: 'H',
    fact: 'A 777-200LR flew 21,602 km non-stop from Hong Kong to London (eastbound) in 2005, a record for airliners.',
  }),
  B77W: t('777-300ER', 'Boeing', 'widebody', {
    engines: '2 × GE90-115B', seats: '350–420', length: 73.9, span: 64.8, rangeKm: 13650, firstFlight: 2003,
    wake: 'H', fact: 'Its GE90-115B engines have a 3.25 m fan. They are among the most powerful jet engines ever flown.',
  }),
  B779: t('777-9', 'Boeing', 'widebody', {
    engines: '2 × GE9X', seats: '400–426', length: 76.7, span: 71.8, rangeKm: 13500, firstFlight: 2020, wake: 'H',
    special: true, fact: 'The first airliner with folding wingtips, so its 72 m wing still fits standard gates.',
  }),
  B788: t('787-8 Dreamliner', 'Boeing', 'widebody', {
    engines: '2 × GEnx-1B or RR Trent 1000', seats: '242–248', length: 56.7, span: 60.1, rangeKm: 13530,
    firstFlight: 2009, wake: 'H', fact: 'About half of its structure by weight is carbon-fibre composite.',
  }),
  B789: t('787-9 Dreamliner', 'Boeing', 'widebody', {
    engines: '2 × GEnx-1B or RR Trent 1000', seats: '290–296', length: 62.8, span: 60.1, rangeKm: 14010,
    firstFlight: 2013, wake: 'H', fact: 'Qantas uses it for non-stop Perth–London, about 14,500 km.',
  }),
  B78X: t('787-10 Dreamliner', 'Boeing', 'widebody', {
    engines: '2 × GEnx-1B or RR Trent 1000', seats: '318–336', length: 68.3, span: 60.1, rangeKm: 11730,
    firstFlight: 2017, wake: 'H', fact: 'Singapore Airlines was the launch customer and took the first one in March 2018.',
  }),
  B744: t('747-400', 'Boeing', 'widebody', {
    engines: '4 × GE CF6, PW4000 or RR RB211', seats: '416–524', length: 70.7, span: 64.4, rangeKm: 13450,
    firstFlight: 1988, wake: 'H', special: true,
    fact: 'The "Queen of the Skies". Singapore Airlines called its 747-400s "Megatop" after the stretched upper deck.',
  }),
  B748: t('747-8', 'Boeing', 'widebody', {
    engines: '4 × GEnx-2B', seats: '410–467', length: 76.3, span: 68.4, rangeKm: 14300, firstFlight: 2010,
    wake: 'H', special: true,
    fact: 'The final 747, a 747-8F freighter, was delivered in January 2023 after 54 years of production.',
  }),
  BLCF: t('747 Dreamlifter', 'Boeing', 'freighter', {
    engines: '4 × PW4000', length: 71.7, span: 64.4, firstFlight: 2006, wake: 'H', special: true,
    fact: 'A heavily modified 747 that hauls 787 wings and fuselage parts. Its whole tail swings open.',
  }),
  MD11: t('MD-11', 'McDonnell Douglas', 'freighter', {
    engines: '3 × GE CF6 or PW4000', length: 61.6, span: 51.7, rangeKm: 12600, firstFlight: 1990, wake: 'H',
    special: true, fact: 'A tri-jet: the third engine sits at the base of the tail fin.',
  }),

  // ------------------------------------------------------------------ Regional & turboprops
  E190: t('E190', 'Embraer', 'regional', {
    engines: '2 × GE CF34-10E', seats: '96–114', length: 36.2, span: 28.7, rangeKm: 4500, firstFlight: 2004, wake: 'M',
  }),
  E195: t('E195', 'Embraer', 'regional', {
    engines: '2 × GE CF34-10E', seats: '100–124', length: 38.7, span: 28.7, rangeKm: 4200, firstFlight: 2004, wake: 'M',
  }),
  E290: t('E190-E2', 'Embraer', 'regional', {
    engines: '2 × PW1900G', seats: '96–114', length: 36.2, span: 33.7, rangeKm: 5300, firstFlight: 2016, wake: 'M',
    fact: 'Scoot flies E190-E2s from Changi on shorter regional routes.',
  }),
  E295: t('E195-E2', 'Embraer', 'regional', {
    engines: '2 × PW1900G', seats: '120–146', length: 41.5, span: 35.1, rangeKm: 4800, firstFlight: 2017, wake: 'M',
  }),
  C919: t('C919', 'COMAC', 'narrowbody', {
    engines: '2 × CFM LEAP-1C', seats: '158–192', length: 38.9, span: 35.8, rangeKm: 5500, firstFlight: 2017,
    wake: 'M', special: true, fact: 'China\'s first home-grown mainline jetliner, in passenger service since 2023.',
  }),
  AJ27: t('C909 (ARJ21)', 'COMAC', 'regional', {
    engines: '2 × GE CF34-10A', seats: '78–97', length: 33.5, span: 27.3, rangeKm: 3700, firstFlight: 2008,
    wake: 'M', special: true,
  }),
  AT72: t('ATR 72', 'ATR', 'turboprop', {
    engines: '2 × PW127 turboprops', seats: '68–78', length: 27.2, span: 27.1, rangeKm: 1500, firstFlight: 1988,
    wake: 'M', fact: 'A turboprop: listen for a propeller hum rather than a jet roar.',
  }),
  AT75: t('ATR 72-500', 'ATR', 'turboprop', {
    engines: '2 × PW127F turboprops', seats: '68–78', length: 27.2, span: 27.1, rangeKm: 1500, firstFlight: 1996,
    wake: 'M', fact: 'A turboprop: listen for a propeller hum rather than a jet roar.',
  }),
  AT76: t('ATR 72-600', 'ATR', 'turboprop', {
    engines: '2 × PW127M turboprops', seats: '68–78', length: 27.2, span: 27.1, rangeKm: 1500, firstFlight: 2009,
    wake: 'M', fact: 'A turboprop: listen for a propeller hum rather than a jet roar.',
  }),
  AT46: t('ATR 42-600', 'ATR', 'turboprop', {
    engines: '2 × PW127M turboprops', seats: '40–52', length: 22.7, span: 24.6, rangeKm: 1300, firstFlight: 2010, wake: 'M',
  }),
  DH8D: t('Dash 8-400', 'De Havilland Canada', 'turboprop', {
    engines: '2 × PW150A turboprops', seats: '68–90', length: 32.8, span: 28.4, rangeKm: 2000, firstFlight: 1998,
    wake: 'M', fact: 'One of the fastest turboprop airliners, cruising at around 660 km/h.',
  }),

  // ------------------------------------------------------------------ Business & light aircraft
  GLF5: t('Gulfstream G550', 'Gulfstream', 'bizjet', {
    engines: '2 × RR BR710', seats: '14–19', length: 29.4, span: 28.5, rangeKm: 12500, firstFlight: 2003, wake: 'M',
    fact: 'The RSAF flies an airborne early-warning version with radars built into the fuselage.',
  }),
  GLF6: t('Gulfstream G650', 'Gulfstream', 'bizjet', {
    engines: '2 × RR BR725', seats: '11–19', length: 30.4, span: 30.4, rangeKm: 12960, firstFlight: 2009, wake: 'M',
    fact: 'One of the fastest business jets, up to Mach 0.925.',
  }),
  GL7T: t('Global 7500', 'Bombardier', 'bizjet', {
    engines: '2 × GE Passport', seats: '14–19', length: 33.8, span: 31.7, rangeKm: 14260, firstFlight: 2016, wake: 'M',
    fact: 'The largest purpose-built business jet, with four separate cabin zones.',
  }),
  GLEX: t('Global Express / 6000', 'Bombardier', 'bizjet', {
    engines: '2 × RR BR710', seats: '13–17', length: 30.3, span: 28.7, rangeKm: 11100, firstFlight: 1996, wake: 'M',
  }),
  FA7X: t('Falcon 7X', 'Dassault', 'bizjet', {
    engines: '3 × PW307A', seats: '12–16', length: 23.2, span: 26.2, rangeKm: 11000, firstFlight: 2005, wake: 'M',
    fact: 'The first business jet with digital fly-by-wire, and it has three engines.',
  }),
  FA8X: t('Falcon 8X', 'Dassault', 'bizjet', {
    engines: '3 × PW307D', seats: '12–16', length: 24.5, span: 26.3, rangeKm: 11900, firstFlight: 2015, wake: 'M',
  }),
  CL60: t('Challenger 600 series', 'Bombardier', 'bizjet', {
    engines: '2 × GE CF34', seats: '9–12', length: 20.9, span: 19.6, rangeKm: 7400, firstFlight: 1978, wake: 'M',
  }),
  C68A: t('Citation Latitude', 'Cessna', 'bizjet', {
    engines: '2 × PW306D1', seats: '8–9', length: 19.0, span: 22.1, rangeKm: 5000, firstFlight: 2014, wake: 'M',
  }),
  E55P: t('Phenom 300', 'Embraer', 'bizjet', {
    engines: '2 × PW535E', seats: '6–10', length: 15.9, span: 16.2, rangeKm: 3650, firstFlight: 2008, wake: 'L',
    fact: 'For years the world\'s best-selling light jet.',
  }),
  PC12: t('PC-12', 'Pilatus', 'light', {
    engines: '1 × PT6A turboprop', seats: '6–9', length: 14.4, span: 16.3, rangeKm: 3400, firstFlight: 1991, wake: 'L',
  }),
  DA40: t('DA40 Diamond Star', 'Diamond', 'light', {
    engines: '1 × piston', seats: '4', length: 8.1, span: 11.9, rangeKm: 1300, firstFlight: 1997, wake: 'L',
    fact: 'A composite trainer. Around Singapore these are usually student pilots flying from Seletar.',
  }),
  C172: t('Cessna 172', 'Cessna', 'light', {
    engines: '1 × piston', seats: '4', length: 8.3, span: 11.0, rangeKm: 1200, firstFlight: 1955, wake: 'L',
    fact: 'The most-produced aircraft in history, with more than 45,000 built.',
  }),

  // ------------------------------------------------------------------ Military
  C130: t('C-130 Hercules', 'Lockheed', 'military', {
    engines: '4 × Allison T56 turboprops', length: 29.8, span: 40.4, firstFlight: 1954, wake: 'M', special: true,
    fact: 'In production since the 1950s. The RSAF flies C-130s from Paya Lebar Air Base, a few km north of East Coast Park.',
  }),
  C30J: t('C-130J Super Hercules', 'Lockheed Martin', 'military', {
    engines: '4 × RR AE2100 turboprops', length: 29.8, span: 40.4, firstFlight: 1996, wake: 'M', special: true,
    fact: 'The modern Hercules, easy to spot by its six-bladed scimitar propellers.',
  }),
  C17: t('C-17 Globemaster III', 'Boeing', 'military', {
    engines: '4 × PW F117', length: 53.0, span: 51.8, firstFlight: 1991, wake: 'H', special: true,
    fact: 'Carries around 77 t of cargo yet can land on short, rough airstrips.',
  }),
  F15: t('F-15 Eagle', 'Boeing', 'military', {
    engines: '2 × turbofan', length: 19.4, span: 13.1, firstFlight: 1972, wake: 'M', special: true,
    fact: 'The RSAF\'s F-15SG strike fighters are based at Paya Lebar Air Base, a few km north of East Coast Park.',
  }),
  F16: t('F-16 Fighting Falcon', 'Lockheed Martin', 'military', {
    engines: '1 × turbofan', length: 15.1, span: 10.0, firstFlight: 1974, wake: 'M', special: true,
    fact: 'The RSAF operates upgraded F-16 Block 52 fighters.',
  }),
  F35: t('F-35 Lightning II', 'Lockheed Martin', 'military', {
    engines: '1 × PW F135', length: 15.6, span: 10.7, firstFlight: 2006, wake: 'M', special: true,
    fact: 'The RSAF is introducing the F-35B, which can take off short and land vertically.',
  }),
  P8: t('P-8 Poseidon', 'Boeing', 'military', {
    engines: '2 × CFM56-7B', length: 39.5, span: 37.6, firstFlight: 2009, wake: 'M', special: true,
    fact: 'A 737-800 turned into a submarine hunter.',
  }),
  K35R: t('KC-135 Stratotanker', 'Boeing', 'military', {
    engines: '4 × CFM F108', length: 41.5, span: 39.9, firstFlight: 1956, wake: 'H', special: true,
  }),

  // ------------------------------------------------------------------ Helicopters
  EC25: t('H225 Super Puma', 'Airbus Helicopters', 'helicopter', {
    engines: '2 × Makila 2A1 turboshafts', length: 19.5, firstFlight: 2000, wake: 'M',
    fact: 'The RSAF uses the H225M for search and rescue.',
  }),
  AS32: t('AS332 Super Puma', 'Airbus Helicopters', 'helicopter', {
    engines: '2 × Makila 1A turboshafts', length: 18.7, firstFlight: 1978, wake: 'M',
  }),
  CH47: t('CH-47 Chinook', 'Boeing', 'helicopter', {
    engines: '2 × Honeywell T55 turboshafts', length: 30.1, firstFlight: 1961, wake: 'M', special: true,
    fact: 'Two big tandem rotors and no tail rotor. The RSAF flies CH-47Fs.',
  }),
  S70: t('S-70 / Seahawk', 'Sikorsky', 'helicopter', {
    engines: '2 × GE T700 turboshafts', length: 19.8, firstFlight: 1974, wake: 'M', special: true,
  }),
  EC35: t('H135', 'Airbus Helicopters', 'helicopter', {
    engines: '2 × turboshafts', length: 10.2, firstFlight: 1994, wake: 'L',
  }),
  AS65: t('AS365 Dauphin', 'Airbus Helicopters', 'helicopter', {
    engines: '2 × Arriel turboshafts', length: 13.7, firstFlight: 1975, wake: 'L',
  }),
  B412: t('Bell 412', 'Bell', 'helicopter', {
    engines: '2 × PT6T turboshafts', length: 17.1, firstFlight: 1979, wake: 'L',
  }),
  S76: t('S-76', 'Sikorsky', 'helicopter', { engines: '2 × turboshafts', length: 16.0, firstFlight: 1977, wake: 'L' }),
};

/** Aliases for designators that share an entry. */
const ALIASES: Record<string, string> = {
  A342: 'A343', A345: 'A346', A310: 'A306', A30B: 'A306', B77F: 'B77L', B74F: 'B744', B74S: 'B744',
  B762: 'B763', B764: 'B763', B778: 'B779', E75L: 'E190', E75S: 'E190', E170: 'E190', AT45: 'AT46', AT43: 'AT46',
  GLF4: 'GLF5', GA6C: 'GLF6', C56X: 'C68A', CL35: 'CL60', H25B: 'CL60', MRTT: 'A332',
};

export function lookupType(code: string | undefined): AircraftType | undefined {
  if (!code) return undefined;
  const c = code.toUpperCase();
  return AIRCRAFT_TYPES[c] ?? AIRCRAFT_TYPES[ALIASES[c] ?? ''];
}

/** "BOEING 777-300ER" → "Boeing 777-300ER" for types not in the table. Model codes stay upper-case. */
export function prettyDesc(desc: string | undefined): string | undefined {
  if (!desc) return undefined;
  return desc
    .trim()
    .split(/\s+/)
    .map((w) => (/\d/.test(w) || /^(I{1,3}|IV|V)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}
