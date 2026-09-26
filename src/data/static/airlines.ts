/**
 * Offline fallback for airlines seen at Changi, keyed by ICAO code (the first three
 * letters of a callsign). Live lookups from adsbdb take precedence.
 */

export interface AirlineRef {
  name: string;
  iata?: string;
  /** ISO 3166 country code. */
  country?: string;
  /** Radio callsign, e.g. "SINGAPORE", "SPEEDBIRD". */
  radio?: string;
}

const a = (name: string, iata: string, country: string, radio: string): AirlineRef => ({ name, iata, country, radio });

export const AIRLINES: Record<string, AirlineRef> = {
  SIA: a('Singapore Airlines', 'SQ', 'SG', 'SINGAPORE'),
  SQC: a('Singapore Airlines Cargo', 'SQ', 'SG', 'SINGCARGO'),
  TGW: a('Scoot', 'TR', 'SG', 'SCOOTER'),
  JSA: a('Jetstar Asia', '3K', 'SG', 'JETSTAR ASIA'),
  QFA: a('Qantas', 'QF', 'AU', 'QANTAS'),
  JST: a('Jetstar', 'JQ', 'AU', 'JETSTAR'),
  VOZ: a('Virgin Australia', 'VA', 'AU', 'VELOCITY'),
  ANZ: a('Air New Zealand', 'NZ', 'NZ', 'NEW ZEALAND'),
  UAE: a('Emirates', 'EK', 'AE', 'EMIRATES'),
  QTR: a('Qatar Airways', 'QR', 'QA', 'QATARI'),
  ETD: a('Etihad Airways', 'EY', 'AE', 'ETIHAD'),
  BAW: a('British Airways', 'BA', 'GB', 'SPEEDBIRD'),
  DLH: a('Lufthansa', 'LH', 'DE', 'LUFTHANSA'),
  AFR: a('Air France', 'AF', 'FR', 'AIRFRANS'),
  KLM: a('KLM', 'KL', 'NL', 'KLM'),
  SWR: a('Swiss', 'LX', 'CH', 'SWISS'),
  FIN: a('Finnair', 'AY', 'FI', 'FINNAIR'),
  THY: a('Turkish Airlines', 'TK', 'TR', 'TURKISH'),
  UAL: a('United Airlines', 'UA', 'US', 'UNITED'),
  CPA: a('Cathay Pacific', 'CX', 'HK', 'CATHAY'),
  HKE: a('HK Express', 'UO', 'HK', 'HONGKONG SHUTTLE'),
  JAL: a('Japan Airlines', 'JL', 'JP', 'JAPANAIR'),
  ANA: a('All Nippon Airways', 'NH', 'JP', 'ALL NIPPON'),
  KAL: a('Korean Air', 'KE', 'KR', 'KOREANAIR'),
  AAR: a('Asiana Airlines', 'OZ', 'KR', 'ASIANA'),
  JJA: a('Jeju Air', '7C', 'KR', 'JEJU AIR'),
  TWB: a("T'way Air", 'TW', 'KR', 'TEEWAY'),
  EVA: a('EVA Air', 'BR', 'TW', 'EVA'),
  CAL: a('China Airlines', 'CI', 'TW', 'DYNASTY'),
  SJX: a('Starlux Airlines', 'JX', 'TW', 'STARWALKER'),
  CCA: a('Air China', 'CA', 'CN', 'AIR CHINA'),
  CES: a('China Eastern', 'MU', 'CN', 'CHINA EASTERN'),
  CSN: a('China Southern', 'CZ', 'CN', 'CHINA SOUTHERN'),
  CXA: a('Xiamen Airlines', 'MF', 'CN', 'XIAMEN AIR'),
  CSZ: a('Shenzhen Airlines', 'ZH', 'CN', 'SHENZHEN AIR'),
  CHH: a('Hainan Airlines', 'HU', 'CN', 'HAINAN'),
  CSC: a('Sichuan Airlines', '3U', 'CN', 'SI CHUAN'),
  CKK: a('China Cargo Airlines', 'CK', 'CN', 'CARGO KING'),
  HVN: a('Vietnam Airlines', 'VN', 'VN', 'VIET NAM AIRLINES'),
  VJC: a('VietJet Air', 'VJ', 'VN', 'VIETJET'),
  THA: a('Thai Airways', 'TG', 'TH', 'THAI'),
  TLM: a('Thai Lion Air', 'SL', 'TH', 'MENTARI'),
  AIQ: a('Thai AirAsia', 'FD', 'TH', 'THAI ASIA'),
  TVJ: a('Thai VietJet', 'VZ', 'TH', 'THAIVIET JET'),
  MAS: a('Malaysia Airlines', 'MH', 'MY', 'MALAYSIAN'),
  AXM: a('AirAsia', 'AK', 'MY', 'RED CAP'),
  MXD: a('Batik Air Malaysia', 'OD', 'MY', 'MALINDO'),
  FFM: a('Firefly', 'FY', 'MY', 'FIREFLY'),
  GIA: a('Garuda Indonesia', 'GA', 'ID', 'INDONESIA'),
  CTV: a('Citilink', 'QG', 'ID', 'SUPERGREEN'),
  LNI: a('Lion Air', 'JT', 'ID', 'LION INTER'),
  BTK: a('Batik Air', 'ID', 'ID', 'BATIK'),
  AWQ: a('Indonesia AirAsia', 'QZ', 'ID', 'WAGON AIR'),
  SJY: a('Sriwijaya Air', 'SJ', 'ID', 'SRIWIJAYA'),
  PAL: a('Philippine Airlines', 'PR', 'PH', 'PHILIPPINE'),
  CEB: a('Cebu Pacific', '5J', 'PH', 'CEBU'),
  APG: a('AirAsia Philippines', 'Z2', 'PH', 'COOL RED'),
  RBA: a('Royal Brunei Airlines', 'BI', 'BN', 'BRUNEI'),
  UBA: a('Myanmar National Airlines', 'UB', 'MM', 'UNIONAIR'),
  AIC: a('Air India', 'AI', 'IN', 'AIRINDIA'),
  IGO: a('IndiGo', '6E', 'IN', 'IFLY'),
  AXB: a('Air India Express', 'IX', 'IN', 'EXPRESS INDIA'),
  ALK: a('SriLankan Airlines', 'UL', 'LK', 'SRILANKAN'),
  BBC: a('Biman Bangladesh', 'BG', 'BD', 'BANGLADESH'),
  SVA: a('Saudia', 'SV', 'SA', 'SAUDIA'),
  GFA: a('Gulf Air', 'GF', 'BH', 'GULF AIR'),
  OMA: a('Oman Air', 'WY', 'OM', 'OMAN AIR'),
  ETH: a('Ethiopian Airlines', 'ET', 'ET', 'ETHIOPIAN'),
  FDX: a('FedEx', 'FX', 'US', 'FEDEX'),
  UPS: a('UPS Airlines', '5X', 'US', 'UPS'),
  GTI: a('Atlas Air', '5Y', 'US', 'GIANT'),
  CLX: a('Cargolux', 'CV', 'LU', 'CARGOLUX'),
  DHK: a('DHL Air', 'D0', 'GB', 'WORLD EXPRESS'),
  BCS: a('European Air Transport (DHL)', 'QY', 'BE', 'EUROTRANS'),
  AHK: a('Air Hong Kong', 'LD', 'HK', 'AIR HONG KONG'),
  CKS: a('Kalitta Air', 'K4', 'US', 'CONNIE'),
  NCA: a('Nippon Cargo Airlines', 'KZ', 'JP', 'NIPPON CARGO'),
};

/** Splits "SIA321" into airline "SIA" and number "321"; undefined for registrations like "9VYFH". */
export function splitCallsign(cs: string | undefined): { icao: string; number: string } | undefined {
  const m = cs?.toUpperCase().match(/^([A-Z]{3})(\d[0-9A-Z]{0,4})$/);
  return m ? { icao: m[1]!, number: m[2]! } : undefined;
}

/** Best-effort IATA flight number from an ICAO callsign using the fallback table: "SIA321" → "SQ321". */
export function iataFlight(cs: string | undefined): string | undefined {
  const parts = splitCallsign(cs);
  const airline = parts && AIRLINES[parts.icao];
  return airline?.iata && parts ? `${airline.iata}${parts.number.replace(/^0+(?=\d)/, '')}` : undefined;
}
