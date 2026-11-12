import type { LemonResolveResult } from '../types/diagnostic';

export const LEMON_BASE_URL = 'https://lemon.dogeware.me';

interface VerifiedLemonVehicle {
  make: string;
  year: number;
  modelKeywords: string[];
  vehicleLabel: string;
  vehicleUrl: string;
  dtcIndexUrl: string;
  tsbsUrl: string;
  wiringUrl: string;
  locationsUrl: string;
}

export const VERIFIED_LEMON_VEHICLES: VerifiedLemonVehicle[] = [
  {
    make: 'Ford',
    year: 2023,
    modelKeywords: ['f-150', 'f150', 'lariat', 'powerboost', '3.5'],
    vehicleLabel: '2023 Ford F-150 Lariat, 4D Pickup Crew Cab, 3.5L Eng VIN D, 4WD',
    vehicleUrl:
      'https://lemon.dogeware.me/Ford/2023/F-150%20Lariat%2C%204D%20Pickup%20Crew%20Cab%2C%203.5L%20Eng%20VIN%20D%2C%204WD/',
    dtcIndexUrl:
      'https://lemon.dogeware.me/Ford/2023/F-150%20Lariat%2C%204D%20Pickup%20Crew%20Cab%2C%203.5L%20Eng%20VIN%20D%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/DTC%20Index/DTC%20Index%20%28Engine%20Emission%20Control%20System%20Through%20Front%20End%20Body%20Panels%20DTCS%29/',
    tsbsUrl:
      'https://lemon.dogeware.me/Ford/2023/F-150%20Lariat%2C%204D%20Pickup%20Crew%20Cab%2C%203.5L%20Eng%20VIN%20D%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/Technical%20Bulletins/Technical%20Service%20Bulletins/',
    wiringUrl:
      'https://lemon.dogeware.me/Ford/2023/F-150%20Lariat%2C%204D%20Pickup%20Crew%20Cab%2C%203.5L%20Eng%20VIN%20D%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/Wiring%20Diagrams/OEM%20Component%20Harness%20Location%20Views/',
    locationsUrl:
      'https://lemon.dogeware.me/Ford/2023/F-150%20Lariat%2C%204D%20Pickup%20Crew%20Cab%2C%203.5L%20Eng%20VIN%20D%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/Electrical%20Component%20Locations/Component%20Locations%20-%20F-150/',
  },
  {
    make: 'BMW',
    year: 2021,
    modelKeywords: ['330i', 'g20', 'xdrive'],
    vehicleLabel: '2021 BMW 330i xDrive',
    vehicleUrl: 'https://lemon.dogeware.me/BMW/2021/330i%20xDrive/',
    dtcIndexUrl:
      'https://lemon.dogeware.me/BMW/2021/330i%20xDrive/Repair%20and%20Diagnosis/',
    tsbsUrl:
      'https://lemon.dogeware.me/BMW/2021/330i%20xDrive/Repair%20and%20Diagnosis/Quick%20Lookups/Technical%20Bulletins/Technical%20Service%20Bulletins/',
    wiringUrl:
      'https://lemon.dogeware.me/BMW/2021/330i%20xDrive/Repair%20and%20Diagnosis/Quick%20Lookups/Wiring%20Diagrams/System%20Wiring%20Diagrams/',
    locationsUrl:
      'https://lemon.dogeware.me/BMW/2021/330i%20xDrive/Repair%20and%20Diagnosis/Quick%20Lookups/Wiring%20Diagrams/Fuse%20And%20Relay%20Location%20--%20%283%27%20Series%3A%20G20%2C%20G80%29/',
  },
  {
    make: 'Toyota',
    year: 2020,
    modelKeywords: ['tacoma', 'trd', 'off-road'],
    vehicleLabel: '2020 Toyota Tacoma Limited, 4WD',
    vehicleUrl: 'https://lemon.dogeware.me/Toyota/2020/Tacoma%20Limited%2C%204WD/',
    dtcIndexUrl:
      'https://lemon.dogeware.me/Toyota/2020/Tacoma%20Limited%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/DTC%20Index/',
    tsbsUrl:
      'https://lemon.dogeware.me/Toyota/2020/Tacoma%20Limited%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/Technical%20Bulletins/Technical%20Service%20Bulletins/',
    wiringUrl:
      'https://lemon.dogeware.me/Toyota/2020/Tacoma%20Limited%2C%204WD/Repair%20and%20Diagnosis/',
    locationsUrl:
      'https://lemon.dogeware.me/Toyota/2020/Tacoma%20Limited%2C%204WD/Repair%20and%20Diagnosis/Quick%20Lookups/Electrical%20Component%20Locations/Component%20Locations/',
  },
  {
    make: 'Volkswagen',
    year: 2019,
    modelKeywords: ['jetta', 'gli', 'autobahn'],
    vehicleLabel: '2019 Volkswagen Jetta GLI Autobahn, Automatic DCT Trans',
    vehicleUrl:
      'https://lemon.dogeware.me/Volkswagen/2019/Jetta%20GLI%20Autobahn%2C%20Automatic%20DCT%20Trans/',
    dtcIndexUrl:
      'https://lemon.dogeware.me/Volkswagen/2019/Jetta%20GLI%20Autobahn%2C%20Automatic%20DCT%20Trans/Repair%20and%20Diagnosis/',
    tsbsUrl:
      'https://lemon.dogeware.me/Volkswagen/2019/Jetta%20GLI%20Autobahn%2C%20Automatic%20DCT%20Trans/Repair%20and%20Diagnosis/Quick%20Lookups/Technical%20Bulletins/Technical%20Service%20Bulletins/',
    wiringUrl:
      'https://lemon.dogeware.me/Volkswagen/2019/Jetta%20GLI%20Autobahn%2C%20Automatic%20DCT%20Trans/Repair%20and%20Diagnosis/',
    locationsUrl:
      'https://lemon.dogeware.me/Volkswagen/2019/Jetta%20GLI%20Autobahn%2C%20Automatic%20DCT%20Trans/Repair%20and%20Diagnosis/',
  },
  {
    make: 'Chevrolet',
    year: 2016,
    modelKeywords: ['silverado', '1500', 'ltz'],
    vehicleLabel:
      '2016 Chevrolet Silverado 1500 LTZ, 4D Pickup Crew Cab, 5.3L Eng VIN C, 4WD, 8L90',
    vehicleUrl:
      'https://lemon.dogeware.me/Chevrolet/2016/Silverado%201500%20LTZ%2C%204D%20Pickup%20Crew%20Cab%2C%205.3L%20Eng%20VIN%20C%2C%204WD%2C%20Trans%20Mfr%20CD%208L90%2FM5U/',
    dtcIndexUrl:
      'https://lemon.dogeware.me/Chevrolet/2016/Silverado%201500%20LTZ%2C%204D%20Pickup%20Crew%20Cab%2C%205.3L%20Eng%20VIN%20C%2C%204WD%2C%20Trans%20Mfr%20CD%208L90%2FM5U/Repair%20and%20Diagnosis/',
    tsbsUrl:
      'https://lemon.dogeware.me/Chevrolet/2016/Silverado%201500%20LTZ%2C%204D%20Pickup%20Crew%20Cab%2C%205.3L%20Eng%20VIN%20C%2C%204WD%2C%20Trans%20Mfr%20CD%208L90%2FM5U/Repair%20and%20Diagnosis/Quick%20Lookups/Technical%20Bulletins/Technical%20Service%20Bulletins/',
    wiringUrl:
      'https://lemon.dogeware.me/Chevrolet/2016/Silverado%201500%20LTZ%2C%204D%20Pickup%20Crew%20Cab%2C%205.3L%20Eng%20VIN%20C%2C%204WD%2C%20Trans%20Mfr%20CD%208L90%2FM5U/Repair%20and%20Diagnosis/',
    locationsUrl:
      'https://lemon.dogeware.me/Chevrolet/2016/Silverado%201500%20LTZ%2C%204D%20Pickup%20Crew%20Cab%2C%205.3L%20Eng%20VIN%20C%2C%204WD%2C%20Trans%20Mfr%20CD%208L90%2FM5U/Repair%20and%20Diagnosis/',
  },
];

export function buildFallbackLemonResolve(
  make: string,
  model: string,
  year: number
): LemonResolveResult {
  const normMake = make.trim().toLowerCase();
  const normModel = model.trim().toLowerCase();

  const matched =
    VERIFIED_LEMON_VEHICLES.find(
      (v) =>
        v.make.toLowerCase() === normMake &&
        v.modelKeywords.some((kw) => normModel.includes(kw))
    ) ||
    VERIFIED_LEMON_VEHICLES.find((v) => v.make.toLowerCase() === normMake);

  if (matched) {
    const repairUrl = `${matched.vehicleUrl}Repair%20and%20Diagnosis/`;
    return {
      source: 'cached-fallback',
      baseUrl: LEMON_BASE_URL,
      vehicleLabel: matched.vehicleLabel,
      vehicleUrl: matched.vehicleUrl,
      repairUrl,
      sections: [
        { id: 'repair', label: 'Repair & Diagnosis', url: repairUrl },
        { id: 'dtc_index', label: 'DTC Index', url: matched.dtcIndexUrl },
        { id: 'tsbs', label: 'TSBs', url: matched.tsbsUrl },
        { id: 'wiring', label: 'Wiring Diagrams', url: matched.wiringUrl },
        { id: 'locations', label: 'Component Locations', url: matched.locationsUrl },
        { id: 'home', label: 'All Manuals', url: `${LEMON_BASE_URL}/` },
      ],
      allQuickLinks: [
        { label: 'Repair and Diagnosis', url: repairUrl },
        { label: 'DTC Index', url: matched.dtcIndexUrl },
        { label: 'Technical Service Bulletins', url: matched.tsbsUrl },
        { label: 'Wiring Diagrams', url: matched.wiringUrl },
        { label: 'Component Locations', url: matched.locationsUrl },
      ],
    };
  }

  const makeUrl = make
    ? `${LEMON_BASE_URL}/${encodeURIComponent(make)}/${year ? `${encodeURIComponent(String(year))}/` : ''}`
    : `${LEMON_BASE_URL}/`;

  return {
    source: 'cached-fallback',
    baseUrl: LEMON_BASE_URL,
    vehicleLabel: `${year} ${make} ${model}`.trim(),
    vehicleUrl: makeUrl,
    repairUrl: makeUrl,
    sections: [
      { id: 'repair', label: 'Browse Make & Year', url: makeUrl },
      { id: 'home', label: 'All Manuals', url: `${LEMON_BASE_URL}/` },
    ],
    allQuickLinks: [{ label: `${year} ${make} Directory`, url: makeUrl }],
  };
}
