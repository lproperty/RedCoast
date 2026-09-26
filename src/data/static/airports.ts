/**
 * Airports used by the traffic simulator and as an offline fallback. Live route lookups
 * return full airport records, so this list only needs the usual suspects around Changi.
 */

export interface AirportRef {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

const ap = (icao: string, iata: string, name: string, city: string, country: string, lat: number, lon: number): AirportRef => ({
  icao, iata, name, city, country, lat, lon,
});

const LIST: AirportRef[] = [
  ap('WSSS', 'SIN', 'Singapore Changi Airport', 'Singapore', 'SG', 1.3502, 103.994),
  ap('WSSL', 'XSP', 'Seletar Airport', 'Singapore', 'SG', 1.4169, 103.8678),
  ap('WSAP', 'QPG', 'Paya Lebar Air Base', 'Singapore', 'SG', 1.3604, 103.9098),
  ap('WIDD', 'BTH', 'Hang Nadim International Airport', 'Batam', 'ID', 1.121, 104.119),
  ap('WMKJ', 'JHB', 'Senai International Airport', 'Johor Bahru', 'MY', 1.6413, 103.67),
  ap('WMKK', 'KUL', 'Kuala Lumpur International Airport', 'Kuala Lumpur', 'MY', 2.7456, 101.7099),
  ap('WMKP', 'PEN', 'Penang International Airport', 'Penang', 'MY', 5.2971, 100.2769),
  ap('WIII', 'CGK', 'Soekarno–Hatta International Airport', 'Jakarta', 'ID', -6.1256, 106.6559),
  ap('WADD', 'DPS', 'I Gusti Ngurah Rai International Airport', 'Denpasar', 'ID', -8.7482, 115.1675),
  ap('VTBS', 'BKK', 'Suvarnabhumi Airport', 'Bangkok', 'TH', 13.69, 100.7501),
  ap('VTSP', 'HKT', 'Phuket International Airport', 'Phuket', 'TH', 8.1132, 98.3169),
  ap('VVTS', 'SGN', 'Tan Son Nhat International Airport', 'Ho Chi Minh City', 'VN', 10.8188, 106.652),
  ap('VVNB', 'HAN', 'Noi Bai International Airport', 'Hanoi', 'VN', 21.2212, 105.8072),
  ap('RPLL', 'MNL', 'Ninoy Aquino International Airport', 'Manila', 'PH', 14.5086, 121.0198),
  ap('VHHH', 'HKG', 'Hong Kong International Airport', 'Hong Kong', 'HK', 22.308, 113.9185),
  ap('RCTP', 'TPE', 'Taiwan Taoyuan International Airport', 'Taipei', 'TW', 25.0777, 121.2328),
  ap('RKSI', 'ICN', 'Incheon International Airport', 'Seoul', 'KR', 37.4691, 126.451),
  ap('RJTT', 'HND', 'Tokyo Haneda Airport', 'Tokyo', 'JP', 35.5494, 139.7798),
  ap('RJAA', 'NRT', 'Narita International Airport', 'Tokyo', 'JP', 35.772, 140.3929),
  ap('ZSPD', 'PVG', 'Shanghai Pudong International Airport', 'Shanghai', 'CN', 31.1443, 121.8083),
  ap('ZBAA', 'PEK', 'Beijing Capital International Airport', 'Beijing', 'CN', 40.0799, 116.6031),
  ap('ZGGG', 'CAN', 'Guangzhou Baiyun International Airport', 'Guangzhou', 'CN', 23.3924, 113.2988),
  ap('YSSY', 'SYD', 'Sydney Kingsford Smith Airport', 'Sydney', 'AU', -33.9461, 151.1772),
  ap('YMML', 'MEL', 'Melbourne Airport', 'Melbourne', 'AU', -37.6733, 144.8433),
  ap('YPPH', 'PER', 'Perth Airport', 'Perth', 'AU', -31.9403, 115.9669),
  ap('NZAA', 'AKL', 'Auckland Airport', 'Auckland', 'NZ', -37.0082, 174.785),
  ap('VIDP', 'DEL', 'Indira Gandhi International Airport', 'Delhi', 'IN', 28.5665, 77.1031),
  ap('VABB', 'BOM', 'Chhatrapati Shivaji Maharaj International Airport', 'Mumbai', 'IN', 19.0887, 72.8679),
  ap('VOMM', 'MAA', 'Chennai International Airport', 'Chennai', 'IN', 12.9941, 80.1709),
  ap('VCBI', 'CMB', 'Bandaranaike International Airport', 'Colombo', 'LK', 7.1808, 79.8841),
  ap('OMDB', 'DXB', 'Dubai International Airport', 'Dubai', 'AE', 25.2528, 55.3644),
  ap('OTHH', 'DOH', 'Hamad International Airport', 'Doha', 'QA', 25.2731, 51.6081),
  ap('EGLL', 'LHR', 'London Heathrow Airport', 'London', 'GB', 51.4706, -0.4619),
  ap('LFPG', 'CDG', 'Paris Charles de Gaulle Airport', 'Paris', 'FR', 49.0097, 2.5479),
  ap('EDDF', 'FRA', 'Frankfurt Airport', 'Frankfurt', 'DE', 50.0333, 8.5706),
  ap('EHAM', 'AMS', 'Amsterdam Airport Schiphol', 'Amsterdam', 'NL', 52.3086, 4.7639),
  ap('LTFM', 'IST', 'Istanbul Airport', 'Istanbul', 'TR', 41.2753, 28.7519),
  ap('KSFO', 'SFO', 'San Francisco International Airport', 'San Francisco', 'US', 37.619, -122.3748),
  ap('KJFK', 'JFK', 'John F. Kennedy International Airport', 'New York', 'US', 40.6398, -73.7789),
];

export const AIRPORTS: Record<string, AirportRef> = Object.fromEntries(LIST.map((x) => [x.icao, x]));

/** Local aerodromes, used to classify arrivals and departures around the observer. */
export const LOCAL_AERODROMES = ['WSSS', 'WSAP', 'WSSL', 'WIDD', 'WMKJ'] as const;
