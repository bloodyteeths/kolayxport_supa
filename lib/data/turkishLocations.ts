export interface TurkishCity {
  code: string;
  name: string;
  plateCode: string;
}

export interface TurkishProvince {
  code: string;
  name: string;
  cities: string[];
}

export const TURKISH_CITIES: TurkishCity[] = [
  { code: '01', name: 'Adana', plateCode: '01' },
  { code: '02', name: 'Adıyaman', plateCode: '02' },
  { code: '03', name: 'Afyonkarahisar', plateCode: '03' },
  { code: '04', name: 'Ağrı', plateCode: '04' },
  { code: '05', name: 'Amasya', plateCode: '05' },
  { code: '06', name: 'Ankara', plateCode: '06' },
  { code: '07', name: 'Antalya', plateCode: '07' },
  { code: '08', name: 'Artvin', plateCode: '08' },
  { code: '09', name: 'Aydın', plateCode: '09' },
  { code: '10', name: 'Balıkesir', plateCode: '10' },
  { code: '11', name: 'Bilecik', plateCode: '11' },
  { code: '12', name: 'Bingöl', plateCode: '12' },
  { code: '13', name: 'Bitlis', plateCode: '13' },
  { code: '14', name: 'Bolu', plateCode: '14' },
  { code: '15', name: 'Burdur', plateCode: '15' },
  { code: '16', name: 'Bursa', plateCode: '16' },
  { code: '17', name: 'Çanakkale', plateCode: '17' },
  { code: '18', name: 'Çankırı', plateCode: '18' },
  { code: '19', name: 'Çorum', plateCode: '19' },
  { code: '20', name: 'Denizli', plateCode: '20' },
  { code: '21', name: 'Diyarbakır', plateCode: '21' },
  { code: '22', name: 'Edirne', plateCode: '22' },
  { code: '23', name: 'Elazığ', plateCode: '23' },
  { code: '24', name: 'Erzincan', plateCode: '24' },
  { code: '25', name: 'Erzurum', plateCode: '25' },
  { code: '26', name: 'Eskişehir', plateCode: '26' },
  { code: '27', name: 'Gaziantep', plateCode: '27' },
  { code: '28', name: 'Giresun', plateCode: '28' },
  { code: '29', name: 'Gümüşhane', plateCode: '29' },
  { code: '30', name: 'Hakkâri', plateCode: '30' },
  { code: '31', name: 'Hatay', plateCode: '31' },
  { code: '32', name: 'Isparta', plateCode: '32' },
  { code: '33', name: 'Mersin', plateCode: '33' },
  { code: '34', name: 'İstanbul', plateCode: '34' },
  { code: '35', name: 'İzmir', plateCode: '35' },
  { code: '36', name: 'Kars', plateCode: '36' },
  { code: '37', name: 'Kastamonu', plateCode: '37' },
  { code: '38', name: 'Kayseri', plateCode: '38' },
  { code: '39', name: 'Kırklareli', plateCode: '39' },
  { code: '40', name: 'Kırşehir', plateCode: '40' },
  { code: '41', name: 'Kocaeli', plateCode: '41' },
  { code: '42', name: 'Konya', plateCode: '42' },
  { code: '43', name: 'Kütahya', plateCode: '43' },
  { code: '44', name: 'Malatya', plateCode: '44' },
  { code: '45', name: 'Manisa', plateCode: '45' },
  { code: '46', name: 'Kahramanmaraş', plateCode: '46' },
  { code: '47', name: 'Mardin', plateCode: '47' },
  { code: '48', name: 'Muğla', plateCode: '48' },
  { code: '49', name: 'Muş', plateCode: '49' },
  { code: '50', name: 'Nevşehir', plateCode: '50' },
  { code: '51', name: 'Niğde', plateCode: '51' },
  { code: '52', name: 'Ordu', plateCode: '52' },
  { code: '53', name: 'Rize', plateCode: '53' },
  { code: '54', name: 'Sakarya', plateCode: '54' },
  { code: '55', name: 'Samsun', plateCode: '55' },
  { code: '56', name: 'Siirt', plateCode: '56' },
  { code: '57', name: 'Sinop', plateCode: '57' },
  { code: '58', name: 'Sivas', plateCode: '58' },
  { code: '59', name: 'Tekirdağ', plateCode: '59' },
  { code: '60', name: 'Tokat', plateCode: '60' },
  { code: '61', name: 'Trabzon', plateCode: '61' },
  { code: '62', name: 'Tunceli', plateCode: '62' },
  { code: '63', name: 'Şanlıurfa', plateCode: '63' },
  { code: '64', name: 'Uşak', plateCode: '64' },
  { code: '65', name: 'Van', plateCode: '65' },
  { code: '66', name: 'Yozgat', plateCode: '66' },
  { code: '67', name: 'Zonguldak', plateCode: '67' },
  { code: '68', name: 'Aksaray', plateCode: '68' },
  { code: '69', name: 'Bayburt', plateCode: '69' },
  { code: '70', name: 'Karaman', plateCode: '70' },
  { code: '71', name: 'Kırıkkale', plateCode: '71' },
  { code: '72', name: 'Batman', plateCode: '72' },
  { code: '73', name: 'Şırnak', plateCode: '73' },
  { code: '74', name: 'Bartın', plateCode: '74' },
  { code: '75', name: 'Ardahan', plateCode: '75' },
  { code: '76', name: 'Iğdır', plateCode: '76' },
  { code: '77', name: 'Yalova', plateCode: '77' },
  { code: '78', name: 'Karabük', plateCode: '78' },
  { code: '79', name: 'Kilis', plateCode: '79' },
  { code: '80', name: 'Osmaniye', plateCode: '80' },
  { code: '81', name: 'Düzce', plateCode: '81' }
];

// For Turkey, we use the standard NUTS-2 region codes for stateOrProvinceCode
export const TURKISH_REGIONS: TurkishProvince[] = [
  {
    code: 'TR10',
    name: 'İstanbul',
    cities: ['İstanbul']
  },
  {
    code: 'TR21',
    name: 'Tekirdağ, Edirne, Kırklareli',
    cities: ['Tekirdağ', 'Edirne', 'Kırklareli']
  },
  {
    code: 'TR22',
    name: 'Balıkesir, Çanakkale',
    cities: ['Balıkesir', 'Çanakkale']
  },
  {
    code: 'TR31',
    name: 'İzmir',
    cities: ['İzmir']
  },
  {
    code: 'TR32',
    name: 'Aydın, Denizli, Muğla',
    cities: ['Aydın', 'Denizli', 'Muğla']
  },
  {
    code: 'TR33',
    name: 'Manisa, Afyonkarahisar, Kütahya, Uşak',
    cities: ['Manisa', 'Afyonkarahisar', 'Kütahya', 'Uşak']
  },
  {
    code: 'TR41',
    name: 'Bursa, Eskişehir, Bilecik',
    cities: ['Bursa', 'Eskişehir', 'Bilecik']
  },
  {
    code: 'TR42',
    name: 'Kocaeli, Sakarya, Düzce, Bolu, Yalova',
    cities: ['Kocaeli', 'Sakarya', 'Düzce', 'Bolu', 'Yalova']
  },
  {
    code: 'TR51',
    name: 'Ankara',
    cities: ['Ankara']
  },
  {
    code: 'TR52',
    name: 'Konya, Karaman',
    cities: ['Konya', 'Karaman']
  },
  {
    code: 'TR61',
    name: 'Antalya, Isparta, Burdur',
    cities: ['Antalya', 'Isparta', 'Burdur']
  },
  {
    code: 'TR62',
    name: 'Adana, Mersin',
    cities: ['Adana', 'Mersin']
  },
  {
    code: 'TR63',
    name: 'Hatay, Kahramanmaraş, Osmaniye',
    cities: ['Hatay', 'Kahramanmaraş', 'Osmaniye']
  },
  {
    code: 'TR71',
    name: 'Kırıkkale, Aksaray, Niğde, Nevşehir, Kırşehir',
    cities: ['Kırıkkale', 'Aksaray', 'Niğde', 'Nevşehir', 'Kırşehir']
  },
  {
    code: 'TR72',
    name: 'Kayseri, Sivas, Yozgat',
    cities: ['Kayseri', 'Sivas', 'Yozgat']
  },
  {
    code: 'TR81',
    name: 'Zonguldak, Karabük, Bartın',
    cities: ['Zonguldak', 'Karabük', 'Bartın']
  },
  {
    code: 'TR82',
    name: 'Kastamonu, Çankırı, Sinop',
    cities: ['Kastamonu', 'Çankırı', 'Sinop']
  },
  {
    code: 'TR83',
    name: 'Samsun, Tokat, Çorum, Amasya',
    cities: ['Samsun', 'Tokat', 'Çorum', 'Amasya']
  },
  {
    code: 'TR90',
    name: 'Trabzon, Ordu, Giresun, Rize, Artvin, Gümüşhane',
    cities: ['Trabzon', 'Ordu', 'Giresun', 'Rize', 'Artvin', 'Gümüşhane']
  },
  {
    code: 'TRA1',
    name: 'Erzurum, Erzincan, Bayburt',
    cities: ['Erzurum', 'Erzincan', 'Bayburt']
  },
  {
    code: 'TRA2',
    name: 'Ağrı, Kars, Iğdır, Ardahan',
    cities: ['Ağrı', 'Kars', 'Iğdır', 'Ardahan']
  },
  {
    code: 'TRB1',
    name: 'Malatya, Elazığ, Bingöl, Tunceli',
    cities: ['Malatya', 'Elazığ', 'Bingöl', 'Tunceli']
  },
  {
    code: 'TRB2',
    name: 'Van, Muş, Bitlis, Hakkâri',
    cities: ['Van', 'Muş', 'Bitlis', 'Hakkâri']
  },
  {
    code: 'TRC1',
    name: 'Gaziantep, Adıyaman, Kilis',
    cities: ['Gaziantep', 'Adıyaman', 'Kilis']
  },
  {
    code: 'TRC2',
    name: 'Şanlıurfa, Diyarbakır',
    cities: ['Şanlıurfa', 'Diyarbakır']
  },
  {
    code: 'TRC3',
    name: 'Mardin, Batman, Şırnak, Siirt',
    cities: ['Mardin', 'Batman', 'Şırnak', 'Siirt']
  }
];

export const getRegionCodeForCity = (cityName: string): string => {
  const region = TURKISH_REGIONS.find(region => 
    region.cities.includes(cityName)
  );
  return region ? region.code : 'TR10'; // Default to Istanbul region
};

export const getCityCode = (cityName: string): string => {
  const city = TURKISH_CITIES.find(city => city.name === cityName);
  return city ? city.code : '34'; // Default to Istanbul
};